import {describe, expect, it} from 'vitest';

import {buildJSONTrace} from '../ingestion/json-trace';
import {TraceGraph} from '../trace-graph/trace-graph';
import {createRuntimeTraceGraph} from '../trace-graph/trace-graph-test-fixtures';
import {
  getTraceGraphEndpointsWithDependencies,
  getTraceGraphSpanDependencies,
  isTraceGraphBlockFiltered
} from '../trace-graph/trace-graph-test-utils';
import {buildTraceLayouts as buildRuntimeTraceLayouts} from '../trace-layout/trace-geometry-layout';

import type {JSONTrace} from '../ingestion/json-trace';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

/** Layout settings needed by these filtering-focused tests. */
type FilteringTraceLayoutSettings = {
  showCrossProcessDependencies: TraceVisSettings['showCrossProcessDependencies'];
  threadDisplayMode: TraceVisSettings['threadDisplayMode'];
  selectedThreadNames: TraceVisSettings['selectedThreadNames'];
  sortThreads: TraceVisSettings['sortThreads'];
  sameProcessDependencyMode: TraceVisSettings['sameProcessDependencyMode'];
  processLayoutMode: TraceVisSettings['processLayoutMode'];
  layoutDensity: TraceVisSettings['layoutDensity'];
  maxVisibleLanesPerThread: TraceVisSettings['maxVisibleLanesPerThread'];
  trackAggregationMode: TraceVisSettings['trackAggregationMode'];
  spanFilter?: TraceVisSettings['spanFilter'];
};

/** Builds trace layouts while accepting either JSON test graphs or Arrow runtime graphs. */
function buildTraceLayouts(params: {
  traceGraphs: readonly (JSONTrace | TraceGraph)[];
  settings: FilteringTraceLayoutSettings;
}) {
  const {spanFilter, ...settings} = params.settings;
  return buildRuntimeTraceLayouts({
    settings,
    traceGraphs: params.traceGraphs.map(traceGraph =>
      normalizeTraceGraphSource(traceGraph, spanFilter)
    )
  });
}

/** Creates a cross-rank dependency for filtering and contraction tests. */
function createCrossProcessDependency(params: {
  dependencyId: TraceDependencyId;
  startSpanId: TraceSpanId;
  endSpanId: TraceSpanId;
  startRankNum: number;
  endRankNum: number;
  waitMode?: 'end-to-start' | 'end-to-end' | 'start-to-start';
  topology?: string;
  keywords?: TraceCrossProcessDependency['keywords'];
}): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: params.dependencyId,
    endpointId: `${params.dependencyId}:endpoint` as TraceCrossProcessEndpointId,
    startRankNum: params.startRankNum,
    endRankNum: params.endRankNum,
    startSpanId: params.startSpanId,
    endSpanId: params.endSpanId,
    waitMode: params.waitMode ?? 'start-to-start',
    bidirectional: false,
    topology: params.topology ?? 'cross',
    waitTimeMs: 0,
    waiting: false,
    waitNotFinished: false,
    keywords: params.keywords ?? new Set()
  };
}

