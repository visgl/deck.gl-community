import {describe, expect, it} from 'vitest';

import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  buildTraceLayout,
  createStaticTraceGraphRuntimeSource,
  TraceGraph
} from '../../trace/index';
import {
  getTraceLayoutBlockGeometry,
  getTraceLayoutCrossDependencyGeometry,
  getTraceLayoutLocalDependencyGeometry,
  getTraceLayoutPathDependencyGeometry,
  getTraceLayoutSelectedCrossDependencyGeometry,
  getTraceLayoutSelectedLocalDependencyGeometry
} from './trace-layout-geometry';

import type {
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceGraphPathDependencySource,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace/index';

const settings: TraceVisSettings = {
  showDependencies: true,
  localDependencyMode: 'all',
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
  traceRunSummaryAggregationKey: 'latest',
  showEmptyProcesses: false
};

describe('trace-layout-geometry', () => {
  it('derives span, local dependency, cross dependency, and path geometry from lane layout', () => {
    const graph = createGeometryTraceGraph();
    const layout = buildTraceLayout({traceGraph: graph, settings});
    const localDependencyRef = graph.getVisibleLocalDependencyRefs(graph.getProcessRefs()[0]!)[0]!;
    const crossDependencyRef = graph.getVisibleCrossDependencySources()[0]!.dependencyRef!;
    const startSpanRef = graph.getSpanRefByExternalBlockId('rank-a-parent' as TraceSpanId)!;
    const localDependency = graph.getVisibleDependencySourceByRef(localDependencyRef)!;
    const crossDependency = graph.getVisibleDependencySourceByRef(
      crossDependencyRef
    ) as TraceCrossProcessDependency;

    const blockGeometry = getTraceLayoutBlockGeometry({
      traceLayout: layout,
      block: {spanRef: startSpanRef}
    });
    const localGeometry = getTraceLayoutLocalDependencyGeometry({
      traceLayout: layout,
      dependency: localDependency as TraceLocalDependency
    });
    const crossGeometry = getTraceLayoutCrossDependencyGeometry({
      traceLayout: layout,
      dependency: crossDependency
    });
    const selectedLocalGeometry = getTraceLayoutSelectedLocalDependencyGeometry({
      traceLayout: layout,
      dependencyRef: localDependencyRef
    });
    const selectedCrossGeometry = getTraceLayoutSelectedCrossDependencyGeometry({
      traceLayout: layout,
      dependencyRef: crossDependencyRef
    });
    const pathGeometry = getTraceLayoutPathDependencyGeometry({
      traceLayout: layout,
      source: {
        dependency: crossDependency,
        dependencyRef: crossDependencyRef
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
  const localDependencyId = 'local-parent-child' as TraceDependencyId;
  const localDependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: localDependencyId,
    startSpanId: rankA.spans[0]!.spanId,
    endSpanId: rankA.spans[1]!.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1
  };
  rankA.spans[0]!.localDependencyIds = [localDependencyId];
  rankA.spans[0]!.localDependencies = [localDependency];
  rankA.localDependencies = [localDependency];
  const crossDependency: TraceCrossProcessDependency = {
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
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: 'trace-layout-geometry:test',
      traceGraphData: buildTraceGraphDataFromJSONTrace(
        buildJSONTrace([rankA, rankB], [crossDependency], {name: 'trace-layout-geometry'})
      )
    })
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
    localDependencies: [],
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
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
