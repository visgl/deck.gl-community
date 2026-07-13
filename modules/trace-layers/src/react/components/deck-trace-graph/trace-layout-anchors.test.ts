import {describe, expect, it} from 'vitest';

import {buildJSONTrace, buildTraceLayout, TraceGraph} from '../../../trace';
import {createRuntimeTraceGraph} from '../../../trace/trace-graph/trace-graph-test-fixtures';
import {findTraceLayoutSpanAnchor, getTraceLayoutSpanAnchorDeltaY} from './trace-layout-anchors';

import type {
  SpanRef,
  TraceLayout,
  TraceProcess,
  TraceSpan,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../../trace';

const settings: TraceVisSettings = {
  showDependencies: true,
  sameProcessDependencyMode: 'all',
  showCrossProcessDependencies: true,
  showInstants: false,
  showCounters: false,
  showGlobalEvents: false,
  transitions: false,
  showPathsOnly: false,
  showOverview: true,
  dependencyDisplayMode: 'all',
  dependencyKeywords: [],
  dependencyOpacity: 0.1,
  minSpanTimeMs: 0,
  threadDisplayMode: 'all',
  selectedThreadNames: [],
  sortThreads: false,
  lineRoutingMode: 'straight',
  layoutDensity: 'comfortable',
  processLayoutMode: 'interleaved',
  trackAggregationMode: 'separate-threads',
  traceOffsetMs: 0,
  traceScale: 1,
  traceColorSchemeId: 'processes',
  traceTimingKey: 'latest',
  showEmptyProcesses: false
};

describe('trace layout anchors', () => {
  it('computes positive and negative span anchor deltas between layouts', () => {
    const {spanRef, lowerLayout, higherLayout} = createAnchorLayouts();

    expect(
      getTraceLayoutSpanAnchorDeltaY({
        previousTraceLayouts: [higherLayout],
        nextTraceLayouts: [lowerLayout],
        spanRef
      })
    ).toBe(20);
    expect(
      getTraceLayoutSpanAnchorDeltaY({
        previousTraceLayouts: [lowerLayout],
        nextTraceLayouts: [higherLayout],
        spanRef
      })
    ).toBe(-20);
  });

  it('returns null when either layout cannot resolve the anchor span', () => {
    const {spanRef, lowerLayout, higherLayout} = createAnchorLayouts();
    const missingSpanRef = (spanRef + 1) as SpanRef;

    expect(
      getTraceLayoutSpanAnchorDeltaY({
        previousTraceLayouts: [higherLayout],
        nextTraceLayouts: [lowerLayout],
        spanRef: missingSpanRef
      })
    ).toBeNull();
  });

  it('resolves span center anchors from derived lane geometry', () => {
    const {spanRef, higherLayout} = createAnchorLayouts();

    expect(findTraceLayoutSpanAnchor({traceLayouts: [higherLayout], spanRef})).toEqual({
      kind: 'span',
      spanRef,
      centerY: 10
    });
  });
});

function createAnchorLayouts(): {
  spanRef: SpanRef;
  lowerLayout: TraceLayout;
  higherLayout: TraceLayout;
} {
  const traceGraph = createAnchorTraceGraph();
  const spanRef = Array.from(
    traceGraph.iterateVisibleSpanRefsByProcess(traceGraph.getProcessRefs()[0]!)
  ).at(0)!;
  const baseLayout = buildTraceLayout({traceGraph, settings});
  return {
    spanRef,
    lowerLayout: moveSpanLane(baseLayout, spanRef, 30),
    higherLayout: moveSpanLane(baseLayout, spanRef, 10)
  };
}

function moveSpanLane(layout: TraceLayout, spanRef: SpanRef, laneY: number): TraceLayout {
  const threadRef = layout.traceGraph.getThreadRefBySpanRef(spanRef)!;
  const processRef = layout.traceGraph.getProcessRefBySpanRef(spanRef)!;
  const threadLayout = layout.threadLayoutMapByRef.get(threadRef)!;
  const movedThreadLayout = {
    ...threadLayout,
    yPosition: laneY,
    lanes: threadLayout.lanes
      ? {...threadLayout.lanes, laneYPositions: [laneY]}
      : threadLayout.lanes
  };
  const movedProcessLayout = {
    ...layout.processLayoutMapByRef.get(processRef)!,
    threadLayouts: [movedThreadLayout]
  };
  return {
    ...layout,
    processLayouts: [movedProcessLayout],
    processLayoutMapByRef: new Map([[processRef, movedProcessLayout]]),
    threadLayoutMapByRef: new Map([[threadRef, movedThreadLayout]])
  };
}

function createAnchorTraceGraph(): TraceGraph {
  const thread = {
    type: 'trace-thread',
    name: 'anchor-thread',
    threadId: 'anchor-thread' as TraceThreadId,
    processId: 'rank-a'
  } satisfies TraceThread;
  const span = createAnchorSpan(thread);
  const process = {
    type: 'trace-process',
    processId: 'rank-a',
    name: 'rank-a',
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [span],
    spanMap: {[span.spanId]: span},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [],
    remoteDependencies: []
  } satisfies TraceProcess;
  return createRuntimeTraceGraph(buildJSONTrace([process], [], {name: 'trace-layout-anchors'}));
}

function createAnchorSpan(thread: TraceThread): TraceSpan {
  return {
    type: 'trace-span',
    spanId: 'anchor-span' as TraceSpan['spanId'],
    threadId: thread.threadId,
    processName: thread.processId,
    name: 'anchor-span',
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 10,
        durationMs: 10,
        durationMsAsString: '10ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
