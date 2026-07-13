import {describe, expect, it} from 'vitest';

import {buildJSONTrace, buildTraceLayout, TraceGraph} from '../../trace';
import {createRuntimeTraceGraph} from '../../trace/trace-graph/trace-graph-test-fixtures';
import {
  getTraceLayoutBlockGeometry,
  getTraceLayoutCrossProcessDependencyGeometry,
  getTraceLayoutPathDependencyGeometry,
  getTraceLayoutSameProcessDependencyGeometry,
  getTraceLayoutSelectedCrossProcessDependencyGeometry,
  getTraceLayoutSelectedSameProcessDependencyGeometry
} from './trace-layout-geometry';

import type {
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceGraphPathDependencySource,
  TraceProcess,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace';

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

describe('trace-layout-geometry', () => {
  it('derives span, same-process dependency, cross-process dependency, and path geometry from lane layout', () => {
    const graph = createGeometryTraceGraph();
    const layout = buildTraceLayout({traceGraph: graph, settings});
    const sameProcessDependencyRef = Array.from(
      graph.iterateVisibleSameProcessDependencyRefsByProcess(graph.getProcessRefs()[0]!)
    ).at(0)!;
    const crossProcessDependencyRef = Array.from(
      graph.iterateVisibleCrossProcessDependencyRefs()
    ).flatMap(dependencyRef => {
      const dependency = graph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
    })[0]!.dependencyRef!;
    const startSpanRef = graph.getSpanRefById('rank-a-parent' as TraceSpanId)!;
    const sameProcessDependency = graph.getDependencySource(sameProcessDependencyRef)!;
    const crossProcessDependency = graph.getDependencySource(crossProcessDependencyRef);
    if (crossProcessDependency?.type !== 'trace-cross-process-dependency') {
      throw new Error('Expected cross-process dependency render source');
    }

    const blockGeometry = getTraceLayoutBlockGeometry({
      traceLayout: layout,
      block: {spanRef: startSpanRef}
    });
    const localGeometry = getTraceLayoutSameProcessDependencyGeometry({
      traceLayout: layout,
      dependency: sameProcessDependency as TraceSameProcessDependency
    });
    const crossGeometry = getTraceLayoutCrossProcessDependencyGeometry({
      traceLayout: layout,
      dependency: crossProcessDependency
    });
    const selectedLocalGeometry = getTraceLayoutSelectedSameProcessDependencyGeometry({
      traceLayout: layout,
      dependencyRef: sameProcessDependencyRef
    });
    const selectedCrossGeometry = getTraceLayoutSelectedCrossProcessDependencyGeometry({
      traceLayout: layout,
      dependencyRef: crossProcessDependencyRef
    });
    const pathGeometry = getTraceLayoutPathDependencyGeometry({
      traceLayout: layout,
      source: {
        dependency: crossProcessDependency,
        dependencyRef: crossProcessDependencyRef
      } as TraceGraphPathDependencySource
    });

    expect(blockGeometry?.[3]).toBeGreaterThan(blockGeometry?.[1] ?? 0);
    expect(Array.from(localGeometry ?? [])).toEqual(Array.from(selectedLocalGeometry ?? []));
    expect(Array.from(crossGeometry ?? [])).toEqual(Array.from(selectedCrossGeometry ?? []));
    expect(Array.from(pathGeometry ?? [])).toEqual(Array.from(crossGeometry ?? []));
  });
});

function createGeometryTraceGraph(): TraceGraph {
  const rankA = createProcess('rank-a', 0, ['rank-a-parent', 'rank-a-child']);
  const rankB = createProcess('rank-b', 1, ['rank-b-child']);
  const sameProcessDependencyId = 'local-parent-child' as TraceDependencyId;
  const sameProcessDependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: sameProcessDependencyId,
    startSpanId: rankA.spans[0]!.spanId,
    endSpanId: rankA.spans[1]!.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1
  };
  rankA.spans[0]!.sameProcessDependencyIds = [sameProcessDependencyId];
  rankA.spans[0]!.sameProcessDependencies = [sameProcessDependency];
  rankA.sameProcessDependencies = [sameProcessDependency];
  const crossProcessDependency: TraceCrossProcessDependency = {
    type: 'trace-cross-process-dependency',
    dependencyId: 'cross-parent-child' as TraceDependencyId,
    endpointId: 'cross-parent-child:endpoint' as TraceCrossProcessDependency['endpointId'],
    startRankNum: 0,
    endRankNum: 1,
    startSpanId: rankA.spans[1]!.spanId,
    endSpanId: rankB.spans[0]!.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'cross',
    waitTimeMs: 1,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set()
  };
  return createRuntimeTraceGraph(
    buildJSONTrace([rankA, rankB], [crossProcessDependency], {name: 'trace-layout-geometry'})
  );
}

function createProcess(
  processId: string,
  rankNum: number,
  spanNames: readonly string[]
): TraceProcess {
  const thread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  } satisfies TraceThread;
  const spans = spanNames.map((spanName, index) => createSpan(spanName, thread, index));
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
    sameProcessDependencies: [],
    remoteDependencies: []
  };
}

function createSpan(name: string, thread: TraceThread, index: number): TraceSpan {
  return {
    type: 'trace-span',
    spanId: name as TraceSpanId,
    threadId: thread.threadId,
    processName: thread.processId,
    name,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: index * 2,
        endTimeMs: index * 2 + 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
