import {describe, expect, it, vi} from 'vitest';

import {buildJSONTrace} from '../ingestion/json-trace';
import {buildTraceViewSnapshot} from '../trace-view-snapshot';
import {TraceGraph} from './trace-graph';
import {
  createDatasetTraceGraphRuntimeSourceForTest,
  createRuntimeTraceGraph,
  createTraceDatasetFromJSONTraceForTest
} from './trace-graph-test-fixtures';
import {TRACE_SPAN_FILTER_MASK_NONE, TRACE_SPAN_FILTER_MASK_SOURCE} from './trace-graph-types';
import {encodeSpanRef} from './trace-id-encoder';

describe('TraceGraph span filter reasons', () => {
  it('treats span refs missing from the current graph as filtered with lookup availability', () => {
    const spanRef = encodeSpanRef(7, 3);
    const traceStore = {
      getSpanRefAvailability: vi.fn(() => 'outside-window' as const)
    };
    const traceDataset = createTraceDatasetFromJSONTraceForTest(
      buildJSONTrace([], [], {name: 'empty-window'})
    );
    const traceGraph = new TraceGraph(
      createDatasetTraceGraphRuntimeSourceForTest(traceDataset, traceStore)
    );

    expect(traceGraph.spanIsFiltered(spanRef)).toBe(true);
    expect(traceGraph.spanFilterReason(spanRef)).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_NONE,
      isFiltered: true,
      state: 'outside-window'
    });
    expect(traceStore.getSpanRefAvailability).toHaveBeenCalledWith(spanRef);
  });

  it('reports unknown for span refs missing from graphs without a trace store', () => {
    const traceGraph = createRuntimeTraceGraph(buildJSONTrace([], [], {name: 'empty-plain-graph'}));

    expect(traceGraph.spanFilterReason(encodeSpanRef(7, 3))).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_NONE,
      isFiltered: true,
      state: 'unknown'
    });
  });

  it('attributes snapshot-owned source filters for rows missing from the current graph', () => {
    const spanRef = encodeSpanRef(7, 3);
    const traceStore = {
      getSpanRefAvailability: vi.fn(() => 'outside-window' as const)
    };
    const traceDataset = createTraceDatasetFromJSONTraceForTest(
      buildJSONTrace([], [], {name: 'empty-window-with-filters'})
    );
    const runtimeSource = createDatasetTraceGraphRuntimeSourceForTest(traceDataset, traceStore);
    const traceGraph = new TraceGraph(
      runtimeSource,
      buildTraceViewSnapshot(runtimeSource.traceDataset, {
        spanFilters: ['projects/runtime']
      })
    );

    expect(
      traceGraph.spanFilterReason(spanRef, {
        spanName: 'hidden-target',
        source: 'projects/runtime/runtime-crates/runtime/invoke.rs'
      })
    ).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
      isFiltered: true,
      state: 'outside-window'
    });
  });
});
