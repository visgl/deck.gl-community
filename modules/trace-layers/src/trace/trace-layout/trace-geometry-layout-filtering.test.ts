import {describe, expect, it} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  getRequiredVisibleCrossDependencyRefById,
  getTraceGraphEndpointsWithDependencies,
  getTraceGraphSpanDependencies,
  getTraceGraphVisibleDependencyChainForBlock,
  isTraceGraphBlockFiltered
} from '../trace-graph/trace-graph-test-utils';
import {buildTraceLayouts as buildRuntimeTraceLayouts} from '../trace-layout/trace-geometry-layout';
import {fillTraceLayoutCrossDependencyGeometry} from '../trace-layout/trace-layout';

import type {TraceGraphData} from '../ingestion/arrow-trace';
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
  localDependencyMode: TraceVisSettings['localDependencyMode'];
  processLayoutMode: TraceVisSettings['processLayoutMode'];
  layoutDensity: TraceVisSettings['layoutDensity'];
  maxVisibleLanesPerThread: TraceVisSettings['maxVisibleLanesPerThread'];
  trackAggregationMode: TraceVisSettings['trackAggregationMode'];
  spanFilter?: TraceVisSettings['spanFilter'];
};

/** Builds trace layouts while accepting either JSON test graphs or Arrow runtime graphs. */
function buildTraceLayouts(params: {
  traceGraphs: readonly (JSONTrace | TraceGraphData)[];
  settings: FilteringTraceLayoutSettings;
}) {
  return buildRuntimeTraceLayouts({
    ...params,
    traceGraphs: params.traceGraphs.map(normalizeTraceGraphSource)
  });
}

/** Creates a cross-rank dependency for filtering and contraction tests. */
function createCrossDependency(params: {
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
    localDependencyIds: [],
    localDependencies: [],
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
    localDependencies: [],
    remoteDependencies: []
  } satisfies TraceProcess;
}

/** Adds a local dependency to a test rank and updates endpoint span ids. */
function addLocalDependency(
  rank: TraceProcess,
  params: {
    dependencyId: TraceDependencyId;
    startSpanId: TraceSpanId;
    endSpanId: TraceSpanId;
    keywords?: TraceProcess['localDependencies'][number]['keywords'];
  }
): TraceProcess {
  const localDependency = {
    type: 'trace-local-dependency',
    dependencyId: params.dependencyId,
    startSpanId: params.startSpanId,
    endSpanId: params.endSpanId,
    keywords: params.keywords ?? new Set<string>(),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  } satisfies TraceProcess['localDependencies'][number];

  const spans = rank.spans.map(span =>
    span.spanId === localDependency.startSpanId || span.spanId === localDependency.endSpanId
      ? {
          ...span,
          localDependencyIds: [...span.localDependencyIds, localDependency.dependencyId]
        }
      : span
  );

  return {
    ...rank,
    localDependencies: [...rank.localDependencies, localDependency],
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as {
      [spanId: string]: TraceSpan;
    }
  } satisfies TraceProcess;
}

/** Builds a parent chain over named spans for visible-ancestor filtering tests. */
function createRankWithParentChain(processId: string, blockNames: string[]): TraceProcess {
  const rank = createRankWithNamedBlocks(processId, blockNames);
  const localDependencies: TraceProcess['localDependencies'] = [];

  for (let index = 1; index < rank.spans.length; index += 1) {
    const parentBlock = rank.spans[index - 1]!;
    const childBlock = rank.spans[index]!;
    const dependencyId = `${processId}:parent-${index}` as TraceDependencyId;
    const dependency: TraceProcess['localDependencies'][number] = {
      type: 'trace-local-dependency',
      dependencyId,
      startSpanId: parentBlock.spanId,
      endSpanId: childBlock.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    };

    parentBlock.localDependencyIds.push(dependencyId);
    localDependencies.push(dependency);
  }

  return {
    ...rank,
    localDependencies
  } satisfies TraceProcess;
}

