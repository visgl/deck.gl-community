import {PathStyleExtension} from '@deck.gl/extensions';
import {PathLayer} from '@deck.gl/layers';
import {Matrix4} from '@math.gl/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AnimationLayer} from '@deck.gl-community/infovis-layers';
import {DependencyArrowLayer} from '@deck.gl-community/layers';

import {
  __resetDerivedTraceDataCacheForTests,
  buildJSONTrace,
  buildTraceLayoutRows as buildRuntimeTraceLayoutRows,
  buildTraceLayouts as buildRuntimeTraceLayouts,
  buildTraceGraphDataFromJSONTrace,
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef,
  getMemoizedDerivedTraceData as getRuntimeMemoizedDerivedTraceData,
  getMemoizedTraceLayoutRowEnrichments as getRuntimeMemoizedTraceLayoutRowEnrichments,
  materializeJSONTrace,
  shouldShowLocalDependencyByModeFields,
  TraceGraph
} from '../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../trace/trace-chunk-store';
import {
  buildTraceLayoutCrossDependencyGeometryChunksForTest,
  buildTraceLayoutLocalDependencyGeometryChunksForTest,
  buildTraceLayoutSpanGeometryChunksForTest
} from '../../trace/trace-graph/trace-graph-test-utils';
import {
  buildDeckLayersForInstantsAndCounter,
  buildDeckLayersForLegend as buildRuntimeDeckLayersForLegend,
  buildDeckLayersForTrace as buildRuntimeDeckLayersForTrace
} from './deck-layers';
import {TraceLegendLayer} from './legend-layer';
import {TraceCrossDependencyLayer} from './trace-cross-dependency-layer';
import {TraceProcessLayer} from './trace-process-layer';

