import {describe, expect, it} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from '../trace-graph/trace-graph';
import {getRequiredThreadRef} from '../trace-graph/trace-graph-test-utils';
import {
  buildTraceLayoutForSpanRefs,
  buildTraceLayouts
} from '../trace-layout/trace-geometry-layout';
import {fillTraceLayoutSpanGeometry} from '../trace-layout/trace-layout';

import type {ProcessRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceLayout} from '../trace-layout/trace-layout';

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

describe('buildTraceLayoutForSpanRefs focused selection layout', () => {
  const baseSettings: Pick<
    TraceVisSettings,
    | 'localDependencyMode'
    | 'layoutDensity'
    | 'sortThreads'
    | 'maxVisibleLanesPerThread'
    | 'maxVisibleLanesUnlimited'
    | 'trackAggregationMode'
    | 'showCrossProcessDependencies'
    | 'threadDisplayMode'
    | 'selectedThreadNames'
    | 'processLayoutMode'
    | 'spanFilter'
  > = {
    showCrossProcessDependencies: true,
    threadDisplayMode: 'all',
    selectedThreadNames: undefined,
    sortThreads: false,
    localDependencyMode: 'all',
    processLayoutMode: 'interleaved',
    layoutDensity: 'comfortable',
    maxVisibleLanesPerThread: undefined,
    maxVisibleLanesUnlimited: undefined,
    trackAggregationMode: 'separate-threads',
    spanFilter: ''
  };

  it('hides processes with no focused spans and preserves selected process row metadata', () => {
    const unselectedRank = createRankWithSpans('rank-unselected', 0, [{start: 20, end: 21}]);
    const selectedRank = createRankWithSpans('rank-selected', 1, [
      {start: 0, end: 20},
      {start: 1, end: 19},
      {start: 2, end: 18}
    ]);
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([unselectedRank, selectedRank], [], {name: 'focused-process-filter'})
    );
    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: baseSettings
    });
    const selectedSpan = selectedRank.spans[2]!;
    const selectedSpanRef = getLayoutSpanRef(layout, selectedSpan.spanId);
    const selectedProcessRef = getRequiredProcessRef(traceGraph, selectedRank.processId);
    const selectedThreadRef = traceGraph.getThreadRefsByProcessRef(selectedProcessRef)[0];
    const selectedLaneIndex = getLayoutThread(layout, selectedSpan.threadId)?.spanLaneMap?.get(
      selectedSpanRef
    );

    const focusedLayout = buildFocusedLayout({
      traceGraph,
      traceLayout: layout,
      spanRefs: [selectedSpanRef]
    });

    expect(selectedLaneIndex).toBeGreaterThan(0);
    const selectedRow = focusedLayout.renderRows.find(
      row => row.processId === selectedRank.processId
    );

    expect(selectedRow).toMatchObject({
      processId: selectedRank.processId,
      processRef: selectedProcessRef,
      name: selectedRank.name,
      rankNum: selectedRank.rankNum
    });
    expect(selectedRow?.threadRefs).toEqual([selectedThreadRef]);
    expect(getLayoutThread(focusedLayout, unselectedRank.threads[0]!.threadId)?.visible).not.toBe(
      true
    );
    expect(
      getLayoutThread(focusedLayout, selectedSpan.threadId)?.lanes?.visibleLaneIndices
    ).toEqual([selectedLaneIndex]);
    expect(
      getLayoutThread(focusedLayout, selectedSpan.threadId)?.lanes?.laneYPositions
    ).toHaveLength(1);
  });

  it('keeps the source layout when focused span refs do not match visible spans', () => {
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace(
        [
          createRankWithSpans('rank-1', 0, [{start: 0, end: 1}]),
          createRankWithSpans('rank-2', 1, [{start: 1, end: 2}])
        ],
        [],
        {name: 'focused-no-match'}
      )
    );
    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: baseSettings
    });

    const focusedLayout = buildFocusedLayout({
      traceGraph,
      traceLayout: layout,
      spanRefs: [999999 as SpanRef]
    });

    expect(focusedLayout).toBe(layout);
  });

  it('filters focused geometry by exact span ref when processes share a span id', () => {
    const sharedSpanId = 'shared-span' as TraceSpanId;
    const unselectedRank = createRankWithSpans('rank-unselected', 0, [
      {start: 0, end: 10, spanId: sharedSpanId}
    ]);
    const selectedRank = createRankWithSpans('rank-selected', 1, [
      {start: 5, end: 15, spanId: sharedSpanId}
    ]);
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([unselectedRank, selectedRank], [], {name: 'focused-ref-exactness'})
    );
    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: baseSettings
    });
    const selectedSpanRef = getProcessSpanRef(traceGraph, selectedRank.processId, sharedSpanId);

    const focusedLayout = buildFocusedLayout({
      traceGraph,
      traceLayout: layout,
      spanRefs: [selectedSpanRef]
    });

    expect(focusedLayout.renderRows.some(row => row.processId === selectedRank.processId)).toBe(
      true
    );
    expect(getLayoutThread(focusedLayout, selectedRank.threads[0]!.threadId)?.visible).toBe(true);
    expect(getLayoutThread(focusedLayout, unselectedRank.threads[0]!.threadId)?.visible).not.toBe(
      true
    );
  });

  it('keeps focused lane geometry on exact thread refs when processes share a thread id', () => {
    const sharedThreadId = 'shared-thread' as TraceThreadId;
    const selectedRank = retargetSingleThreadRankThreadId(
      createRankWithSpans('rank-selected', 0, [
        {start: 0, end: 20},
        {start: 1, end: 19}
      ]),
      sharedThreadId
    );
    const otherRank = retargetSingleThreadRankThreadId(
      createRankWithSpans('rank-other', 1, [{start: 30, end: 31}]),
      sharedThreadId
    );
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([selectedRank, otherRank], [], {name: 'focused-thread-ref-exactness'})
    );
    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: baseSettings
    });
    const selectedSpan = selectedRank.spans[1]!;
    const selectedSpanRef = getProcessSpanRef(
      traceGraph,
      selectedRank.processId,
      selectedSpan.spanId
    );
    const selectedProcessRef = getRequiredProcessRef(traceGraph, selectedRank.processId);
    const selectedThreadRef = traceGraph.getThreadRefsByProcessRef(selectedProcessRef)[0];
    if (selectedThreadRef == null) {
      throw new Error(`Expected thread ref for ${selectedRank.processId}`);
    }

    const focusedLayout = buildFocusedLayout({
      traceGraph,
      traceLayout: layout,
      spanRefs: [selectedSpanRef]
    });
    const selectedThreadLayout = focusedLayout.threadLayoutMapByRef.get(selectedThreadRef);
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};

    expect(selectedThreadLayout?.spanLaneMap?.has(selectedSpanRef)).toBe(true);
    expect(
      fillTraceLayoutSpanGeometry({
        traceLayout: focusedLayout,
        spanRef: selectedSpanRef,
        target: geometry
      })
    ).toBe(true);
    expect(geometry.x2).toBeGreaterThan(geometry.x1);
    expect(geometry.y2).toBeGreaterThan(geometry.y1);
  });

  function buildFocusedLayout(params: {
    traceGraph: TraceGraph;
    traceLayout: TraceLayout;
    spanRefs: readonly SpanRef[];
  }): TraceLayout {
    return buildTraceLayoutForSpanRefs({
      ...params,
      settings: baseSettings
    });
  }

  function createRuntimeTraceGraph(
    traceGraph: Parameters<typeof buildTraceGraphDataFromJSONTrace>[0]
  ) {
    return createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph));
  }

  function createRankWithSpans(
    processId: string,
    rankNum: number,
    spansConfig: ReadonlyArray<{
      start: number;
      end: number;
      /** Optional exact span id for duplicate-id focused-selection cases. */
      spanId?: TraceSpanId;
    }>
  ): TraceProcess {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: `${processId}-stream`,
      threadId: `${processId}-stream` as TraceThreadId,
      processId
    };
    const spans: TraceSpan[] = spansConfig.map((spanConfig, index) => ({
      type: 'trace-span',
      spanId: spanConfig.spanId ?? (`${processId}-span-${index}` as TraceSpanId),
      threadId: thread.threadId,
      processName: processId,
      name: `${processId}-span-${index}`,
      keywords: [],
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: spanConfig.start,
          endTimeMs: spanConfig.end,
          durationMs: spanConfig.end - spanConfig.start,
          durationMsAsString: `${spanConfig.end - spanConfig.start}ms`
        }
      },
      localDependencyIds: [],
      localDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    }));
    return {
      type: 'trace-process',
      processId,
      name: processId,
      rankNum,
      stepNum: 0,
      threads: [thread],
      threadMap: {[thread.threadId]: thread},
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies: [],
      remoteDependencies: []
    } satisfies TraceProcess;
  }

  /** Rewrites one single-thread process to reuse a process-local thread id across processes. */
  function retargetSingleThreadRankThreadId(
    process: TraceProcess,
    threadId: TraceThreadId
  ): TraceProcess {
    const thread = process.threads[0];
    if (!thread) {
      throw new Error(`Expected one thread for ${process.processId}`);
    }
    const retargetedThread = {...thread, threadId} satisfies TraceThread;
    const spans = process.spans.map(span => ({...span, threadId})) satisfies TraceSpan[];

    return {
      ...process,
      threads: [retargetedThread],
      threadMap: {[threadId]: retargetedThread},
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span]))
    } satisfies TraceProcess;
  }

  function getLayoutSpanRef(layout: TraceLayout, spanId: TraceSpanId): SpanRef {
    const spanRef = layout.traceGraph.getSpanRefByExternalBlockId(spanId);
    if (spanRef == null) {
      throw new Error(`Expected span ref for span ${spanId}`);
    }
    return spanRef;
  }

  /** Returns one runtime thread layout by fixture thread id when retained by the layout. */
  function getLayoutThread(layout: TraceLayout, threadId: TraceThreadId) {
    const threadRef = getRequiredThreadRef(layout.traceGraph, threadId);
    return layout.threadLayoutMapByRef.get(threadRef);
  }

  function getRequiredProcessRef(traceGraph: TraceGraph, processId: string): ProcessRef {
    const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
    const processRef =
      processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
    if (processRef == null) {
      throw new Error(`Expected process ref for ${processId}`);
    }
    return processRef;
  }

  /** Returns the exact span ref for a span id inside one process. */
  function getProcessSpanRef(
    traceGraph: TraceGraph,
    processId: string,
    spanId: TraceSpanId
  ): SpanRef {
    const processRef = getRequiredProcessRef(traceGraph, processId);
    const spanRef = traceGraph
      .getVisibleProcessGeometrySources(processRef)
      .find(span => span.spanId === spanId)?.spanRef;
    if (spanRef == null) {
      throw new Error(`Expected span ref for ${processId}:${spanId}`);
    }
    return spanRef;
  }
});
