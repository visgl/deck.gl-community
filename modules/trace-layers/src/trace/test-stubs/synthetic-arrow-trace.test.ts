import {describe, expect, it} from 'vitest';

import {buildTraceDatasetFromReadyTraceChunks} from '../trace-chunk-graph-assembler';
import {iterateTraceGraphSpanRefs} from '../trace-graph-accessors';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';
import {buildTraceViewSnapshot} from '../trace-view-snapshot';
import {
  buildSyntheticArrowTraceFixture,
  SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME
} from './synthetic-arrow-trace';

describe('buildSyntheticArrowTraceFixture', () => {
  it('builds deterministic 10k-row Arrow smoke data without checked-in trace assets', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'synthetic-arrow-trace-smoke',
      processCount: 4,
      rowCount: 10_000,
      textFilterMatchEvery: 1_000,
      threadsPerProcess: 4
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'synthetic-arrow-trace-smoke',
      ...fixture.materializationInputs
    });
    const traceGraph = new TraceGraph({traceDataset, traceStore: fixture.traceStore});
    const traceViewSnapshot = buildTraceViewSnapshot(traceDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });

    expect(traceDataset.revision).toBe(0);
    expect(traceDataset.stats.spanCount).toBe(fixture.summary.spanCount);
    expect(traceDataset.stats.processCount).toBe(fixture.summary.processCount);
    expect(traceDataset.stats.threadCount).toBe(fixture.summary.threadCount);
    expect(traceDataset.stats.sameProcessDependencyCount).toBe(
      fixture.summary.sameProcessDependencyCount
    );
    expect(traceDataset.timeExtents.minTimeMs).toBe(fixture.summary.minTimeMs);
    expect(traceDataset.timeExtents.maxTimeMs).toBe(fixture.summary.maxTimeMs);
    expect(traceViewSnapshot.filteredSpanCount).toBe(fixture.summary.textFilterMatchCount);
    expect(traceDataset.spanRefs).toBeUndefined();
    const spanRefs = Array.from(iterateTraceGraphSpanRefs(traceGraph));
    expect(spanRefs).toHaveLength(fixture.summary.spanCount);
    expect(spanRefs[0]).toBe(encodeSpanRef(0, 0));
    expect(spanRefs.at(-1)).toBe(encodeSpanRef(3, 2_499));
    expect(Number(traceDataset.chunks[3]?.spanTable.getChild('process_ref')?.get(0))).toBe(
      encodeProcessRef(3)
    );
    expect(Number(traceDataset.chunks[3]?.spanTable.getChild('thread_ref')?.get(0))).toBe(
      encodeProcessThreadRef(3, 0)
    );
    expect(
      Number(
        traceDataset.chunks[3]?.resolvedSameProcessDependencyTable.getChild('startSpanRef')?.get(0)
      )
    ).toBe(encodeSpanRef(3, 0));
    expect(traceDataset.chunks.map(chunk => chunk.spanTable.numRows)).toEqual([
      2_500, 2_500, 2_500, 2_500
    ]);
    fixture.chunks.forEach((chunk, index) => {
      expect(traceDataset.chunks[index]?.spanTable).toBe(chunk.spanTable);
    });
  });
});