import type {
  JSONTrace,
  SpanRef,
  ThreadLayout,
  ThreadRef,
  TraceColorScheme,
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceInstant,
  TraceInstantId,
  TraceLayout,
  TraceLayoutRow,
  TraceLocalDependency,
  TraceProcess,
  TraceProcessActivityInterval,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace/index';
import type {
  BuildDeckLayersForTraceParams,
  TraceDeckLayerHandlers,
  TraceDeckLayerSelection
} from './deck-layers';

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

function getRequiredProcessRef(traceGraph: TraceGraph, processId: string) {
  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  const processRef = processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
  if (processRef == null) {
    throw new Error(`Expected process ref for ${processId}`);
  }
  return processRef;
}

function isJSONTraceLike(traceGraph: unknown): traceGraph is JSONTrace {
  return (
    traceGraph != null &&
    typeof traceGraph === 'object' &&
    'processes' in traceGraph &&
    !('processSpanTableMap' in traceGraph)
  );
}

const runtimeTraceGraphCache = new WeakMap<
  JSONTrace,
  Parameters<typeof buildRuntimeTraceLayouts>[0]['traceGraphs'][number]
>();
const visibleTraceGraphCache = new WeakMap<JSONTrace, TraceGraph>();
const runtimeTraceLayoutCache = new WeakMap<TraceLayout, WeakMap<TraceGraph, TraceLayout>>();

function withRuntimeTraceLayout(layout: TraceLayout, traceGraph: unknown): TraceLayout {
  const normalizedTraceGraph = isJSONTraceLike(traceGraph)
    ? normalizeVisibleTraceGraphSource(traceGraph)
    : isJSONTraceLike(layout.traceGraph)
      ? normalizeVisibleTraceGraphSource(layout.traceGraph)
      : layout.traceGraph;
  if (!(normalizedTraceGraph instanceof TraceGraph)) {
    return layout;
  }
  if (normalizedTraceGraph === layout.traceGraph) {
    return layout;
  }

  let layoutCacheByGraph = runtimeTraceLayoutCache.get(layout);
  if (!layoutCacheByGraph) {
    layoutCacheByGraph = new WeakMap();
    runtimeTraceLayoutCache.set(layout, layoutCacheByGraph);
  }

  const cachedLayout = layoutCacheByGraph.get(normalizedTraceGraph);
  if (cachedLayout) {
    return cachedLayout;
  }

  const normalizedLayout = {
    ...layout,
    traceGraph: normalizedTraceGraph as TraceLayout['traceGraph']
  };
  layoutCacheByGraph.set(normalizedTraceGraph, normalizedLayout);
  return normalizedLayout;
}

function normalizeRuntimeTraceGraphSource(
  traceGraph: Parameters<typeof buildRuntimeTraceLayouts>[0]['traceGraphs'][number] | JSONTrace
): Parameters<typeof buildRuntimeTraceLayouts>[0]['traceGraphs'][number] {
  if (!isJSONTraceLike(traceGraph)) {
    return traceGraph as Parameters<typeof buildRuntimeTraceLayouts>[0]['traceGraphs'][number];
  }

  const cachedTraceGraph = runtimeTraceGraphCache.get(traceGraph);
  if (cachedTraceGraph) {
    return cachedTraceGraph;
  }

  const normalizedTraceGraph = buildTraceGraphDataFromJSONTrace(traceGraph);
  runtimeTraceGraphCache.set(traceGraph, normalizedTraceGraph);
  return normalizedTraceGraph;
}

function createRuntimeGraph(graph: JSONTrace): TraceGraph {
  return createTestTraceGraph(normalizeRuntimeTraceGraphSource(graph), {});
}

function normalizeTraceLayoutRowSourceGraph(
  traceGraph: Parameters<typeof buildRuntimeTraceLayoutRows>[0]['traceGraph'] | JSONTrace
): Parameters<typeof buildRuntimeTraceLayoutRows>[0]['traceGraph'] {
  return (
    isJSONTraceLike(traceGraph) ? normalizeRuntimeTraceGraphSource(traceGraph) : traceGraph
  ) as Parameters<typeof buildRuntimeTraceLayoutRows>[0]['traceGraph'];
}

function normalizeVisibleTraceGraphSource(traceGraph: JSONTrace): TraceGraph {
  const cachedVisibleTraceGraph = visibleTraceGraphCache.get(traceGraph);
  if (cachedVisibleTraceGraph) {
    if (
      'hasActiveSpanFilter' in traceGraph &&
      typeof traceGraph.hasActiveSpanFilter === 'function' &&
      'getFilteredSpanCountByThreadId' in traceGraph &&
      typeof traceGraph.getFilteredSpanCountByThreadId === 'function'
    ) {
      Object.assign(cachedVisibleTraceGraph, {
        hasActiveSpanFilter: traceGraph.hasActiveSpanFilter.bind(traceGraph),
        getFilteredSpanCountByThreadId: traceGraph.getFilteredSpanCountByThreadId.bind(traceGraph)
      });
    }
    return cachedVisibleTraceGraph;
  }

  const normalizedTraceGraph = createTestTraceGraph(
    normalizeRuntimeTraceGraphSource(traceGraph),
    {}
  );
  if (
    'hasActiveSpanFilter' in traceGraph &&
    typeof traceGraph.hasActiveSpanFilter === 'function' &&
    'getFilteredSpanCountByThreadId' in traceGraph &&
    typeof traceGraph.getFilteredSpanCountByThreadId === 'function'
  ) {
    Object.assign(normalizedTraceGraph, {
      hasActiveSpanFilter: traceGraph.hasActiveSpanFilter.bind(traceGraph),
      getFilteredSpanCountByThreadId: traceGraph.getFilteredSpanCountByThreadId.bind(traceGraph)
    });
  }
  visibleTraceGraphCache.set(traceGraph, normalizedTraceGraph);
  return normalizedTraceGraph;
}

function buildTraceLayoutRows(
  params: Omit<Parameters<typeof buildRuntimeTraceLayoutRows>[0], 'traceGraph'> & {
    traceGraph: Parameters<typeof buildRuntimeTraceLayoutRows>[0]['traceGraph'] | JSONTrace;
  }
) {
  return buildRuntimeTraceLayoutRows({
    ...params,
    traceGraph: normalizeTraceLayoutRowSourceGraph(params.traceGraph)
  });
}

function buildTraceLayouts(
  params: Omit<Parameters<typeof buildRuntimeTraceLayouts>[0], 'traceGraphs'> & {
    traceGraphs: ReadonlyArray<
      Parameters<typeof buildRuntimeTraceLayouts>[0]['traceGraphs'][number] | JSONTrace
    >;
  }
) {
  return buildRuntimeTraceLayouts({
    ...params,
    traceGraphs: params.traceGraphs.map(normalizeRuntimeTraceGraphSource)
  });
}

function getMemoizedDerivedTraceData(
  params: Omit<
    Parameters<typeof getRuntimeMemoizedDerivedTraceData>[0],
    'traceGraph' | 'settings'
  > & {
    traceGraph: Parameters<typeof getRuntimeMemoizedDerivedTraceData>[0]['traceGraph'] | JSONTrace;
    settings?: TraceVisSettings;
  }
) {
  const traceGraph =
    params.traceGraph instanceof TraceGraph
      ? params.traceGraph
      : isJSONTraceLike(params.traceGraph)
        ? normalizeVisibleTraceGraphSource(params.traceGraph)
        : createTestTraceGraph(normalizeRuntimeTraceGraphSource(params.traceGraph), {});
  return getRuntimeMemoizedDerivedTraceData({
    ...params,
    settings: params.settings ?? getTraceSettings(),
    traceGraph,
    traceLayout: withRuntimeTraceLayout(params.traceLayout, traceGraph)
  });
}

function getMemoizedTraceLayoutRowEnrichments(
  params: Parameters<typeof getRuntimeMemoizedTraceLayoutRowEnrichments>[0]
) {
  return getRuntimeMemoizedTraceLayoutRowEnrichments({
    ...params,
    traceLayout: withRuntimeTraceLayout(params.traceLayout, params.traceLayout.traceGraph)
  });
}

type LegacyBuildDeckLayersForTraceParams = Omit<
  BuildDeckLayersForTraceParams,
  'scene' | 'selection' | 'handlers'
> &
  TraceDeckLayerSelection &
  TraceDeckLayerHandlers & {
    processRows: BuildDeckLayersForTraceParams['scene']['rows'];
    traceGraph: unknown;
    traceLayout: TraceLayout;
    layerIdPrefix?: string;
    rankBackgroundColor?: readonly [number, number, number, number];
    modelMatrix?: Matrix4;
  };

function buildDeckLayersForTrace(params: LegacyBuildDeckLayersForTraceParams) {
  const runtimeGraph =
    params.traceGraph instanceof TraceGraph
      ? params.traceGraph
      : isJSONTraceLike(params.traceGraph)
        ? normalizeVisibleTraceGraphSource(params.traceGraph)
        : params.traceLayout.traceGraph instanceof TraceGraph
          ? params.traceLayout.traceGraph
          : isJSONTraceLike(params.traceLayout.traceGraph)
            ? normalizeVisibleTraceGraphSource(params.traceLayout.traceGraph)
            : createTestTraceGraph(
                normalizeRuntimeTraceGraphSource(params.traceGraph as never),
                {}
              );
  const traceLayout = withRuntimeTraceLayout(params.traceLayout, runtimeGraph);
  const crossDependencies = (params.traceGraph as {crossDependencies?: unknown}).crossDependencies;
  return buildRuntimeDeckLayersForTrace({
    settings: params.settings,
    stepNum: params.stepNum,
    colorScheme: params.colorScheme,
    showRowSeparators: params.showRowSeparators,
    collapsedActivityDirection: params.collapsedActivityDirection,
    layerGroup: params.layerGroup,
    scene: {
      graph: runtimeGraph,
      layout: traceLayout,
      rows: params.processRows,
      visibleCrossDependencies: Array.isArray(crossDependencies)
        ? (crossDependencies as BuildDeckLayersForTraceParams['scene']['visibleCrossDependencies'])
        : runtimeGraph.getVisibleCrossDependencySources(),
      layerIdPrefix: params.layerIdPrefix,
      rankBackgroundColor: params.rankBackgroundColor,
      modelMatrix: params.modelMatrix,
      minimapSpanIndicators: []
    },
    selection: {
      hoveredSpan: params.hoveredSpan,
      selectedSpanRefs: params.selectedSpanRefs,
      selectedDependencies: params.selectedDependencies,
      selectedCrossDependencies: params.selectedCrossDependencies,
      selectedLocalDependencySourcesByProcessId: params.selectedLocalDependencySourcesByProcessId,
      selectedCrossDependencySources: params.selectedCrossDependencySources,
      highlightedSpanRefs: params.highlightedSpanRefs
    },
    handlers: {
      onSpanClick: params.onSpanClick,
      onToggleProcess: params.onToggleProcess
    }
  });
}

function buildDeckLayersForLegend(params: Parameters<typeof buildRuntimeDeckLayersForLegend>[0]) {
  return buildRuntimeDeckLayersForLegend({
    ...params,
    traceLayout: withRuntimeTraceLayout(params.traceLayout, params.traceLayout.traceGraph)
  });
}

function createRank(processId: string): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-stream`,
    threadId: `${processId}-stream` as TraceThreadId,
    processId
  };

  const span: TraceSpan = {
    type: 'trace-span',
    spanId: `${processId}-span` as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name: `${processId}-span`,
    keywords: [],
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };

  const instant: TraceInstant = {
    type: 'trace-instant',
    instantId: `${processId}-instant` as TraceInstantId,
    threadId: thread.threadId,
    atTimeMs: 5,
    name: `${processId}-instant`,
    scope: 'g',
    userData: {color: [10, 20, 30, 40]}
  };

  const counter: TraceCounter = {
    type: 'trace-counter',
    counterId: `${processId}-counter` as TraceCounterId,
    threadId: thread.threadId,
    atTimeMs: 6,
    name: `${processId}-counter`,
    series: {},
    totalValue: 10,
    userData: {}
  };

  const counterTail: TraceCounter = {
    type: 'trace-counter',
    counterId: `${processId}-counter-tail` as TraceCounterId,
    threadId: thread.threadId,
    atTimeMs: 7,
    name: `${processId}-counter-tail`,
    series: {},
    totalValue: 20,
    userData: {color: [111, 112, 113, 200]}
  };

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [span],
    spanMap: {[span.spanId]: span},
    instants: [instant],
    instantMap: {[instant.instantId]: instant},
    threadInstantMap: {[thread.threadId]: [instant]},
    counters: [counter, counterTail],
    counterMap: {[counter.counterId]: counter, [counterTail.counterId]: counterTail},
    threadCounterMap: {[thread.threadId]: [counter, counterTail]},
    localDependencies: [],
    remoteDependencies: []
  };
}

function createGraph(): JSONTrace {
  const rank = createRank('rank-1');
  return buildJSONTrace([rank], [], {name: 'test-graph'});
}

function createGraphWithoutEvents(): JSONTrace {
  const rank = createRank('rank-1');
  return buildJSONTrace(
    [
      {
        ...rank,
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {}
      }
    ],
    [],
    {name: 'test-graph-no-events'}
  );
}

function createMultiGraph(): JSONTrace {
  return buildJSONTrace([createRank('rank-1'), createRank('rank-2')], [], {
    name: 'test-graph-multi'
  });
}

function createDependencyGraph(): JSONTrace {
  const rank = createRank('rank-1');
  const firstBlock = rank.spans[0]!;
  const secondBlock: TraceSpan = {
    ...firstBlock,
    spanId: 'rank-1-span-2' as TraceSpanId,
    name: 'rank-1-span-2',
    localDependencyIds: [],
    localDependencies: []
  };
  const warningDependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: 'dep-warning' as TraceLocalDependency['dependencyId'],
    startSpanId: firstBlock.spanId,
    endSpanId: secondBlock.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 5
  };
  const submitDependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: 'dep-submit' as TraceLocalDependency['dependencyId'],
    startSpanId: secondBlock.spanId,
    endSpanId: firstBlock.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 5_000
  };

  return buildJSONTrace(
    [
      {
        ...rank,
        spans: [firstBlock, secondBlock],
        spanMap: {
          [firstBlock.spanId]: firstBlock,
          [secondBlock.spanId]: secondBlock
        },
        localDependencies: [warningDependency, submitDependency]
      }
    ],
    [],
    {name: 'dependency-graph'}
  );
}

function createLayout(graph: JSONTrace): TraceLayout {
  const threadLayoutMap: Record<TraceThreadId, ThreadLayout> = {};
  const processLayouts = graph.processes.map((process, rankIndex) => {
    const yPosition = rankIndex * 2 + 1;
    const streamLayout = {
      visible: true,
      yPosition,
      startPosition: [0, yPosition, 0] as [number, number, number],
      targetPosition: [0, yPosition, 0] as [number, number, number]
    };
    threadLayoutMap[process.threads[0]!.threadId] = streamLayout;

    return {
      yOffset: rankIndex * 2,
      yHeight: 1,
      labelY: rankIndex * 2,
      collapsedActivityY: rankIndex * 2,
      backgroundPolygon: new Float32Array(),
      backgroundPolygonInfinite: new Float32Array(),
      separatorLineInfinite: new Float32Array(),
      terminalSeparatorLineInfinite: new Float32Array(),
      startPosition: [0, rankIndex * 2, 0] as [number, number, number],
      threadLayouts: [streamLayout],
      label: process.name
    };
  });
  return withProcessRenderRows(
    {
      traceGraph: graph as unknown as TraceLayout['traceGraph'],
      layoutConfiguration: {laneSeparation: 0.7},
      processLayouts,
      renderRows: [],
      threadLayoutMap,
      overflowLabels: [],
      currentBounds: [
        [0, 0],
        [1, Math.max(1, graph.processes.length * 2 - 1)]
      ],
      expandedBounds: [
        [0, 0],
        [1, Math.max(1, graph.processes.length * 2 - 1)]
      ]
    } as TraceLayout,
    graph
  );
}

function withProcessRenderRows(layout: TraceLayout, graph: JSONTrace): TraceLayout {
  return {
    ...layout,
    renderRows: buildTraceLayoutRows({
      traceGraph: graph,
      processLayouts: layout.processLayouts
    })
  };
}

function withRuntimeTraceGraph(layout: TraceLayout, traceGraph: TraceGraph): TraceLayout {
  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
  const renderRows = layout.processLayouts.map((processLayout, rankIndex) => {
    const process = traceGraph.processes[rankIndex]!;
    const processRef = traceGraph.getProcessRefs()[rankIndex]!;
    const threadRefs = traceGraph.getThreadRefsByProcessRef(processRef);
    for (const [threadIndex, threadRef] of threadRefs.entries()) {
      const threadLayout = processLayout.threadLayouts[threadIndex];
      if (threadLayout) {
        threadLayout.threadRef = threadRef;
        threadLayoutMapByRef.set(threadRef, threadLayout);
      }
    }
    return {
      processId: process.processId,
      processRef,
      threadRefs,
      rankIndex,
      name: processLayout.label ?? process.name,
      rankNum: process.rankNum,
      threads: process.threads,
      isCollapsed: processLayout.isCollapsed ?? false
    } satisfies TraceLayoutRow;
  });

  return {
    ...layout,
    traceGraph,
    renderRows,
    threadLayoutMapByRef
  };
}

function getRowEnrichments(
  layout: TraceLayout,
  graph: JSONTrace,
  collapsedActivityByProcessId?: Readonly<
    Record<string, ReadonlyArray<TraceProcessActivityInterval>>
  >,
  localDependencyMode: TraceVisSettings['localDependencyMode'] = 'all'
) {
  const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
  return getMemoizedTraceLayoutRowEnrichments({
    traceLayout: {
      ...layout,
      traceGraph: runtimeGraph
    },
    collapsedActivityByProcessId
  }).map(({row, collapsedActivityIntervals, overflowLabels}) => ({
    row,
    spans: runtimeGraph.getVisibleProcessRenderSpanRefs(
      getRequiredProcessRef(runtimeGraph, row.processId)
    ),
    dependencies: runtimeGraph
      .getVisibleLocalDependencyRefs(getRequiredProcessRef(runtimeGraph, row.processId))
      .filter(dependencyRef =>
        shouldShowLocalDependencyByModeFields(
          localDependencyMode,
          runtimeGraph.getVisibleDependencyHasKeyword(dependencyRef, 'SUBMIT'),
          runtimeGraph.getVisibleDependencyWaitTimeMs(dependencyRef) ?? 0
        )
      ),
    collapsedActivityIntervals,
    overflowLabels: overflowLabels.filter(overflowLabel => overflowLabel.view === 'main')
  }));
}

function getTraceSettings(
  aggregationMode: 'separate-threads' | 'combine-threads' = 'separate-threads'
): TraceVisSettings {
  return {
    localDependencyMode: 'all',
    trackAggregationMode: aggregationMode,
    layoutDensity: 'comfortable',
    highlightFadeFactor: 1,
    showBlockText: true
  } as unknown as TraceVisSettings;
}

function buildLayoutFromGraph(
  graph: JSONTrace,
  aggregationMode: 'separate-threads' | 'combine-threads' = 'separate-threads',
  localDependencyMode: TraceVisSettings['localDependencyMode'] = 'all'
): TraceLayout {
  return buildTraceLayouts({
    traceGraphs: [graph],
    settings: {
      threadDisplayMode: 'all',
      selectedThreadNames: undefined,
      sortThreads: false,
      showCrossProcessDependencies: true,
      localDependencyMode,
      layoutDensity: 'comfortable',
      processLayoutMode: 'interleaved',
      trackAggregationMode: aggregationMode,
      spanFilter: undefined
    }
  })[0]!;
}

function getSingleRow(layout: TraceLayout): TraceLayoutRow {
  return layout.renderRows[0]!;
}

const colorScheme: TraceColorScheme = {
  id: 'test',
  name: 'Test',
  getThreadColor: () => [1, 2, 3, 4]
};

describe('trace layout collapsed activity enrichment', () => {
  it('maps dependency layer modes to line or arc only', () => {
    const graph = createGraph();
    const span = graph.processes[0]!.spans[0]!;
    const selectedDependency = {
      dependencyRef: encodeVisibleLocalDependencyRef(0),
      type: 'trace-local-dependency' as const,
      dependencyId: 'dep-mode' as TraceLocalDependency['dependencyId'],
      startSpanId: span.spanId,
      endSpanId: span.spanId,
      keywords: new Set<string>(),
      waitMode: 'end-to-start' as const,
      bidirectional: false,
      waitTimeMs: 250
    };
    const selectedCrossDependency = {
      dependencyRef: encodeVisibleCrossDependencyRef(0),
      type: 'trace-cross-process-dependency' as const,
      dependencyId: 'cross-dep-mode' as TraceCrossProcessDependency['dependencyId'],
      endpointId: 'cross-dep-mode:endpoint' as TraceCrossProcessDependency['endpointId'],
      startRankNum: 0,
      endRankNum: 1,
      startSpanId: span.spanId,
      endSpanId: span.spanId,
      waitMode: 'end-to-start' as const,
      bidirectional: false,
      topology: 'cross',
      waitTimeMs: 100,
      waiting: false,
      waitNotFinished: false,
      keywords: new Set<string>()
    };
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        localDependencyGeometryChunks: buildTraceLayoutLocalDependencyGeometryChunksForTest([
          [encodeLocalDependencyRef(encodeLocalSpanRef(0, 0)), new Float32Array([2, 2, 3, 3])]
        ]),
        crossDependencyGeometryChunks: buildTraceLayoutCrossDependencyGeometryChunksForTest([
          [encodeCrossDependencyRef(0), new Float32Array([6, 6, 7, 7])]
        ])
      } satisfies TraceLayout,
      graph
    );

    function getDependencyModes(lineRoutingMode: TraceVisSettings['lineRoutingMode']) {
      const layers = buildDeckLayersForTrace({
        processRows: getRowEnrichments(layout, graph),
        traceGraph: {crossDependencies: [selectedCrossDependency]},
        stepNum: 0,
        selectedSpanRefs: [],
        selectedDependencies: [selectedDependency],
        selectedCrossDependencies: [selectedCrossDependency],
        onSpanClick: () => undefined,
        traceLayout: layout,
        settings: {
          ...getTraceSettings(),
          lineRoutingMode
        } as TraceVisSettings
      });

      const crossLayer = layers.find(
        layer =>
          layer instanceof TraceCrossDependencyLayer &&
          layer.id.endsWith('cross-rank-dependency-selection')
      ) as TraceCrossDependencyLayer;
      const localLayer = layers.find(layer =>
        layer?.id.endsWith('selected-local-dependency-overlays')
      ) as {props: {mode: string}} | undefined;
      const crossSelectedLayer = crossLayer
        .renderLayers()
        ?.find(layer => layer?.props.data === crossLayer.props.selectedCrossDependencies) as
        | {
            props: {
              data: readonly TraceCrossProcessDependency[];
              getMarkerPlacements: (dependency: TraceCrossProcessDependency) => readonly number[];
              getPath: (dependency: typeof selectedCrossDependency) => Float32Array | [];
              getWidth: number;
              mode: string;
            };
          }
        | undefined;

      return {
        localMode: localLayer?.props.mode,
        crossMode: crossSelectedLayer?.props.mode,
        crossMarkerPlacements:
          crossSelectedLayer?.props.getMarkerPlacements(selectedCrossDependency),
        crossPath: Array.from(crossSelectedLayer?.props.getPath(selectedCrossDependency) ?? []),
        crossWidth: crossSelectedLayer?.props.getWidth,
        topLayerId: layers.at(-1)?.id
      };
    }

    expect(getDependencyModes('straight')).toEqual({
      localMode: 'line',
      crossMode: 'line',
      crossMarkerPlacements: [1],
      crossPath: [6, 6, 7, 7],
      crossWidth: 2,
      topLayerId: 'cross-rank-dependency-selection'
    });
    expect(getDependencyModes('curve')).toEqual({
      localMode: 'arc',
      crossMode: 'arc',
      crossMarkerPlacements: [1],
      crossPath: [6, 6, 7, 7],
      crossWidth: 2,
      topLayerId: 'cross-rank-dependency-selection'
    });
  });

  it('builds renderRows for normal mode from the layout structure', () => {
    const graph = createMultiGraph();
    const layout = buildLayoutFromGraph(graph);

    expect(layout.renderRows).toHaveLength(graph.processes.length);
    expect(layout.renderRows.map(row => row.processId)).toEqual(
      graph.processes.map(process => process.processId)
    );
    expect(layout.renderRows.map(row => row.rankIndex)).toEqual([0, 1]);
    expect(layout.renderRows.map(row => row.threads)).toEqual(
      graph.processes.map(process => process.threads)
    );
  });

  it('renders a synthetic all_threads legend row for combine-threads mode', () => {
    const graph = createGraph();
    const layout = buildLayoutFromGraph(graph, 'combine-threads');

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings('combine-threads')
    });
    const rankLegendLayer = legendLayers.find(layer =>
      layer.id.endsWith(`legend-${graph.processes[0]!.processId}`)
    ) as TraceLegendLayer | undefined;

    expect(rankLegendLayer?.props.threads).toEqual([
      expect.objectContaining({
        name: 'all_threads',
        threadId: 'all_threads',
        processId: graph.processes[0]!.processId
      })
    ]);
  });

  it('does not render stream reference lines over trace spans', () => {
    const graph = createGraph();
    const layout = buildLayoutFromGraph(graph);

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const rankLegendLayer = legendLayers.find(layer =>
      layer.id.endsWith(`legend-${graph.processes[0]!.processId}`)
    ) as TraceLegendLayer | undefined;
    const subLayers = rankLegendLayer?.renderLayers() as
      | Array<{id: string; props: {pickable?: boolean}}>
      | undefined;
    const streamLineLayer = subLayers?.find(layer =>
      layer.id.endsWith('legend-stream-reference-lines')
    );

    expect(streamLineLayer).toBeUndefined();
  });

  it('does not render the Run Events label in the scrollable process legend', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        globalEventRow: {
          yPosition: -1,
          height: 1
        }
      } satisfies TraceLayout,
      graph
    );

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: {
        ...getTraceSettings(),
        showGlobalEvents: true
      } as TraceVisSettings
    });
    const eventLabelLayer = legendLayers.find(layer => layer.id.endsWith('run-event-label'));

    expect(eventLabelLayer).toBeUndefined();
  });

  it('returns finite legend bounds derived from local legend content', () => {
    const graph = createGraph();
    const layout = buildLayoutFromGraph(graph);

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {
        [graph.processes[0]!.processId]: {
          processId: graph.processes[0]!.processId,
          node_name: 'node-a'
        }
      },
      graphName: 'graph-a',
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const rankLegendLayer = legendLayers.find(layer =>
      layer.id.endsWith(`legend-${graph.processes[0]!.processId}`)
    ) as TraceLegendLayer | undefined;

    const bounds = rankLegendLayer?.getBounds();

    expect(bounds).toBeDefined();
    expect(bounds?.[0][0]).toBeGreaterThan(-1000);
    expect(bounds?.[1][0]).toBeLessThan(1000);
    expect(bounds?.[0][0]).toBeLessThan(0);
    expect(bounds?.[1][0]).toBeGreaterThan(0);
  });

  it('separates rank and graph names without nested parentheses', () => {
    const graph = createGraph();
    const layout = buildLayoutFromGraph(graph);

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      graphName: 'Step 45 / 91347432421310',
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const rankLabelLayer = legendLayers.find(layer => layer.id.endsWith('legend-rank-label')) as
      | {
          props: {
            data: TraceLayoutRow[];
            getText: (row: TraceLayoutRow) => string;
          };
        }
      | undefined;

    expect(rankLabelLayer?.props.getText(rankLabelLayer.props.data[0]!)).toBe(
      'rank-1 - Step 45 / 91347432421310 ▾'
    );
  });

  it('keeps a small pixel gap between stream labels and the timeline', () => {
    const graph = createGraph();
    const layout = buildLayoutFromGraph(graph);

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const rankLegendLayer = legendLayers.find(layer =>
      layer.id.endsWith(`legend-${graph.processes[0]!.processId}`)
    ) as TraceLegendLayer | undefined;
    const subLayers = rankLegendLayer?.renderLayers() as
      | Array<{
          id: string;
          props: {
            getPixelOffset?: readonly [number, number];
          };
        }>
      | undefined;
    const streamLabelLayer = subLayers?.find(layer => layer.id.endsWith('legend-stream-names'));

    expect(streamLabelLayer?.props.getPixelOffset).toEqual([-8, 0]);
  });

  it('passes the runtime thread ref when a stream legend label toggles', () => {
    const graph = createGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const threadRef = layout.renderRows[0]?.threadRefs?.[0];
    const threadLayout = layout.processLayouts[0]?.threadLayouts[0];
    if (threadRef == null || !threadLayout) {
      throw new Error('Expected runtime thread ref for legend callback test');
    }
    threadLayout.lanes = {
      laneCount: 2,
      renderedLaneCount: 2,
      isCollapsed: false,
      laneYPositions: [0, 1]
    };
    const onToggleStream = vi.fn();

    const legendLayers = buildRuntimeDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings(),
      onToggleStream
    });
    const rankLegendLayer = legendLayers.find(layer =>
      layer.id.endsWith(`legend-${graph.processes[0]!.processId}`)
    ) as TraceLegendLayer | undefined;
    const subLayers = rankLegendLayer?.renderLayers() as
      | Array<{
          id: string;
          props: {
            data: unknown[];
            onClick?: (info: {object?: unknown}) => void;
          };
        }>
      | undefined;
    const streamLabelLayer = subLayers?.find(layer => layer.id.endsWith('legend-stream-names'));

    streamLabelLayer?.props.onClick?.({object: streamLabelLayer.props.data[0]});

    expect(onToggleStream).toHaveBeenCalledWith(
      graph.processes[0]!.threads[0]!.threadId,
      graph.processes[0]!.threads[0],
      threadRef
    );
  });

  it('includes legend label vertical bounds beyond raw stream guide lines', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            labelY: -3,
            startPosition: [0, -4, 0] as [number, number, number]
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {
        [graph.processes[0]!.processId]: {node_name: 'node-a'}
      },
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const rankLegendLayer = legendLayers.find(layer =>
      layer.id.endsWith(`legend-${graph.processes[0]!.processId}`)
    ) as TraceLegendLayer | undefined;

    const bounds = rankLegendLayer?.getBounds();

    expect(bounds).toBeDefined();
    expect(bounds?.[0][1]).toBeLessThan(layout.processLayouts[0]!.yOffset);
  });

  it('keeps renderRows free of dependency payload and filters them at enrichment time', () => {
    const graph = createDependencyGraph();
    const allRows = buildLayoutFromGraph(graph, 'separate-threads', 'all');
    const warningRows = buildLayoutFromGraph(graph, 'separate-threads', 'warnings');
    const submitRows = buildLayoutFromGraph(graph, 'separate-threads', 'submit');

    expect(getSingleRow(allRows)).not.toHaveProperty('dependencies');
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    expect(
      getRowEnrichments(warningRows, graph, undefined, 'warnings')[0]?.dependencies.map(
        dependencyRef => runtimeGraph.getVisibleDependencyIdByRef(dependencyRef)
      )
    ).toEqual(['dep-warning']);
    expect(
      getRowEnrichments(submitRows, graph, undefined, 'submit')[0]?.dependencies.map(
        dependencyRef => runtimeGraph.getVisibleDependencyIdByRef(dependencyRef)
      )
    ).toEqual(['dep-warning', 'dep-submit']);
  });

  it('deck layer builders consume precomputed renderRows while using layout collapse state', () => {
    const graph = createDependencyGraph();
    const baseLayout = createLayout(graph);
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const processRef = getRequiredProcessRef(runtimeGraph, graph.processes[0]!.processId);
    const customDependencyRef = runtimeGraph.getVisibleLocalDependencyRefs(processRef)[0]!;
    const layout = {
      ...baseLayout,
      renderRows: [
        {
          ...baseLayout.renderRows[0]!,
          name: 'Precomputed row',
          rankNum: 42,
          isCollapsed: true
        }
      ]
    } satisfies TraceLayout;
    const traceProcessRows = getRowEnrichments(layout, graph).map((processRow, index) =>
      index === 0 ? {...processRow, dependencies: [customDependencyRef]} : processRow
    );

    const legendLayers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const traceLayers = buildDeckLayersForTrace({
      processRows: traceProcessRows,
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const legendLabelLayer = legendLayers.find(layer => layer.id.endsWith('legend-rank-label')) as
      | {
          props: {
            data: TraceLayoutRow[];
            getPosition: (row: TraceLayoutRow) => readonly [number, number, number];
          };
        }
      | undefined;
    const rankLayer = traceLayers.find(
      layer => layer instanceof TraceProcessLayer
    ) as TraceProcessLayer;
    const legendLabelPosition = legendLabelLayer?.props.getPosition(layout.renderRows[0]!);
    const processTopY = baseLayout.processLayouts[0]?.yOffset;
    const firstVisibleStreamY = baseLayout.processLayouts[0]?.threadLayouts[0]?.startPosition[1];

    expect(legendLabelLayer?.props.data[0]?.name).toBe('Precomputed row');
    expect(processTopY).toBeDefined();
    expect(firstVisibleStreamY).toBeDefined();
    expect(legendLabelPosition?.[1]).toBeGreaterThanOrEqual(processTopY!);
    expect(legendLabelPosition?.[1]).toBeLessThan(firstVisibleStreamY!);
    expect(rankLayer.props.rankNum).toBe(42);
    expect(rankLayer.props.dependencies).toEqual([customDependencyRef]);
    expect(rankLayer.props.isCollapsed).toBe(false);
  });

  it('prefers rank layout collapse state over a stale precomputed render row flag', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const layout = {
      ...baseLayout,
      renderRows: [{...baseLayout.renderRows[0]!, isCollapsed: true}]
    } satisfies TraceLayout;
    const traceLayers = buildDeckLayersForTrace({
      processRows: [
        {
          row: layout.renderRows[0]!,
          spans: normalizeVisibleTraceGraphSource(graph).getVisibleProcessRenderSpanRefs(
            getRequiredProcessRef(
              normalizeVisibleTraceGraphSource(graph),
              graph.processes[0]!.processId
            )
          ),
          dependencies: [],
          collapsedActivityIntervals: [],
          overflowLabels: []
        }
      ],
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const rankLayer = traceLayers.find(
      layer => layer instanceof TraceProcessLayer
    ) as TraceProcessLayer;
    const renderedLayers = rankLayer.renderLayers();
    const blockLayer = renderedLayers?.find(layer => layer?.id.endsWith('block-rectangles'));

    expect(rankLayer.props.isCollapsed).toBe(false);
    expect(layout.processLayouts[0]?.isCollapsed ?? false).toBe(false);
    expect(blockLayer?.props.visible).toBe(true);
  });

  it('keeps empty instant and counter layers stable while hidden', () => {
    const graph = createGraphWithoutEvents();
    const layout = buildLayoutFromGraph(graph);
    const nextLayout = {
      ...layout,
      currentBounds: [
        [0, 0],
        [2, 2]
      ]
    } satisfies TraceLayout;
    const settings = {
      ...getTraceSettings(),
      showInstants: true,
      showCounters: true
    };
    const buildLayers = (traceLayout: TraceLayout) =>
      buildDeckLayersForInstantsAndCounter({
        traceGraph: traceLayout.traceGraph,
        traceLayout,
        settings
      }) as Array<{
        id: string;
        props: {
          data: readonly unknown[];
          getColor?: unknown;
          getFillColor?: unknown;
          getPath?: unknown;
          getPosition?: unknown;
          getRadius?: unknown;
          getWidth?: unknown;
          pickable?: boolean;
          visible: boolean;
          updateTriggers?: Record<string, unknown>;
        };
      }>;
    const firstLayers = buildLayers(layout);
    const secondLayers = buildLayers(nextLayout);
    const getLayer = (
      layers: typeof firstLayers,
      suffix: 'trace-instants' | 'trace-counter-sparklines' | 'trace-counter-points'
    ) => layers.find(layer => layer.id.endsWith(suffix))!;
    const firstInstants = getLayer(firstLayers, 'trace-instants');
    const secondInstants = getLayer(secondLayers, 'trace-instants');
    const firstSparklines = getLayer(firstLayers, 'trace-counter-sparklines');
    const secondSparklines = getLayer(secondLayers, 'trace-counter-sparklines');
    const firstCounterPoints = getLayer(firstLayers, 'trace-counter-points');
    const secondCounterPoints = getLayer(secondLayers, 'trace-counter-points');

    expect(firstInstants.props.visible).toBe(false);
    expect(firstSparklines.props.visible).toBe(false);
    expect(firstCounterPoints.props.visible).toBe(false);
    expect(firstInstants.props.pickable).toBe(false);
    expect(firstCounterPoints.props.pickable).toBe(false);
    expect(secondInstants.props.data).toBe(firstInstants.props.data);
    expect(secondSparklines.props.data).toBe(firstSparklines.props.data);
    expect(secondCounterPoints.props.data).toBe(firstCounterPoints.props.data);
    expect(secondInstants.props.getPosition).toBe(firstInstants.props.getPosition);
    expect(secondInstants.props.getFillColor).toBe(firstInstants.props.getFillColor);
    expect(secondInstants.props.getRadius).toBe(firstInstants.props.getRadius);
    expect(secondSparklines.props.getPath).toBe(firstSparklines.props.getPath);
    expect(secondSparklines.props.getColor).toBe(firstSparklines.props.getColor);
    expect(secondSparklines.props.getWidth).toBe(firstSparklines.props.getWidth);
    expect(secondCounterPoints.props.getPosition).toBe(firstCounterPoints.props.getPosition);
    expect(secondCounterPoints.props.getFillColor).toBe(firstCounterPoints.props.getFillColor);
    expect(secondCounterPoints.props.getRadius).toBe(firstCounterPoints.props.getRadius);
    expect(secondInstants.props.updateTriggers?.getPosition).toBe(
      firstInstants.props.updateTriggers?.getPosition
    );
    expect(secondSparklines.props.updateTriggers?.getPath).toBe(
      firstSparklines.props.updateTriggers?.getPath
    );
    expect(secondCounterPoints.props.updateTriggers?.getPosition).toBe(
      firstCounterPoints.props.updateTriggers?.getPosition
    );
  });

  it('keeps instant and counter layer ids present when settings disable them', () => {
    const graph = createGraphWithoutEvents();
    const layout = buildLayoutFromGraph(graph);
    const layers = buildDeckLayersForInstantsAndCounter({
      traceGraph: layout.traceGraph,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    expect(layers.map(layer => layer.id)).toEqual([
      'trace-global-events',
      'trace-instants',
      'trace-counter-sparklines',
      'trace-counter-points'
    ]);
    expect(layers.every(layer => layer.props.visible === false)).toBe(true);
  });

  it('renders normal span borders at a full pixel width', () => {
    const graph = createGraph();
    const layout = createLayout(graph);
    const rankLayer = new TraceProcessLayer({
      id: 'rank-span-border-width',
      threads: graph.processes[0]!.threads,
      spans: normalizeVisibleTraceGraphSource(graph).getVisibleProcessRenderSpanRefs(
        getRequiredProcessRef(
          normalizeVisibleTraceGraphSource(graph),
          graph.processes[0]!.processId
        )
      ),
      dependencies: [],
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: graph.processes[0]!.processId,
      rankNum: graph.processes[0]!.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const blockLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-rectangles')) as
      | {
          props: {
            getLineWidth: number;
            heightMinPixels: number;
            parameters: unknown;
            widthMinPixels: number;
          };
        }
      | undefined;

    expect(blockLayer?.props.getLineWidth).toBe(1);
    expect(blockLayer?.props.parameters).toEqual({
      blend: false,
      depthWriteEnabled: true,
      depthCompare: 'less-equal'
    });
    expect(blockLayer?.props.widthMinPixels).toBe(2);
    expect(blockLayer?.props.heightMinPixels).toBe(0);
  });

  it('uses the configured normal span minimum width', () => {
    const graph = createGraph();
    const layout = createLayout(graph);
    const rankLayer = new TraceProcessLayer({
      id: 'rank-span-configured-min-width',
      threads: graph.processes[0]!.threads,
      spans: normalizeVisibleTraceGraphSource(graph).getVisibleProcessRenderSpanRefs(
        getRequiredProcessRef(
          normalizeVisibleTraceGraphSource(graph),
          graph.processes[0]!.processId
        )
      ),
      dependencies: [],
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: graph.processes[0]!.processId,
      rankNum: graph.processes[0]!.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: {
        ...getTraceSettings(),
        minSpanWidthPixels: 4
      }
    });

    const blockLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-rectangles')) as
      | {
          props: {
            widthMinPixels: number;
          };
        }
      | undefined;

    expect(blockLayer?.props.widthMinPixels).toBe(4);
  });

  it('renders a dedicated border overlay layer without forcing a minimum pixel width', () => {
    const graph = createGraph();
    const layout = createLayout(graph);
    const rankLayer = new TraceProcessLayer({
      id: 'rank-span-border-overlay',
      threads: graph.processes[0]!.threads,
      spans: normalizeVisibleTraceGraphSource(graph).getVisibleProcessRenderSpanRefs(
        getRequiredProcessRef(
          normalizeVisibleTraceGraphSource(graph),
          graph.processes[0]!.processId
        )
      ),
      dependencies: [],
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: graph.processes[0]!.processId,
      rankNum: graph.processes[0]!.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const borderLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-rectangle-borders')) as
      | {
          props: {
            getWidth: number;
            widthMinPixels: number;
            pickable: boolean;
          };
        }
      | undefined;

    expect(borderLayer?.props.getWidth).toBe(1);
    expect(borderLayer?.props.widthMinPixels).toBe(0);
    expect(borderLayer?.props.pickable).toBe(false);
  });

  it('uses process-local geometry update triggers for rank block attributes', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const processGeometryEntry = {
      processId: process.processId,
      fastReuseKey: 'rank-geometry-key',
      reuseKey: 'rank-geometry-key',
      geometryXOffset: 2,
      geometryYOffset: 2
    };
    const layout = {
      ...createLayout(graph),
      geometryCache: {
        processesById: {
          [process.processId]: processGeometryEntry
        },
        spanGeometryChunks: [],
        localDependencyGeometryChunks: [],
        crossDependencyGeometryChunks: [],
        crossDependencyReuseKeyByVisibleRef: new Map()
      }
    } satisfies TraceLayout;
    const nextLayout = {
      ...layout,
      currentBounds: [
        [0, 0],
        [2, 2]
      ]
    } satisfies TraceLayout;
    const movedLayout = {
      ...layout,
      geometryCache: {
        ...layout.geometryCache,
        processesById: {
          [process.processId]: {
            ...processGeometryEntry,
            geometryXOffset: 10,
            geometryYOffset: 10
          }
        }
      }
    } satisfies TraceLayout;
    const makeRankLayer = (traceLayout: TraceLayout) =>
      new TraceProcessLayer({
        id: 'rank-process-local-update-trigger',
        threads: process.threads,
        spans: normalizeVisibleTraceGraphSource(graph).getVisibleProcessRenderSpanRefs(
          getRequiredProcessRef(normalizeVisibleTraceGraphSource(graph), process.processId)
        ),
        dependencies: [],
        selectedSpanRefs: [],
        selectedDependencies: [],
        rankIndex: 0,
        processId: process.processId,
        rankNum: process.rankNum,
        stepNum: 0,
        onSpanClick: () => undefined,
        traceLayout,
        settings: getTraceSettings()
      });
    const getBlockPositionTriggers = (traceLayout: TraceLayout) => {
      const blockLayer = makeRankLayer(traceLayout)
        .renderLayers()
        ?.find(layer => layer?.id.endsWith('block-rectangles')) as
        | {
            props: {
              updateTriggers: {
                getPosition: readonly unknown[];
              };
            };
          }
        | undefined;
      return blockLayer?.props.updateTriggers.getPosition;
    };
    const getOverflowLabelPositionTriggers = (traceLayout: TraceLayout) => {
      const overflowLabelLayer = makeRankLayer(traceLayout)
        .renderLayers()
        ?.find(layer => layer?.id.endsWith('overflow-labels')) as
        | {
            props: {
              updateTriggers: {
                getPosition: readonly unknown[];
              };
            };
          }
        | undefined;
      return overflowLabelLayer?.props.updateTriggers.getPosition;
    };
    const getSpanLabelPositionTriggers = (traceLayout: TraceLayout) => {
      const spanLabelLayer = makeRankLayer(traceLayout)
        .renderLayers()
        ?.find(layer => layer?.id.endsWith('block-labels-above')) as
        | {
            props: {
              updateTriggers: {
                getPosition: readonly unknown[];
              };
            };
          }
        | undefined;
      return spanLabelLayer?.props.updateTriggers.getPosition;
    };
    const getSpanLabelClipRectTriggers = (traceLayout: TraceLayout) => {
      const spanLabelLayer = makeRankLayer(traceLayout)
        .renderLayers()
        ?.find(layer => layer?.id.endsWith('block-labels-above')) as
        | {
            props: {
              updateTriggers: {
                getClipRect: readonly unknown[];
              };
            };
          }
        | undefined;
      return spanLabelLayer?.props.updateTriggers.getClipRect;
    };

    expect(getBlockPositionTriggers(nextLayout)).toEqual(getBlockPositionTriggers(layout));
    expect(getBlockPositionTriggers(movedLayout)).toEqual(getBlockPositionTriggers(layout));
    expect(getBlockPositionTriggers(layout)).not.toContain(layout);
    expect(getOverflowLabelPositionTriggers(nextLayout)).toEqual(
      getOverflowLabelPositionTriggers(layout)
    );
    expect(getOverflowLabelPositionTriggers(movedLayout)).toEqual(
      getOverflowLabelPositionTriggers(layout)
    );
    expect(getOverflowLabelPositionTriggers(layout)).not.toContain(layout);
    expect(getSpanLabelPositionTriggers(nextLayout)).toEqual(getSpanLabelPositionTriggers(layout));
    expect(getSpanLabelPositionTriggers(movedLayout)).not.toEqual(
      getSpanLabelPositionTriggers(layout)
    );
    expect(getSpanLabelPositionTriggers(layout)).not.toContain(layout);
    expect(getSpanLabelClipRectTriggers(nextLayout)).toEqual(getSpanLabelClipRectTriggers(layout));
    expect(getSpanLabelClipRectTriggers(movedLayout)).not.toEqual(
      getSpanLabelClipRectTriggers(layout)
    );
    expect(getSpanLabelClipRectTriggers(layout)).not.toContain(layout);
  });

  it('moves reused row-local attributes and labels with a layer transform', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const baseModelMatrix = new Matrix4().translate([5, 6, 0]);
    const layout = {
      ...createLayout(graph),
      geometryCache: {
        processesById: {
          [process.processId]: {
            processId: process.processId,
            fastReuseKey: 'rank-geometry-key',
            reuseKey: 'rank-geometry-key',
            geometryXOffset: 20,
            geometryYOffset: 20
          }
        },
        spanGeometryChunks: [],
        localDependencyGeometryChunks: [],
        crossDependencyGeometryChunks: [],
        crossDependencyReuseKeyByVisibleRef: new Map()
      }
    } satisfies TraceLayout;
    const rankLayer = new TraceProcessLayer({
      id: 'rank-binary-y-transform',
      threads: process.threads,
      spans: [],
      dependencies: [],
      binaryBlockData: {
        data: {
          length: 1,
          attributes: {
            getPosition: {value: new Float32Array([1, 2, 0]), size: 3},
            getSize: {value: new Float32Array([3, 4]), size: 2},
            getFillColor: {value: new Uint8Array([1, 2, 3, 4]), size: 4},
            getLineColor: {value: new Uint8Array([5, 6, 7, 8]), size: 4}
          }
        },
        spans: [],
        geometryXOffset: 7,
        geometryYOffset: 7
      },
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: process.processId,
      rankNum: process.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings(),
      modelMatrix: baseModelMatrix
    });
    const blockLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-rectangles')) as
      | {
          props: {
            modelMatrix?: Matrix4;
          };
        }
      | undefined;
    const borderLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-rectangle-borders')) as
      | {
          props: {
            modelMatrix?: Matrix4;
            visible?: boolean;
          };
        }
      | undefined;
    const labelLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-labels-above')) as
      | {
          props: {
            modelMatrix?: Matrix4;
          };
        }
      | undefined;

    expect(Array.from(blockLayer?.props.modelMatrix ?? []).slice(12, 15)).toEqual([18, 19, 0]);
    expect(borderLayer?.props.visible).toBe(false);
    expect(Array.from(borderLayer?.props.modelMatrix ?? []).slice(12, 15)).toEqual([18, 19, 0]);
    expect(Array.from(labelLayer?.props.modelMatrix ?? []).slice(12, 15)).toEqual([18, 19, 0]);
  });

  it('uses row-local binary block geometry for labels while keeping span inputs stable', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const spanRef = normalizeVisibleTraceGraphSource(graph).getVisibleProcessRenderSpanRefs(
      getRequiredProcessRef(normalizeVisibleTraceGraphSource(graph), process.processId)
    )[0]!;
    const invalidSpanRef = (spanRef + 1) as SpanRef;
    const spanRefs = [spanRef, invalidSpanRef];
    const layout = withProcessRenderRows(
      Object.assign(createLayout(graph), {
        spanGeometryMapBySpanRef: new Map([[spanRef, new Float32Array([100, 200, 130, 201])]])
      }),
      graph
    );
    const binaryBlockData = {
      data: {
        length: spanRefs.length,
        attributes: {
          getPosition: {value: new Float32Array([5, 6, 0, 9, 10, 0]), size: 3},
          getSize: {value: new Float32Array([20, 2, 0, 2]), size: 2},
          getFillColor: {value: new Uint8Array(8), size: 4},
          getLineColor: {value: new Uint8Array(8), size: 4}
        }
      },
      spans: spanRefs,
      geometryXOffset: 0,
      geometryYOffset: 0
    };
    const makeRankLayer = (settings: TraceVisSettings) =>
      new TraceProcessLayer({
        id: `rank-label-binary-geometry-${settings.enableFastTextLayer ? 'fast' : 'text'}`,
        threads: process.threads,
        spans: spanRefs,
        dependencies: [],
        binaryBlockData,
        selectedSpanRefs: [],
        selectedDependencies: [],
        rankIndex: 0,
        processId: process.processId,
        rankNum: process.rankNum,
        stepNum: 0,
        onSpanClick: () => undefined,
        traceLayout: layout,
        settings
      });
    const textLabelLayer = makeRankLayer(getTraceSettings())
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-labels-above')) as
      | {
          props: {
            data?: readonly SpanRef[];
            getContentBox: (source: SpanRef, info?: {index?: number}) => number[];
            getPosition: (source: SpanRef, info?: {index?: number}) => number[];
            updateTriggers: {
              getText: readonly unknown[];
            };
          };
        }
      | undefined;
    const fastTextLabelLayer = makeRankLayer({
      ...getTraceSettings(),
      enableFastTextLayer: true
    })
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-labels-above')) as
      | {
          props: {
            data?: readonly SpanRef[];
            getClipRect: (source: SpanRef, info?: {index?: number}) => number[];
            getPosition: (source: SpanRef, info?: {index?: number}) => number[];
            updateTriggers: {
              getText: readonly unknown[];
              getTextUtf8: readonly unknown[];
            };
          };
        }
      | undefined;

    expect(textLabelLayer?.props.data).toBe(spanRefs);
    expect(textLabelLayer?.props.getPosition(spanRef, {index: 0})).toEqual([5, 6.025]);
    expect(textLabelLayer?.props.getContentBox(spanRef, {index: 0})).toEqual([0, -1, 20, 2]);
    expect(textLabelLayer?.props.getPosition(invalidSpanRef, {index: 1})).toEqual([0, -1_000_000]);
    expect(textLabelLayer?.props.getContentBox(invalidSpanRef, {index: 1})).toEqual([0, 0, 0, 0]);
    expect(textLabelLayer?.props.updateTriggers.getText).toEqual([spanRefs.length, 0]);
    expect(fastTextLabelLayer?.props.data).toBe(spanRefs);
    expect(fastTextLabelLayer?.props.getPosition(spanRef, {index: 0})).toEqual([5, 6.025]);
    expect(fastTextLabelLayer?.props.getClipRect(spanRef, {index: 0})).toEqual([0, -1, 20, 2]);
    expect(fastTextLabelLayer?.props.getPosition(spanRef, {index: 1})).toEqual([0, -1_000_000]);
    expect(fastTextLabelLayer?.props.getClipRect(invalidSpanRef, {index: 1})).toEqual([0, 0, 0, 0]);
    expect(fastTextLabelLayer?.props.updateTriggers.getText).toEqual([spanRefs.length, 0]);
    expect(fastTextLabelLayer?.props.updateTriggers.getTextUtf8).toEqual([spanRefs.length, 0]);
  });

  it('adds left clearance only inside spans', () => {
    const graph = createGraph();
    const spanRef = normalizeVisibleTraceGraphSource(graph).getVisibleProcessRenderSpanRefs(
      getRequiredProcessRef(normalizeVisibleTraceGraphSource(graph), graph.processes[0]!.processId)
    )[0]!;
    const spanGeometry = new Float32Array([10, 20, 30, 21]);
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([[spanRef, spanGeometry]])
      } satisfies TraceLayout,
      graph
    );
    const makeRankLayer = (settings: TraceVisSettings) =>
      new TraceProcessLayer({
        id: `rank-label-inset-${settings.layoutDensity}`,
        threads: graph.processes[0]!.threads,
        spans: [spanRef],
        dependencies: [],
        selectedSpanRefs: [],
        selectedDependencies: [],
        rankIndex: 0,
        processId: graph.processes[0]!.processId,
        rankNum: graph.processes[0]!.rankNum,
        stepNum: 0,
        onSpanClick: () => undefined,
        traceLayout: layout,
        settings
      });
    const getSpanLabelLayerProps = (rankLayer: TraceProcessLayer, suffix: string) =>
      rankLayer.renderLayers()?.find(layer => layer?.id.endsWith(`block-labels-${suffix}`))
        ?.props as
        | {
            getContentBox: (source: typeof spanRef) => number[];
            getPixelOffset: readonly [number, number];
            getPosition: (source: typeof spanRef) => number[];
          }
        | undefined;

    const insideLabelProps = getSpanLabelLayerProps(
      makeRankLayer({...getTraceSettings(), layoutDensity: 'ultra-compact'}),
      'inside'
    );
    const aboveLabelProps = getSpanLabelLayerProps(
      makeRankLayer({...getTraceSettings(), layoutDensity: 'comfortable'}),
      'above'
    );

    expect(insideLabelProps?.getPosition(spanRef)).toEqual([10, 20]);
    expect(insideLabelProps?.getContentBox(spanRef)).toEqual([0, -0.5, 20, 2]);
    expect(insideLabelProps?.getPixelOffset).toEqual([6, 0]);
    expect(aboveLabelProps?.getPosition(spanRef)).toEqual([10, 20.025]);
    expect(aboveLabelProps?.getContentBox(spanRef)).toEqual([0, -1, 20, 2]);
    expect(aboveLabelProps?.getPixelOffset).toEqual([0, 0]);
  });

  it('keeps label glyph data for huge rows', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const spanRefs = Array.from({length: 5_001}, (_, index) => encodeSpanRef(0, index));
    const spanGeometryChunks = buildTraceLayoutSpanGeometryChunksForTest(
      spanRefs.map((spanRef, index) => [spanRef, new Float32Array([index, 0, index + 1, 1])])
    );
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        spanGeometryChunks
      } satisfies TraceLayout,
      graph
    );
    const rankLayer = new TraceProcessLayer({
      id: 'rank-huge-label-row',
      threads: process.threads,
      spans: spanRefs,
      dependencies: [],
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: process.processId,
      rankNum: process.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: {...getTraceSettings(), layoutDensity: 'ultra-compact'}
    });
    const labelLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-labels-inside')) as
      | {
          props: {
            data?: readonly SpanRef[];
            visible?: boolean;
          };
        }
      | undefined;

    expect(labelLayer?.props.visible).toBe(true);
    expect(labelLayer?.props.data).toHaveLength(spanRefs.length);
  });

  it('keeps collapsed binary layers mounted', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const spanRefs = [0, 1, 2] as SpanRef[];
    const binaryBlockData = {
      data: {
        length: spanRefs.length,
        attributes: {}
      },
      spans: spanRefs,
      geometryXOffset: 0,
      geometryYOffset: 0
    };
    const binaryDependencyLineData = {
      data: {
        length: 0,
        attributes: {}
      },
      dependencyRefs: [],
      geometryXOffset: 0,
      geometryYOffset: 0
    };
    const spanGeometryChunks = buildTraceLayoutSpanGeometryChunksForTest(
      spanRefs.map((spanRef, index) => [spanRef, new Float32Array([index, 0, index + 1, 1])])
    );
    const makeGeometryCache = (reuseKey: string) => ({
      processesById: {
        [process.processId]: {
          processId: process.processId,
          fastReuseKey: reuseKey,
          reuseKey,
          geometryXOffset: 0,
          geometryYOffset: 0,
          spanGeometryChunks,
          localDependencyGeometryChunks: []
        }
      },
      spanGeometryChunks,
      localDependencyGeometryChunks: [],
      crossDependencyGeometryChunks: [],
      crossDependencyReuseKeyByVisibleRef: new Map()
    });
    const expandedLayout = withProcessRenderRows(
      {
        ...createLayout(graph),
        geometryCache: makeGeometryCache('expanded-geometry'),
        spanGeometryChunks
      } satisfies TraceLayout,
      graph
    );
    const collapsedLayout = withProcessRenderRows(
      {
        ...expandedLayout,
        processLayouts: [
          {
            ...expandedLayout.processLayouts[0]!,
            isCollapsed: true
          }
        ],
        geometryCache: makeGeometryCache('collapsed-geometry')
      } satisfies TraceLayout,
      graph
    );
    const makeRankLayer = (traceLayout: TraceLayout) =>
      new TraceProcessLayer({
        id: 'rank-collapsed-label-row',
        threads: process.threads,
        spans: spanRefs,
        dependencies: [],
        binaryBlockData,
        binaryDependencyLineData,
        selectedSpanRefs: [],
        selectedDependencies: [],
        rankIndex: 0,
        processId: process.processId,
        rankNum: process.rankNum,
        stepNum: 0,
        onSpanClick: () => undefined,
        traceLayout,
        settings: {
          ...getTraceSettings(),
          layoutDensity: 'ultra-compact',
          lineRoutingMode: 'straight',
          showDependencies: true
        }
      });
    const getSublayers = (traceLayout: TraceLayout) => makeRankLayer(traceLayout).renderLayers();
    const expandedSublayers = getSublayers(expandedLayout);
    const collapsedSublayers = getSublayers(collapsedLayout);
    const getLayer = (layers: ReturnType<typeof getSublayers>, suffix: string) =>
      layers?.find(layer => layer?.id.endsWith(suffix)) as
        | {
            props: {
              data?: unknown;
              updateTriggers?: Record<string, unknown>;
              visible?: boolean;
            };
          }
        | undefined;

    const expandedBlockLayer = getLayer(expandedSublayers, 'block-rectangles');
    const collapsedBlockLayer = getLayer(collapsedSublayers, 'block-rectangles');
    const expandedDependencyLayer = getLayer(expandedSublayers, 'dependency-lines');
    const collapsedDependencyLayer = getLayer(collapsedSublayers, 'dependency-lines');
    const expandedLabelLayer = getLayer(expandedSublayers, 'block-labels-inside');
    const collapsedLabelLayer = getLayer(collapsedSublayers, 'block-labels-inside');

    expect(expandedBlockLayer?.props.visible).toBe(true);
    expect(collapsedBlockLayer?.props.visible).toBe(false);
    expect(expandedBlockLayer?.props.data).toBe(binaryBlockData.data);
    expect(collapsedBlockLayer?.props.data).toBe(binaryBlockData.data);
    expect(collapsedBlockLayer?.props.updateTriggers?.getPosition).toEqual(
      expandedBlockLayer?.props.updateTriggers?.getPosition
    );
    expect(collapsedBlockLayer?.props.updateTriggers?.getSize).toEqual(
      expandedBlockLayer?.props.updateTriggers?.getSize
    );
    expect(expandedDependencyLayer?.props.visible).toBe(true);
    expect(collapsedDependencyLayer?.props.visible).toBe(false);
    expect(expandedDependencyLayer?.props.data).toBe(binaryDependencyLineData.data);
    expect(collapsedDependencyLayer?.props.data).toBe(binaryDependencyLineData.data);
    expect(collapsedDependencyLayer?.props.updateTriggers?.getSourcePosition).toEqual(
      expandedDependencyLayer?.props.updateTriggers?.getSourcePosition
    );
    expect(collapsedDependencyLayer?.props.updateTriggers?.getTargetPosition).toEqual(
      expandedDependencyLayer?.props.updateTriggers?.getTargetPosition
    );
    expect(expandedLabelLayer?.props.visible).toBe(true);
    expect(collapsedLabelLayer?.props.visible).toBe(false);
    expect(expandedLabelLayer?.props.data).toBe(spanRefs);
    expect(collapsedLabelLayer?.props.data).toBe(spanRefs);
    expect(collapsedLabelLayer?.props.updateTriggers?.getPosition).toEqual(
      expandedLabelLayer?.props.updateTriggers?.getPosition
    );
    expect(collapsedLabelLayer?.props.updateTriggers?.getClipRect).toEqual(
      expandedLabelLayer?.props.updateTriggers?.getClipRect
    );
    expect(collapsedLabelLayer?.props.updateTriggers?.getText).toEqual(
      expandedLabelLayer?.props.updateTriggers?.getText
    );
  });

  it('keeps arrow markers mounted with binary straight dependency lines', () => {
    const graph = createDependencyGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const layout = withRuntimeTraceGraph(buildLayoutFromGraph(graph), runtimeGraph);
    const process = graph.processes[0]!;
    const row = getRowEnrichments(layout, graph)[0]!;
    const binaryDependencyLineData = {
      data: {
        length: row.dependencies.length,
        attributes: {}
      },
      dependencyRefs: row.dependencies,
      geometryXOffset: 0,
      geometryYOffset: 0
    };
    const rankLayer = new TraceProcessLayer({
      id: 'rank-binary-dependency-markers',
      threads: process.threads,
      spans: row.spans,
      dependencies: row.dependencies,
      binaryDependencyLineData,
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: process.processId,
      rankNum: process.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: {
        ...getTraceSettings(),
        lineRoutingMode: 'straight',
        showDependencies: true
      }
    });
    rankLayer.state = {};

    rankLayer.updateState({
      props: rankLayer.props,
      oldProps: {
        ...rankLayer.props,
        dependencies: [],
        binaryDependencyLineData: undefined
      }
    } as never);

    const visibleDependencyData = (rankLayer.state as {visibleDependencyData?: readonly unknown[]})
      .visibleDependencyData;
    const dependencyMarkerLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('dependency-markers')) as
      | DependencyArrowLayer<unknown>
      | undefined;

    expect(visibleDependencyData).toHaveLength(row.dependencies.length);
    expect(dependencyMarkerLayer).toBeInstanceOf(DependencyArrowLayer);
    expect(dependencyMarkerLayer?.props.data).toBe(visibleDependencyData);
    expect(dependencyMarkerLayer?.props._subLayerProps).toMatchObject({
      'links-line': {visible: false}
    });
  });

  it('does not rebuild non-binary dependency data when a process is hidden by collapse', () => {
    const graph = createDependencyGraph();
    const process = graph.processes[0]!;
    const layout = buildLayoutFromGraph(graph);
    const geometryEntry = layout.geometryCache?.processesById[process.processId];
    const collapsedLayout = {
      ...layout,
      processLayouts: [
        {
          ...layout.processLayouts[0]!,
          isCollapsed: true
        }
      ],
      geometryCache: {
        ...layout.geometryCache,
        spanGeometryChunks: layout.geometryCache?.spanGeometryChunks ?? [],
        localDependencyGeometryChunks: layout.geometryCache?.localDependencyGeometryChunks ?? [],
        crossDependencyGeometryChunks: layout.geometryCache?.crossDependencyGeometryChunks ?? [],
        processesById: {
          ...layout.geometryCache?.processesById,
          [process.processId]: {
            ...geometryEntry!,
            fastReuseKey: 'collapsed-dependency-geometry',
            reuseKey: 'collapsed-dependency-geometry'
          }
        },
        crossDependencyReuseKeyByVisibleRef:
          layout.geometryCache?.crossDependencyReuseKeyByVisibleRef ?? new Map()
      }
    } satisfies TraceLayout;
    const row = getRowEnrichments(layout, graph)[0]!;
    const settings = {
      ...getTraceSettings(),
      lineRoutingMode: 'curve',
      showDependencies: true
    } satisfies TraceVisSettings;
    const rankLayer = new TraceProcessLayer({
      id: 'rank-collapsed-non-binary-dependencies',
      threads: process.threads,
      spans: row.spans,
      dependencies: row.dependencies,
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: process.processId,
      rankNum: process.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings
    });

    rankLayer.renderLayers();
    const expandedDependencyData = (rankLayer.state as {visibleDependencyData?: readonly unknown[]})
      .visibleDependencyData;
    expect(expandedDependencyData?.length).toBeGreaterThan(0);

    rankLayer.updateState({
      props: {
        ...rankLayer.props,
        isCollapsed: true,
        traceLayout: collapsedLayout
      },
      oldProps: rankLayer.props
    } as never);

    expect(
      (rankLayer.state as {visibleDependencyData?: readonly unknown[]}).visibleDependencyData
    ).toBe(expandedDependencyData);
  });

  it('passes a synthetic thread to deck layers for combined rows', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const manyThreads = Array.from(
      {length: 3_000},
      (_, index) =>
        ({
          type: 'trace-thread',
          threadId: `thread-${index}` as TraceThreadId,
          processId: graph.processes[0]!.processId,
          name: `Thread ${index}`
        }) satisfies TraceThread
    );
    const row = {
      ...layout.renderRows[0]!,
      threads: manyThreads,
      threadRefs: manyThreads.map((_, index) => index as ThreadRef)
    } satisfies TraceLayoutRow;

    const layers = buildDeckLayersForTrace({
      processRows: [
        {
          row,
          spans: [],
          dependencies: [],
          collapsedActivityIntervals: [],
          overflowLabels: []
        }
      ],
      traceGraph: {crossDependencies: []},
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings('combine-threads'),
      colorScheme
    });
    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    const legendLayer = buildRuntimeDeckLayersForLegend({
      processRows: [row],
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings('combine-threads')
    }).find(layer => layer instanceof TraceLegendLayer) as TraceLegendLayer;

    expect(rankLayer.props.threads).toHaveLength(1);
    expect(rankLayer.props.threads[0]?.threadId).toBe('all_threads');
    expect(legendLayer.props.threads).toHaveLength(1);
    expect(legendLayer.props.threads[0]?.threadId).toBe('all_threads');
    expect(legendLayer.props.threadRefs).toBeUndefined();
  });

  it('keeps rank-layer bounds local when a rank has no local geometry', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        currentBounds: [
          [0, 0],
          [500, 500]
        ],
        threadLayoutMap: {
          [graph.processes[0]!.threads[0]!.threadId]: {
            ...createLayout(graph).threadLayoutMap[graph.processes[0]!.threads[0]!.threadId]!,
            visible: false
          }
        },
        processLayouts: [
          {
            ...createLayout(graph).processLayouts[0]!,
            threadLayouts: [
              {
                ...createLayout(graph).processLayouts[0]!.threadLayouts[0]!,
                visible: false
              }
            ]
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const rankLayer = new TraceProcessLayer({
      id: 'rank-local-bounds',
      threads: graph.processes[0]!.threads,
      spans: [],
      dependencies: [],
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: graph.processes[0]!.processId,
      rankNum: graph.processes[0]!.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    expect(rankLayer.getBounds()).toEqual([
      [-0.5, -0.5],
      [0.5, 1.5]
    ]);
  });

  it('includes collapsed activity intervals in rank-layer bounds without widening to trace bounds', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        currentBounds: [
          [0, 0],
          [500, 500]
        ],
        threadLayoutMap: {
          [graph.processes[0]!.threads[0]!.threadId]: {
            ...createLayout(graph).threadLayoutMap[graph.processes[0]!.threads[0]!.threadId]!,
            visible: false
          }
        },
        processLayouts: [
          {
            ...createLayout(graph).processLayouts[0]!,
            isCollapsed: true,
            collapsedActivityY: 0.25,
            threadLayouts: [
              {
                ...createLayout(graph).processLayouts[0]!.threadLayouts[0]!,
                visible: false
              }
            ]
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const rankLayer = new TraceProcessLayer({
      id: 'rank-collapsed-activity-bounds',
      threads: graph.processes[0]!.threads,
      spans: [],
      dependencies: [],
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: graph.processes[0]!.processId,
      rankNum: graph.processes[0]!.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings(),
      isCollapsed: true,
      collapsedActivityIntervals: [{startX: 10, endX: 20, activity: 1}]
    });

    expect(rankLayer.getBounds()).toEqual([
      [-0.5, -0.5],
      [20.5, 1.5]
    ]);
  });

  it('uses exact span-ref geometry for selected span outlines when span ids collide', () => {
    const graph = createGraph();
    const selectedSpanRef = encodeSpanRef(0, 0);
    const correctBbox = new Float32Array([10, 20, 30, 40]);
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([
          [selectedSpanRef, correctBbox]
        ])
      } satisfies TraceLayout,
      graph
    );
    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [selectedSpanRef],
      selectedDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const selectedLayer = layers.find(layer => layer.id.endsWith('selected-block-overlays')) as
      | (AnimationLayer<PathLayer<SpanRef>> & {
          props: {
            layer: PathLayer<SpanRef> & {
              props: {
                data: readonly SpanRef[];
                getPath: (source: SpanRef) => number[][];
                widthMinPixels: number;
              };
            };
          };
        })
      | undefined;
    const outlineLayer = selectedLayer?.props.layer;

    expect(selectedLayer).toBeInstanceOf(AnimationLayer);
    expect(selectedLayer?.props.parameters).toEqual({
      blend: true,
      depthTest: true,
      depthWriteEnabled: true,
      depthCompare: 'less'
    });
    expect(outlineLayer).toBeInstanceOf(PathLayer);
    expect(outlineLayer?.props.data).toEqual([selectedSpanRef]);
    expect(outlineLayer?.props.getPath(selectedSpanRef)).toEqual([
      [10, 20],
      [30, 20],
      [30, 40],
      [10, 40],
      [10, 20]
    ]);
    expect(outlineLayer?.props.widthMinPixels).toBe(4);
  });

  it('renders selected span outlines from the scene-level overlay layer', () => {
    const graph = createMultiGraph();
    const runtimeGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(graph));
    const selectedSpanRef = encodeSpanRef(0, 0);
    const selectedBbox = new Float32Array([10, 20, 30, 40]);
    const layout = {
      ...createLayout(graph),
      traceGraph: runtimeGraph,
      spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([
        [selectedSpanRef, selectedBbox]
      ])
    } satisfies TraceLayout;
    const firstLayers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph).filter(
        rowEnrichment => rowEnrichment.row.processId === graph.processes[0]!.processId
      ),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [selectedSpanRef],
      selectedDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const secondLayers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph).filter(
        rowEnrichment => rowEnrichment.row.processId === graph.processes[1]!.processId
      ),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [selectedSpanRef],
      selectedDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const firstSelectedLayer = firstLayers.find(layer =>
      layer.id.endsWith('selected-block-overlays')
    ) as AnimationLayer<PathLayer<SpanRef>> | undefined;
    const secondSelectedLayer = secondLayers.find(layer =>
      layer.id.endsWith('selected-block-overlays')
    ) as AnimationLayer<PathLayer<SpanRef>> | undefined;

    expect(firstSelectedLayer?.props.layer.props.data).toEqual([selectedSpanRef]);
    expect(secondSelectedLayer?.props.layer.props.data).toEqual([selectedSpanRef]);
  });

  it('uses an animated path layer for selected span outlines', () => {
    const graph = createGraph();
    const selectedSpanRef = encodeSpanRef(0, 0);
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const rowEnrichment = getRowEnrichments(layout, graph)[0]!;
    const modelMatrix = new Matrix4().translate([11, 13, 0]);
    const layers = buildDeckLayersForTrace({
      processRows: [rowEnrichment],
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [selectedSpanRef],
      selectedDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings(),
      modelMatrix
    });

    const selectedLayer = layers.find(layer => layer.id.endsWith('selected-block-overlays')) as
      | AnimationLayer<PathLayer<SpanRef>>
      | undefined;
    const outlineLayer = selectedLayer?.props.layer;
    const selectedLayerIndex = layers.findIndex(layer =>
      layer.id.endsWith('selected-block-overlays')
    );

    expect(layers.find(layer => layer.id.endsWith('selected-block-halo'))).toBeUndefined();
    expect(selectedLayerIndex).toBeGreaterThanOrEqual(0);
    expect(selectedLayer).toBeInstanceOf(AnimationLayer);
    expect(outlineLayer).toBeInstanceOf(PathLayer);
    expect(outlineLayer?.props.modelMatrix).toBe(modelMatrix);
    expect(outlineLayer?.props.widthMinPixels).toBe(4);
    expect((outlineLayer?.props as {getOffset?: number} | undefined)?.getOffset).toBe(0.5);
    expect(outlineLayer?.props.extensions).toEqual([new PathStyleExtension({offset: true})]);
    expect(outlineLayer?.props.pickable).toBe(false);
    expect(outlineLayer?.props.onClick).toBeNull();
    expect(outlineLayer?.props.parameters).toEqual({
      blend: true,
      depthTest: true,
      depthWriteEnabled: true,
      depthCompare: 'less'
    });
    const animationFrames = selectedLayer?.props.frames.frames as
      | {
          duration: number;
          easing?: (t: number) => number;
          props: {getColor: number[]};
        }[]
      | undefined;
    expect(selectedLayer?.props.repeatType).toBe('loop');
    expect(animationFrames).toHaveLength(2);
    expect(animationFrames?.[0]).toMatchObject({
      duration: 1200,
      props: {
        getColor: [255, 0, 0, 255]
      }
    });
    expect(animationFrames?.[1]).toMatchObject({
      duration: 1200,
      props: {
        getColor: [0, 0, 0, 255]
      }
    });
    expect(typeof animationFrames?.[0]?.easing).toBe('function');
    expect(animationFrames?.[0]?.easing?.(0)).toBe(0);
    expect(animationFrames?.[0]?.easing?.(0.5)).toBeCloseTo(0.5);
    expect(animationFrames?.[0]?.easing?.(1)).toBe(1);
  });

  it('uses fixed selected span outline colors', () => {
    const graph = createGraph();
    const selectedSpanRef = encodeSpanRef(0, 0);
    const layout = withRuntimeTraceGraph(
      createLayout(graph),
      normalizeVisibleTraceGraphSource(graph)
    );
    const rowEnrichment = getRowEnrichments(layout, graph)[0]!;
    const selectedFillColor = [17, 34, 51, 255] as const;
    const colorScheme: TraceColorScheme = {
      id: 'selected-outline-color',
      name: 'Selected Outline Color',
      getSpanStyle: ({span}) =>
        span.spanRef === selectedSpanRef
          ? {
              spanFillColor: selectedFillColor,
              spanBorderColor: [201, 202, 203, 255]
            }
          : undefined
    };
    const layers = buildDeckLayersForTrace({
      processRows: [rowEnrichment],
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [selectedSpanRef],
      selectedDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings(),
      colorScheme
    });

    const selectedLayer = layers.find(layer => layer.id.endsWith('selected-block-overlays')) as
      | AnimationLayer<PathLayer<SpanRef>>
      | undefined;

    const getColor = selectedLayer?.props.layer.props.getColor;
    expect(getColor).toEqual([0, 0, 0, 255]);
    expect(getColor).not.toEqual(selectedFillColor);
  });

  it('keeps renderRows stable when unrelated display settings change', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const rebuiltLayout = {
      ...layout,
      spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([
        [encodeSpanRef(0, 0), new Float32Array([0, 1, 2, 3])]
      ])
    } satisfies TraceLayout;

    expect(rebuiltLayout.renderRows).toBe(layout.renderRows);
    expect(getSingleRow(rebuiltLayout).threads).toBe(getSingleRow(layout).threads);
  });
});

describe('prepared scene derived data', () => {
  beforeEach(() => {
    __resetDerivedTraceDataCacheForTests();
  });

  it('caches collapsed-activity interval derivation per row', () => {
    const graph = createMultiGraph();
    const runtimeGraph = createRuntimeGraph(graph);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const collapsedActivityByProcessId = {
      [graph.processes[0]!.processId]: [{startX: 9, endX: 10, activity: 1}],
      [graph.processes[1]!.processId]: [{startX: 1, endX: 2, activity: 2}]
    } satisfies Record<string, TraceProcessActivityInterval[]>;

    const first = getMemoizedTraceLayoutRowEnrichments({
      traceLayout: layout,
      collapsedActivityByProcessId
    });
    const second = getMemoizedTraceLayoutRowEnrichments({
      traceLayout: layout,
      collapsedActivityByProcessId
    });

    expect(second).toBe(first);
    expect(second[0]?.collapsedActivityIntervals).toBe(first[0]?.collapsedActivityIntervals);
    expect(second[0]?.collapsedActivityIntervals).toEqual([{startX: 9, endX: 10, activity: 1}]);
    expect(second[1]?.collapsedActivityIntervals).toEqual([{startX: 1, endX: 2, activity: 2}]);
  });

  it('prefers span refs when enriching row overflow labels', () => {
    __resetDerivedTraceDataCacheForTests();
    const graph = createMultiGraph();
    const runtimeTraceGraph = createRuntimeGraph(graph);
    const baseLayout = createLayout(graph);
    const processLayoutsWithOverflowLabels = baseLayout.processLayouts.map(processLayout => ({
      ...processLayout,
      threadLayouts: processLayout.threadLayouts.map(threadLayout => ({
        ...threadLayout,
        overflowSpanCount: 1,
        overflowLabel: {
          text: '1 deeper span hidden',
          x: 0,
          y: threadLayout.yPosition,
          z: 0,
          view: 'main'
        }
      }))
    }));
    const layout = withRuntimeTraceGraph(
      {
        ...baseLayout,
        processLayouts: processLayoutsWithOverflowLabels
      } satisfies TraceLayout,
      runtimeTraceGraph
    );
    const renderSpansSpy = vi.spyOn(runtimeTraceGraph, 'getVisibleProcessRenderSpans');
    const renderSpanRefsSpy = vi.spyOn(runtimeTraceGraph, 'getVisibleProcessRenderSpanRefs');
    const visibleDisplaySourcesSpy = vi.spyOn(runtimeTraceGraph, 'getVisibleProcessDisplaySources');

    getMemoizedTraceLayoutRowEnrichments({
      traceLayout: layout,
      collapsedActivityByProcessId: {}
    });

    expect(renderSpanRefsSpy).not.toHaveBeenCalled();
    expect(renderSpansSpy).toHaveBeenCalledWith(
      getRequiredProcessRef(runtimeTraceGraph, graph.processes[0]!.processId)
    );
    expect(renderSpansSpy).toHaveBeenCalledWith(
      getRequiredProcessRef(runtimeTraceGraph, graph.processes[1]!.processId)
    );
    expect(visibleDisplaySourcesSpy).toHaveBeenCalledWith(
      getRequiredProcessRef(runtimeTraceGraph, graph.processes[0]!.processId)
    );
    expect(visibleDisplaySourcesSpy).toHaveBeenCalledWith(
      getRequiredProcessRef(runtimeTraceGraph, graph.processes[1]!.processId)
    );
  });

  it('derives positions, colors, and legend rows from the graph and layout', () => {
    const graph = createGraph();
    const materializedGraph = materializeJSONTrace(graph);
    const runtimeGraph = createRuntimeGraph(graph);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const {instants, counters, legendRows} = getMemoizedDerivedTraceData({
      traceGraph: runtimeGraph,
      traceLayout: layout,
      colorScheme,
      settings: getTraceSettings()
    });

    const instant = graph.processes[0]!.instants[0]!;
    const instantRef = runtimeGraph.getInstantSources()[0]!.instantRef;
    const instantPosition = instants.positionMap.get(instantRef);
    expect(instantPosition).toEqual([instant.atTimeMs! - materializedGraph.minTimeMs, 1, 0]);
    expect(instants.colorMap.get(instantRef)).toEqual(instant.userData?.color);

    expect(counters.sparklineData).toHaveLength(1);
    const [counter, counterTail] = graph.processes[0]!.counters;
    const counterRef = runtimeGraph.getCounterSources()[0]!.counterRef;
    const counterPosition = counters.positionMap.get(counterRef);
    expect(counterPosition?.[0]).toBeCloseTo(counter.atTimeMs! - materializedGraph.minTimeMs, 6);
    expect(counterPosition?.[1]).toBeCloseTo(1.3, 6);

    const sparkline = counters.sparklineData[0]!;
    expect(sparkline.path).toHaveLength(2);
    expect(sparkline.color).toEqual(counterTail.userData?.color);
    expect(legendRows).toHaveLength(graph.processes.length);
    expect(legendRows[0]?.processId).toBe(graph.processes[0]!.processId);
  });
});
