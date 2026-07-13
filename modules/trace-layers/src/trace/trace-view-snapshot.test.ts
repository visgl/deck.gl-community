import * as arrow from 'apache-arrow';
import {describe, expect, it, vi} from 'vitest';

import {buildArrowTraceSpanTableFromColumns} from './ingestion/arrow-trace';
import {
  buildSyntheticArrowTraceFixture,
  SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME
} from './test-stubs/synthetic-arrow-trace';
import {buildTraceDatasetFromReadyTraceChunks} from './trace-chunk-graph-assembler';
import {
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE
} from './trace-graph/trace-graph-types';
import {encodeProcessRef, encodeProcessThreadRef} from './trace-graph/trace-id-encoder';
import {buildTraceViewSnapshot} from './trace-view-snapshot';

import type {ArrowTraceSpanTable} from './ingestion/arrow-trace';
import type {TraceDataset} from './trace-dataset';
import type {SpanRef, TraceSpanId, TraceThreadId} from './trace-graph/trace-types';

describe('TraceViewSnapshot', () => {
  it('retains a dense unfiltered dataset without per-span view columns', () => {
    const dataset = buildSyntheticDataset({
      processCount: 2,
      rowCount: 8
    });

    const snapshot = buildTraceViewSnapshot(dataset);

    expect(snapshot.dataset).toBe(dataset);
    expect(snapshot).toMatchObject({
      spanFilters: [],
      filteredSpanCount: 0
    });
    expect(snapshot).not.toHaveProperty('type');
    expect(snapshot).not.toHaveProperty('datasetRevision');
    expect(snapshot).not.toHaveProperty('activeSpanCount');
    expect(snapshot).not.toHaveProperty('visibleSpanCount');
    expect(snapshot.chunks).toHaveLength(2);
    snapshot.chunks.forEach(chunk => {
      expect(chunk.rowCount).toBe(4);
      expect(chunk.filteredSpanCount).toBe(0);
      expect(chunk.filterMaskByRow).toBeNull();
      expect(chunk).not.toHaveProperty('activeSpanCount');
      expect(chunk).not.toHaveProperty('visibleSpanCount');
      expect(chunk).not.toHaveProperty('visibleRowIndexes');
    });
  });

  it('allocates typed rows only for chunks with matching canonical names', () => {
    const dataset = buildSyntheticDataset({
      processCount: 3,
      rowCount: 12,
      textFilterMatchEvery: 4
    });

    const snapshot = buildTraceViewSnapshot(dataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });

    expect(snapshot.spanFilters).toEqual([SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]);
    expect(snapshot.filteredSpanCount).toBe(3);
    snapshot.chunks.forEach(chunk => {
      expect(chunk.rowCount).toBe(4);
      expect(chunk.filteredSpanCount).toBe(1);
      expect(chunk.filterMaskByRow).toBeInstanceOf(Uint8Array);
      expect(Array.from(chunk.filterMaskByRow ?? [])).toEqual([
        TRACE_SPAN_FILTER_MASK_REGEXP,
        TRACE_SPAN_FILTER_MASK_NONE,
        TRACE_SPAN_FILTER_MASK_NONE,
        TRACE_SPAN_FILTER_MASK_NONE
      ]);
      expect(chunk).not.toHaveProperty('visibleRowIndexes');
    });
  });

  it('ignores inactive canonical rows in row-selected datasets', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 4,
      textFilterMatchEvery: 2
    });
    const selectedDataset = {
      ...dataset,
      spanRefs: [getDatasetProcessSpanRefAtRow(dataset, 1)]
    } satisfies TraceDataset;

    const snapshot = buildTraceViewSnapshot(selectedDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });

    expect(snapshot.filteredSpanCount).toBe(0);
    expect(snapshot.chunks[0]?.filterMaskByRow).toBeNull();
  });

  it('reads only the narrow text-filter Arrow columns', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 4,
      textFilterMatchEvery: 2
    });
    const getChild = vi.spyOn(dataset.chunks[0]!.spanTable, 'getChild');

    buildTraceViewSnapshot(dataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });

    expect(new Set(getChild.mock.calls.map(([columnName]) => columnName))).toEqual(
      new Set(['name', 'source'])
    );
  });

  it('matches literal prefixes from borrowed Utf8 bytes without decoding Arrow rows', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 4,
      textFilterMatchEvery: 2
    });
    const columns = bindStableTraceViewTestColumns(dataset.chunks[0]!.spanTable, [
      'span_id',
      'name',
      'source'
    ]);
    const spanIdGet = vi.spyOn(columns.span_id!, 'get');
    const nameGet = vi.spyOn(columns.name!, 'get');
    const sourceGet = vi.spyOn(columns.source!, 'get');

    const snapshot = buildTraceViewSnapshot(dataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });

    expect(snapshot.filteredSpanCount).toBe(2);
    expect(spanIdGet).not.toHaveBeenCalled();
    expect(nameGet).not.toHaveBeenCalled();
    expect(sourceGet).not.toHaveBeenCalled();
  });

  it('matches source text through the same snapshot-owned text filter', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 2
    });
    const sourceSpanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0), encodeProcessRef(0)],
      thread_ref: [encodeProcessThreadRef(0, 0), encodeProcessThreadRef(0, 0)],
      span_id: ['source-span-0' as TraceSpanId, 'source-span-1' as TraceSpanId],
      external_span_id: ['source-span-0' as TraceSpanId, 'source-span-1' as TraceSpanId],
      thread_id: ['source-thread' as TraceThreadId, 'source-thread' as TraceThreadId],
      name: ['synthetic-work', 'synthetic-work'],
      source: ['worker-trace.json', null],
      primary_timing_key: ['primary', 'primary'],
      status: ['finished', 'finished'],
      start_time_ms: [1, 2],
      end_time_ms: [2, 3],
      duration_ms: [1, 1]
    });
    const sourceChunk = {
      ...dataset.chunks[0]!,
      spanTable: sourceSpanTable
    };
    const sourceDataset = {
      ...dataset,
      chunks: [sourceChunk]
    } satisfies TraceDataset;

    const sourceSnapshot = buildTraceViewSnapshot(sourceDataset, {
      spanFilters: ['worker-trace']
    });

    expect(sourceSnapshot.filteredSpanCount).toBe(1);
    expect(Array.from(sourceSnapshot.chunks[0]?.filterMaskByRow ?? [])).toEqual([
      TRACE_SPAN_FILTER_MASK_SOURCE,
      TRACE_SPAN_FILTER_MASK_NONE
    ]);
  });

  it('does not let empty span ids or names suppress independent source matches', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 2
    });
    const invalidFilterRowTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0), encodeProcessRef(0)],
      thread_ref: [encodeProcessThreadRef(0, 0), encodeProcessThreadRef(0, 0)],
      span_id: ['' as TraceSpanId, 'valid-span-id' as TraceSpanId],
      external_span_id: ['missing-span-id' as TraceSpanId, 'valid-span-id' as TraceSpanId],
      thread_id: ['source-thread' as TraceThreadId, 'source-thread' as TraceThreadId],
      name: ['', 'synthetic-work'],
      source: ['worker-trace.json', null],
      primary_timing_key: ['primary', 'primary'],
      status: ['finished', 'finished'],
      start_time_ms: [1, 2],
      end_time_ms: [2, 3],
      duration_ms: [1, 1]
    });
    const invalidFilterRowDataset = {
      ...dataset,
      chunks: [{...dataset.chunks[0]!, spanTable: invalidFilterRowTable}]
    } satisfies TraceDataset;

    const snapshot = buildTraceViewSnapshot(invalidFilterRowDataset, {
      spanFilters: ['worker-trace']
    });

    expect(snapshot.filteredSpanCount).toBe(1);
    expect(snapshot.chunks[0]?.filterMaskByRow?.[0]).toBe(TRACE_SPAN_FILTER_MASK_SOURCE);
  });

  it('matches non-ASCII literal prefixes through borrowed Utf8 bytes', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 2
    });
    const unicodeSpanTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [encodeProcessRef(0), encodeProcessRef(0)],
      thread_ref: [encodeProcessThreadRef(0, 0), encodeProcessThreadRef(0, 0)],
      span_id: ['unicode-span-0' as TraceSpanId, 'unicode-span-1' as TraceSpanId],
      external_span_id: ['unicode-span-0' as TraceSpanId, 'unicode-span-1' as TraceSpanId],
      thread_id: ['source-thread' as TraceThreadId, 'source-thread' as TraceThreadId],
      name: ['βeta-work', 'synthetic-work'],
      source: [null, null],
      primary_timing_key: ['primary', 'primary'],
      status: ['finished', 'finished'],
      start_time_ms: [1, 2],
      end_time_ms: [2, 3],
      duration_ms: [1, 1]
    });
    const unicodeDataset = {
      ...dataset,
      chunks: [{...dataset.chunks[0]!, spanTable: unicodeSpanTable}]
    } satisfies TraceDataset;

    const snapshot = buildTraceViewSnapshot(unicodeDataset, {
      spanFilters: ['βeta']
    });

    expect(snapshot.filteredSpanCount).toBe(1);
    expect(snapshot.chunks[0]?.filterMaskByRow?.[0]).toBe(TRACE_SPAN_FILTER_MASK_REGEXP);
  });

  it('keeps explicit regex filters on the checked Arrow string path', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 4,
      textFilterMatchEvery: 2
    });
    const columns = bindStableTraceViewTestColumns(dataset.chunks[0]!.spanTable, [
      'span_id',
      'name'
    ]);
    const spanIdGet = vi.spyOn(columns.span_id!, 'get');
    const nameGet = vi.spyOn(columns.name!, 'get');

    const snapshot = buildTraceViewSnapshot(dataset, {
      spanFilters: ['/synthetic-filter-match/']
    });

    expect(snapshot.filteredSpanCount).toBe(2);
    expect(spanIdGet).not.toHaveBeenCalled();
    expect(nameGet).toHaveBeenCalled();
  });

  it('falls back to checked strings for sliced Utf8 pages', () => {
    const dataset = buildSyntheticDataset({
      processCount: 1,
      rowCount: 2
    });
    const slicedNameVector = arrow
      .vectorFromArray(
        ['unused-name', SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME, 'synthetic-work'],
        new arrow.Utf8()
      )
      .slice(1, 3);
    const slicedSpanTable = buildArrowTraceSpanTableFromColumns(
      {
        process_ref: [encodeProcessRef(0), encodeProcessRef(0)],
        thread_ref: [encodeProcessThreadRef(0, 0), encodeProcessThreadRef(0, 0)],
        span_id: ['sliced-span-0' as TraceSpanId, 'sliced-span-1' as TraceSpanId],
        external_span_id: ['sliced-span-0' as TraceSpanId, 'sliced-span-1' as TraceSpanId],
        thread_id: ['source-thread' as TraceThreadId, 'source-thread' as TraceThreadId],
        name: ['unused-name', 'unused-name'],
        source: [null, null],
        primary_timing_key: ['primary', 'primary'],
        status: ['finished', 'finished'],
        start_time_ms: [1, 2],
        end_time_ms: [2, 3],
        duration_ms: [1, 1]
      },
      {name: slicedNameVector}
    );
    const slicedDataset = {
      ...dataset,
      chunks: [{...dataset.chunks[0]!, spanTable: slicedSpanTable}]
    } satisfies TraceDataset;
    const columns = bindStableTraceViewTestColumns(slicedSpanTable, ['name']);
    const nameGet = vi.spyOn(columns.name!, 'get');

    const snapshot = buildTraceViewSnapshot(slicedDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });

    expect(snapshot.filteredSpanCount).toBe(1);
    expect(nameGet).toHaveBeenCalled();
  });
});