/** Builds a single-thread rank with named spans for span-filtering tests. */
function createRankWithNamedBlocks(
  processId: string,
  blockNames: string[],
  options?: {sources?: readonly string[]; rankNum?: number}
): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-stream`,
    threadId: `${processId}-stream` as TraceThreadId,
    processId
  };

  const spans: TraceSpan[] = blockNames.map((name, index) => ({
    type: 'trace-span',
    spanId: `${processId}-span-${index}` as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name,
    keywords: [],
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs: index,
        endTimeMs: index + 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    ...(options?.sources?.[index] !== undefined
      ? {userData: {source: options.sources[index]!}}
      : {})
  }));

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: options?.rankNum ?? 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as {
      [spanId: string]: TraceSpan;
    },
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [],
    remoteDependencies: []
  } satisfies TraceProcess;
}

/** Adds a same-process dependency to a test rank and updates endpoint span ids. */
function addSameProcessDependency(
  rank: TraceProcess,
  params: {
    dependencyId: TraceDependencyId;
    startSpanId: TraceSpanId;
    endSpanId: TraceSpanId;
    keywords?: TraceProcess['sameProcessDependencies'][number]['keywords'];
  }
): TraceProcess {
  const sameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: params.dependencyId,
    startSpanId: params.startSpanId,
    endSpanId: params.endSpanId,
    keywords: params.keywords ?? new Set<string>(),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  } satisfies TraceProcess['sameProcessDependencies'][number];

  const spans = rank.spans.map(span =>
    span.spanId === sameProcessDependency.startSpanId ||
    span.spanId === sameProcessDependency.endSpanId
      ? {
          ...span,
          sameProcessDependencyIds: [
            ...span.sameProcessDependencyIds,
            sameProcessDependency.dependencyId
          ]
        }
      : span
  );

  return {
    ...rank,
    sameProcessDependencies: [...rank.sameProcessDependencies, sameProcessDependency],
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as {
      [spanId: string]: TraceSpan;
    }
  } satisfies TraceProcess;
}

/** Normalizes plain test traces to canonical runtime graphs before layout. */
function normalizeTraceGraphSource(
  traceGraph: JSONTrace | TraceGraph,
  spanFilter?: TraceVisSettings['spanFilter']
): TraceGraph {
  if (traceGraph instanceof TraceGraph) {
    return traceGraph;
  }
  return createRuntimeTraceGraph(traceGraph, {
    spanFilters: spanFilter ? [spanFilter] : undefined
  });
}

/** Requires a layout to retain its TraceGraph instance. */
function requireTraceGraph(layout: {traceGraph?: TraceGraph}) {
  expect(layout.traceGraph).toBeDefined();
  return layout.traceGraph!;
}

/** Returns visible spans after applying the layout's TraceGraph filtering state. */
function getVisibleBlocks(spans: readonly TraceSpan[], traceGraph: TraceGraph): TraceSpan[] {
  return spans.filter(span => !isTraceGraphBlockFiltered(traceGraph, span));
}

const baseSettings: FilteringTraceLayoutSettings = {
  showCrossProcessDependencies: true,
  threadDisplayMode: 'all',
  selectedThreadNames: undefined,
  sortThreads: false,
  sameProcessDependencyMode: 'all',
  processLayoutMode: 'interleaved',
  layoutDensity: 'comfortable',
  maxVisibleLanesPerThread: undefined,
  trackAggregationMode: 'separate-threads'
};

describe('buildTraceLayouts filtering', () => {
  it('filters spans by delimiter-separated literal prefixes', () => {
    const rank = createRankWithNamedBlocks('filter-names', [
      'executeRpc',
      'fetchQuery',
      'renderUi'
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-list'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'executeRpc;\nfetchQuery, keepMe'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleBlocks(rank.spans, traceGraph).map(span => span.name)).toEqual(['renderUi']);
  });

  it('treats plain span filter entries as literal prefix patterns', () => {
    const rank = createRankWithNamedBlocks('filter-prefix', [
      'rpc.request_worker',
      'other_rpc.request',
      'rpc'
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-prefix'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'rpc.request_'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleBlocks(rank.spans, traceGraph).map(span => span.name)).toEqual([
      'other_rpc.request',
      'rpc'
    ]);
  });

  it('filters spans by userData.source prefix', () => {
    const rank = createRankWithNamedBlocks(
      'filter-source',
      ['executeRpc', 'fetchQuery', 'renderUi'],
      {
        sources: [
          'packages/distributed_tracing/base.py',
          '/workspace/src/runtime/core/rpc_runtime.py',
          'other/file.py'
        ]
      }
    );
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-source'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        spanFilter:
          'packages/distributed_tracing/base.py;/workspace/src/runtime/core/rpc_runtime.py'
      }
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleBlocks(rank.spans, traceGraph).map(span => span.name)).toEqual(['renderUi']);
  });

  it('supports regular-expression span filters', () => {
    const rank = createRankWithNamedBlocks('filter-regex', [
      'executeRpc-1',
      'executeRpc-2',
      'other'
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-regex'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: '/^executeRpc-\\d+$/'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleBlocks(rank.spans, traceGraph).map(span => span.name)).toEqual(['other']);
  });

  it('drops a cross parent dependency when the filtered child has no visible descendant', () => {
    const rankA = createRankWithNamedBlocks('rank-a', ['head-root'], {rankNum: 0});
    const rankB = createRankWithNamedBlocks('rank-b', ['filtered-leaf'], {rankNum: 1});
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:parent-3' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'cross-leaf-drop'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const rootDependencies = getTraceGraphSpanDependencies(traceGraph, rankA.spans[0]!);
    expect(rootDependencies.outDependencies).toHaveLength(0);
  });

  it('does not promote non-parent same process dependencies across ranks', () => {
    const rankA = createRankWithNamedBlocks('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createRankWithNamedBlocks('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addSameProcessDependency(rankBBase, {
      dependencyId: 'rank-b:dep-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId
    });
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:parent-4' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'non-parent-local'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getTraceGraphSpanDependencies(traceGraph, rankB.spans[1]!);
    expect(logicalChildDependencies.inDependencies).toHaveLength(0);
  });

  it('preserves unresolved cross-rank endpoints when filtering spans', () => {
    const rank = createRankWithNamedBlocks('rank-a', ['visible-span', 'filtered-span'], {
      rankNum: 0
    });
    const unresolvedEndpointId = 'endpoint:unresolved' as TraceCrossProcessEndpointId;
    const unresolvedEndpoint = {
      type: 'cross-process-dependency-endpoint',
      endpointId: unresolvedEndpointId,
      spanId: rank.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 7,
      islandNum: 0,
      waitTimeMs: 12,
      waiting: true,
      waitNotFinished: false
    } satisfies TraceSpan['crossProcessDependencyEndpoints'][number];

    rank.spans[0] = {
      ...rank.spans[0]!,
      crossProcessEndpointId: unresolvedEndpointId,
      crossProcessDependencyEndpoints: [unresolvedEndpoint]
    };
    rank.spanMap[rank.spans[0]!.spanId] = rank.spans[0]!;

    const graph = buildJSONTrace([rank], [], {name: 'preserve-unresolved-endpoint'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const endpointsWithDeps = getTraceGraphEndpointsWithDependencies(traceGraph, rank.spans[0]!);
    expect(endpointsWithDeps).toHaveLength(1);
    expect(endpointsWithDeps[0]?.[0]).toMatchObject({
      endpointId: unresolvedEndpointId,
      endRankNum: 7,
      waiting: true
    });
    expect(endpointsWithDeps[0]?.[1]).toBeNull();
  });
});
