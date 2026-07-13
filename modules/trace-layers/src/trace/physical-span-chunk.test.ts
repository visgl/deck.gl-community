import {describe, expect, it} from 'vitest';

import {buildTracePhysicalSpanChunk} from './physical-span-chunk';
import {createStaticTraceChunkStore} from './trace-chunk-store';
import {buildTraceChunkWindowDataset} from './trace-chunk-window';

/** Build a compact column fixture with optional per-test overrides. */
function createColumns(overrides: Partial<Parameters<typeof buildTracePhysicalSpanChunk>[0]> = {}) {
  return {
    externalSpanIds: ['root', 'child', 'remote'],
    parentExternalSpanIds: [null, 'root', 'child'],
    processIds: ['pod-a:10', 'pod-a:10', 'pod-b:20'],
    processNames: ['pod-a / 10', 'pod-a / 10', 'pod-b / 20'],
    threadIds: ['pod-a:10:1', 'pod-a:10:2', 'pod-b:20:1'],
    threadNames: ['main', 'worker', 'main'],
    names: ['root', 'child', 'remote'],
    sources: ['python', 'python', 'rust'],
    startTimeMs: [1, 2, 3],
    endTimeMs: [5, null, 6],
    userDataJson: ['{"pod":"a"}', '{"pod":"a"}', '{"pod":"b"}'],
    ...overrides
  };
}

describe('buildTracePhysicalSpanChunk', () => {
  it('builds mixed process and thread Arrow rows with incomplete spans', () => {
    const chunk = buildTracePhysicalSpanChunk(createColumns(), {chunkKey: 'batch-0'});

    expect(chunk.processes.map(process => process.processId)).toEqual(['pod-a:10', 'pod-b:20']);
    expect(chunk.processes[0]?.threads.map(thread => thread.threadId)).toEqual([
      'pod-a:10:1',
      'pod-a:10:2'
    ]);
    expect(chunk.spanTable.numRows).toBe(3);
    expect(chunk.spanTable.schema.fields.map(field => field.name)).not.toContain('status');
    expect(Array.from(chunk.spanTable.getChild('status_code')?.toArray() ?? [])).toEqual([2, 1, 2]);
    expect(chunk.spanTable.getChild('end_time_ms')?.get(1)).toBe(2);
    expect(chunk.sourceDependencyTable?.numRows).toBe(2);
  });

  it('resolves same-process and cross-process parents across batches in either arrival order', () => {
    const childChunk = buildTracePhysicalSpanChunk(
      createColumns({
        externalSpanIds: ['child', 'remote'],
        parentExternalSpanIds: ['root', 'child'],
        processIds: ['pod-a:10', 'pod-b:20'],
        processNames: ['pod-a / 10', 'pod-b / 20'],
        threadIds: ['pod-a:10:2', 'pod-b:20:1'],
        threadNames: ['worker', 'main'],
        names: ['child', 'remote'],
        sources: ['python', 'rust'],
        startTimeMs: [2, 3],
        endTimeMs: [4, 6],
        userDataJson: ['{"pod":"a"}', '{"pod":"b"}']
      }),
      {chunkKey: 'batch-child'}
    );
    const parentChunk = buildTracePhysicalSpanChunk(
      createColumns({
        externalSpanIds: ['root'],
        parentExternalSpanIds: [null],
        processIds: ['pod-a:10'],
        processNames: ['pod-a / 10'],
        threadIds: ['pod-a:10:1'],
        threadNames: ['main'],
        names: ['root'],
        sources: ['python'],
        startTimeMs: [1],
        endTimeMs: [5],
        userDataJson: ['{"pod":"a"}']
      }),
      {chunkKey: 'batch-parent'}
    );

    const store = createStaticTraceChunkStore({
      identityKey: 'cross-batch-parents',
      chunks: [childChunk, parentChunk]
    });
    const window = {id: 'all', minTimeMs: 0, maxTimeMs: 10};
    const selection = store.select({window: {startTimeMs: 0, endTimeMs: 10}, spanBudget: null});
    const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
      buildTraceChunkWindowDataset({
        name: 'cross-batch-parents',
        ownerRefRegistry,
        readyChunks,
        window
      })
    );

    expect(Object.values(traceDataset?.sameProcessDependencyTableMap ?? {})[0]?.numRows).toBe(1);
    expect(traceDataset?.crossProcessDependencyTable.numRows).toBe(1);
  });

  it('drops invalid and duplicate rows while preserving diagnostics', () => {
    const chunk = buildTracePhysicalSpanChunk(
      createColumns({
        externalSpanIds: ['valid', 'valid', 'negative'],
        startTimeMs: [1, 2, 5],
        endTimeMs: [2, 3, 4]
      }),
      {chunkKey: 'invalid-rows'}
    );

    expect(chunk.spanTable.numRows).toBe(1);
    expect(chunk.diagnostics).toMatchObject({rowCount: 1, invalidRecordCount: 2});
  });

  it('projects declared primitive span attributes from aligned source rows', () => {
    const chunk = buildTracePhysicalSpanChunk(
      createColumns({
        spanAttributeRows: [{trace_id: 'trace-a'}, {trace_id: 'trace-b'}, {trace_id: 'trace-c'}]
      }),
      {
        chunkKey: 'declared-attributes',
        declaredSpanAttributePaths: [['trace_id']]
      }
    );
    const traceIdColumnIndex = chunk.spanTable.schema.fields.findIndex(
      field => field.name === 'trace_id'
    );
    const traceIdColumn = chunk.spanTable.getChildAt(traceIdColumnIndex);

    expect(traceIdColumn?.get(0)).toBe('trace-a');
    expect(traceIdColumn?.get(1)).toBe('trace-b');
    expect(traceIdColumn?.get(2)).toBe('trace-c');
  });

  it('builds large column batches without source row objects', () => {
    const rowCount = 20_000;
    const chunk = buildTracePhysicalSpanChunk(
      {
        externalSpanIds: Array.from({length: rowCount}, (_, index) => `span-${index}`),
        parentExternalSpanIds: Array.from({length: rowCount}, (_, index) =>
          index === 0 ? null : `span-${index - 1}`
        ),
        processIds: Array(rowCount).fill('pod-a:10'),
        processNames: Array(rowCount).fill('pod-a / 10'),
        threadIds: Array(rowCount).fill('pod-a:10:1'),
        names: Array(rowCount).fill('work'),
        startTimeMs: Array.from({length: rowCount}, (_, index) => index),
        endTimeMs: Array.from({length: rowCount}, (_, index) => index + 1)
      },
      {chunkKey: 'large-batch'}
    );

    expect(chunk.spanTable.numRows).toBe(rowCount);
    expect(chunk.sourceDependencyTable?.numRows).toBe(rowCount - 1);
    expect(chunk.diagnostics.invalidRecordCount).toBe(0);
  });
});