/** Build one synthetic canonical dataset for view-snapshot assertions. */
function buildSyntheticDataset(params: {
  /** Number of process-scoped chunks in the generated dataset. */
  readonly processCount: number;
  /** Number of span rows in the generated dataset. */
  readonly rowCount: number;
  /** Optional global row stride whose names match the text-filter fixture name. */
  readonly textFilterMatchEvery?: number;
}): TraceDataset {
  const fixture = buildSyntheticArrowTraceFixture({
    identityKey: 'trace-view-snapshot-' + params.rowCount + '-' + params.processCount,
    processCount: params.processCount,
    rowCount: params.rowCount,
    textFilterMatchEvery: params.textFilterMatchEvery
  });
  return buildTraceDatasetFromReadyTraceChunks({
    name: 'trace-view-snapshot',
    ...fixture.materializationInputs
  });
}

/** Read one canonical process-local span ref from the first synthetic process table. */
function getDatasetProcessSpanRefAtRow(dataset: TraceDataset, rowIndex: number): SpanRef {
  const processSpanTable = Object.values(dataset.processSpanTableMap)[0];
  const spanRef = processSpanTable?.getChild('span_ref')?.get(rowIndex);
  if (typeof spanRef !== 'number') {
    throw new Error('Expected a process-local span ref at row ' + rowIndex + '.');
  }
  return spanRef as SpanRef;
}

/**
 * Return stable Arrow child vectors while a test observes direct versus checked row reads.
 *
 * Apache Arrow may return a fresh vector wrapper from each getChild call. Pinning the wrappers in
 * the test makes get spies observe the exact vectors consumed by TraceViewSnapshot.
 */
function bindStableTraceViewTestColumns(
  table: ArrowTraceSpanTable,
  columnNames: readonly string[]
): Record<string, {get(index: number): unknown}> {
  const originalGetChild = table.getChild.bind(table);
  const columns: Record<string, {get(index: number): unknown}> = {};
  for (const columnName of columnNames) {
    const column = originalGetChild(columnName as never);
    if (!column) {
      throw new Error('Expected Arrow test column ' + columnName + '.');
    }
    columns[columnName] = column;
  }
  vi.spyOn(table, 'getChild').mockImplementation(((columnName: string | number) =>
    typeof columnName === 'string' && columns[columnName]
      ? columns[columnName]
      : originalGetChild(columnName as never)) as typeof table.getChild);
  return columns;
}