/** Normalizes plain JSON traces to Arrow runtime trace sources. */
function normalizeTraceGraphSource(traceGraph: JSONTrace | TraceGraphData): TraceGraphData {
  return 'processSpanTableMap' in traceGraph
    ? traceGraph
    : buildTraceGraphDataFromJSONTrace(traceGraph);
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
  localDependencyMode: 'all',
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
        sources: ['packages/tracing/base.py', '/workspace/runtime/rpc_runtime.py', 'other/file.py']
      }
    );
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-source'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        spanFilter: 'packages/tracing/base.py;/workspace/runtime/rpc_runtime.py'
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

  it('rewires parent dependencies to the nearest visible ancestor', () => {
    const rank = createRankWithParentChain('filter-ancestor', [
      'rpc-root',
      'filtered-parent',
      'filtered-child',
      'child-leaf'
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-ancestor'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleBlocks(rank.spans, traceGraph).map(span => span.name)).toEqual([
      'rpc-root',
      'child-leaf'
    ]);

    const visibleParentChain = getTraceGraphVisibleDependencyChainForBlock(
      traceGraph,
      rank.spans[3]!,
      'PARENT'
    );
    expect(visibleParentChain.map(span => span.name)).toEqual(['rpc-root']);

    const childDependencies = getTraceGraphSpanDependencies(traceGraph, rank.spans[3]!);
    expect(childDependencies.localDependencies).toHaveLength(1);
    expect(childDependencies.localDependencies[0]).toMatchObject({
      startSpanId: rank.spans[0]!.spanId,
      endSpanId: rank.spans[3]!.spanId
    });
  });

  it('contracts a mixed cross/local parent chain into a cross dependency', () => {
    const rankA = createRankWithNamedBlocks('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createRankWithNamedBlocks('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:parent-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-1' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'mixed-cross-local'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChild = rankB.spans[1]!;
    const logicalChildDependencies = getTraceGraphSpanDependencies(traceGraph, logicalChild);

    expect(logicalChildDependencies.crossRankDependencies).toHaveLength(1);
    expect(logicalChildDependencies.crossRankDependencies[0]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[1]!.spanId,
      topology: 'parent'
    });
    expect(logicalChildDependencies.localDependencies).toHaveLength(0);

    const endpointsWithDeps = getTraceGraphEndpointsWithDependencies(traceGraph, logicalChild);
    expect(endpointsWithDeps).toHaveLength(1);
    expect(endpointsWithDeps[0]?.[1]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[1]!.spanId
    });
  });

  it('contracts a mixed local/cross parent chain when the filtered node is on the start side of the cross edge', () => {
    const rankABase = createRankWithNamedBlocks('rank-a', ['head-root', 'filtered-head'], {
      rankNum: 0
    });
    const rankA = addLocalDependency(rankABase, {
      dependencyId: 'rank-a:parent-1' as TraceDependencyId,
      startSpanId: rankABase.spans[0]!.spanId,
      endSpanId: rankABase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const rankB = createRankWithNamedBlocks('rank-b', ['logical-child'], {rankNum: 1});
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-2' as TraceDependencyId,
      startSpanId: rankA.spans[1]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'mixed-local-cross'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getTraceGraphSpanDependencies(traceGraph, rankB.spans[0]!);

    expect(logicalChildDependencies.crossRankDependencies).toHaveLength(1);
    expect(logicalChildDependencies.crossRankDependencies[0]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      topology: 'parent'
    });
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraph, rankB.spans[0]!, 'PARENT').map(
        span => span.name
      )
    ).toEqual(['head-root']);
  });

  it('drops a cross parent dependency when the filtered child has no visible descendant', () => {
    const rankA = createRankWithNamedBlocks('rank-a', ['head-root'], {rankNum: 0});
    const rankB = createRankWithNamedBlocks('rank-b', ['filtered-leaf'], {rankNum: 1});
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-3' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'cross-leaf-drop'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const rootDependencies = getTraceGraphSpanDependencies(traceGraph, rankA.spans[0]!);
    expect(rootDependencies.outDependencies).toHaveLength(0);
  });

  it('does not promote non-parent local dependencies across ranks', () => {
    const rankA = createRankWithNamedBlocks('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createRankWithNamedBlocks('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:dep-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-4' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'non-parent-local'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getTraceGraphSpanDependencies(traceGraph, rankB.spans[1]!);
    expect(logicalChildDependencies.inDependencies).toHaveLength(0);
  });

  it('deduplicates stitched parent edges that collapse to the same visible endpoints', () => {
    const rankA = createRankWithNamedBlocks('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createRankWithNamedBlocks(
      'rank-b',
      ['filtered-parent', 'logical-child', 'logical-child-2'],
      {rankNum: 1}
    );
    const rankBWithChildOne = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:parent-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const rankB = addLocalDependency(rankBWithChildOne, {
      dependencyId: 'rank-b:parent-2' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[2]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const crossDependencies = [
      createCrossDependency({
        dependencyId: 'cross:parent-5' as TraceDependencyId,
        startSpanId: rankA.spans[0]!.spanId,
        endSpanId: rankB.spans[0]!.spanId,
        startRankNum: 0,
        endRankNum: 1,
        topology: 'parent',
        keywords: new Set(['PARENT'])
      }),
      createCrossDependency({
        dependencyId: 'cross:parent-6' as TraceDependencyId,
        startSpanId: rankA.spans[0]!.spanId,
        endSpanId: rankB.spans[1]!.spanId,
        startRankNum: 0,
        endRankNum: 1,
        topology: 'parent',
        keywords: new Set(['PARENT'])
      })
    ];

    const graph = buildJSONTrace([rankA, rankB], crossDependencies, {name: 'dedup-parent'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered-parent|logical-child-2'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getTraceGraphSpanDependencies(traceGraph, rankB.spans[1]!);

    expect(logicalChildDependencies.crossRankDependencies).toHaveLength(1);
    expect(logicalChildDependencies.crossRankDependencies[0]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[1]!.spanId
    });
  });

  it('preserves geometry for stitched cross parent edges', () => {
    const rankA = createRankWithNamedBlocks('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createRankWithNamedBlocks('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:parent-3' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-7' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'geometry-parent'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const stitchedDependency = getTraceGraphSpanDependencies(traceGraph, rankB.spans[1]!)
      .crossRankDependencies[0];
    const stitchedDependencyRef =
      stitchedDependency?.dependencyId == null
        ? undefined
        : getRequiredVisibleCrossDependencyRefById(traceGraph, stitchedDependency.dependencyId);
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    const hasGeometry =
      stitchedDependencyRef != null &&
      fillTraceLayoutCrossDependencyGeometry({
        traceLayout: layout!,
        dependencyRef: stitchedDependencyRef,
        target: geometry
      });
    expect(hasGeometry).toBe(true);
    if (!hasGeometry) {
      throw new Error('Expected stitched cross dependency geometry');
    }
    expect(geometry.x1).toBe(rankA.spans[0]!.timings.test.startTimeMs - traceGraph.minTimeMs);
    expect(geometry.x2).toBe(rankB.spans[1]!.timings.test.startTimeMs - traceGraph.minTimeMs);
    expect([geometry.x1, geometry.y1, geometry.x2, geometry.y2].every(Number.isFinite)).toBe(true);
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
