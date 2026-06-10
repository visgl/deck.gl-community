import {describe, expect, it, vi} from 'vitest';

import {buildTraceGraphData} from '../ingestion/arrow-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from './trace-graph';
import {TRACE_SPAN_FILTER_MASK_NONE, TRACE_SPAN_FILTER_MASK_SOURCE} from './trace-graph-types';
import {encodeSpanRef} from './trace-id-encoder';

function createTestTraceGraph(
  traceGraphData: Parameters<typeof createStaticTraceGraphRuntimeSource>[0]['traceGraphData'],
  options?: ConstructorParameters<typeof TraceGraph>[1]
): TraceGraph {
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: `${traceGraphData.name}:test`,
      traceGraphData
    }),
    options
  );
}

describe('TraceGraph span filter reasons', () => {
  it('treats span refs missing from the current graph as filtered with store availability', () => {
    const spanRef = encodeSpanRef(7, 3);
    const traceStore = {
      getSpanRefAvailability: vi.fn(() => 'outside-window' as const),
      hasActiveSourceSpanFilter: vi.fn(() => false),
      isFiltered: vi.fn(() => false),
      getFilterReason: vi.fn(() => ({
        filterMask: TRACE_SPAN_FILTER_MASK_NONE,
        isFiltered: false,
        state: 'outside-window' as const
      }))
    };
    const traceGraphData = buildTraceGraphData({
      name: 'empty-window',
      processes: [],
      crossDependencies: [],
      spanTableMap: {}
    });
    const traceGraph = new TraceGraph({traceGraphData, traceStore});

    expect(traceGraph.spanIsFiltered(spanRef)).toBe(true);
    expect(traceGraph.spanFilterReason(spanRef)).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_NONE,
      isFiltered: true,
      state: 'outside-window'
    });
    expect(traceStore.getFilterReason).toHaveBeenCalledWith(spanRef);
  });

  it('reports unknown for span refs missing from graphs without a trace store', () => {
    const traceGraph = createTestTraceGraph(
      buildTraceGraphData({
        name: 'empty-plain-graph',
        processes: [],
        crossDependencies: [],
        spanTableMap: {}
      })
    );

    expect(traceGraph.spanFilterReason(encodeSpanRef(7, 3))).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_NONE,
      isFiltered: true,
      state: 'unknown'
    });
  });

  it('attributes store-owned filename filters for kept spans missing from the current graph', () => {
    const spanRef = encodeSpanRef(7, 3);
    const traceStore = {
      getSpanRefAvailability: vi.fn(() => 'outside-window' as const),
      hasActiveSourceSpanFilter: vi.fn(() => true),
      isFiltered: vi.fn(() => true),
      getFilterReason: vi.fn(() => ({
        filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
        isFiltered: true,
        state: 'outside-window' as const
      }))
    };
    const traceGraphData = buildTraceGraphData({
      name: 'empty-window-with-filters',
      processes: [],
      crossDependencies: [],
      spanTableMap: {}
    });
    const traceGraph = new TraceGraph(
      {
        traceGraphData,
        traceStore
      },
      {
        spanFilters: ['projects/runtime']
      }
    );

    expect(
      traceGraph.spanFilterReason(spanRef, {
        spanName: 'hidden-target'
      })
    ).toEqual({
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
      isFiltered: true,
      state: 'outside-window'
    });
  });
});
