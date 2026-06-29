import {PathStyleExtension} from '@deck.gl/extensions';
import {Matrix4} from '@math.gl/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  __resetDerivedTraceDataCacheForTests,
  buildJSONTrace,
  buildTraceLayoutRows as buildRuntimeTraceLayoutRows,
  buildTraceLayouts as buildRuntimeTraceLayouts,
  buildTraceGraphDataFromJSONTrace,
  buildTracePreparedProcessRows,
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  getMemoizedDerivedTraceData as getRuntimeMemoizedDerivedTraceData,
  getMemoizedTraceLayoutRowEnrichments as getRuntimeMemoizedTraceLayoutRowEnrichments,
  getSelectedLocalDependencyLineColor,
  materializeJSONTrace,
  shouldShowLocalDependencyByModeFields,
  TraceGraph
} from '../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../trace/trace-chunk-store';
import {buildVisibleTraceGraph} from '../../trace/trace-layout/trace-geometry-layout-helpers';
import {
  buildDeckLayerForTraceProcessActivitySummary,
  buildDeckLayersForGrid,
  buildDeckLayersForMinimapSpanIndicators,
  buildDeckRowSeparatorLayerForTrace,
  buildOverviewLayers,
  buildDeckLayersForLegend as buildRuntimeDeckLayersForLegend,
  buildDeckLayersForTrace as buildRuntimeDeckLayersForTrace
} from './deck-layers';
import {TraceCrossDependencyLayer} from './trace-cross-dependency-layer';
import {TraceProcessLayer} from './trace-process-layer';
import {getViewportHighlightOverlayData, ViewportHighlightLayer} from './viewport-highlight-layer';

import type {
  CollapsedActivityByProcessRef,
  JSONTrace,
  SpanRef,
  ThreadLayout,
  ThreadRef,
  TraceColorScheme,
  TraceCounter,
  TraceCounterId,
  TraceCrossDependencySource,
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
import type {Bounds} from '@deck.gl-community/infovis-layers';

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

/** Returns one required runtime thread ref for a process-local test thread id. */
function getRequiredThreadRef(
  traceGraph: TraceGraph,
  processId: string,
  threadId: TraceThreadId
): ThreadRef {
  const threadRef = traceGraph
    .getThreadRefsByProcessRef(getRequiredProcessRef(traceGraph, processId))
    .find(
      candidateThreadRef =>
        traceGraph.getThreadSourceByRef(candidateThreadRef)?.threadId === threadId
    );
  if (threadRef == null) {
    throw new Error(`Expected thread ref for ${processId}:${threadId}`);
  }
  return threadRef;
}

/** Returns one required runtime thread ref from a test layout graph. */
function getLayoutThreadRef(
  layout: TraceLayout,
  processId: string,
  threadId: TraceThreadId
): ThreadRef {
  const traceGraph = layout.traceGraph;
  if (!(traceGraph instanceof TraceGraph)) {
    throw new Error('Expected runtime TraceGraph');
  }
  return getRequiredThreadRef(traceGraph, processId, threadId);
}

/** Returns one required runtime thread layout for a process-local test thread id. */
function getLayoutThread(
  layout: TraceLayout,
  processId: string,
  threadId: TraceThreadId
): ThreadLayout {
  const threadLayout = layout.threadLayoutMapByRef.get(
    getLayoutThreadRef(layout, processId, threadId)
  );
  if (!threadLayout) {
    throw new Error(`Expected thread layout for ${processId}:${threadId}`);
  }
  return threadLayout;
}

/** Returns a thread-layout map with one process-local test thread layout replaced. */
function setLayoutThread(
  layout: TraceLayout,
  processId: string,
  threadId: TraceThreadId,
  threadLayout: ThreadLayout
): ReadonlyMap<ThreadRef, ThreadLayout> {
  return new Map(layout.threadLayoutMapByRef).set(
    getLayoutThreadRef(layout, processId, threadId),
    threadLayout
  );
}

/** Overrides active filtered-span counts on one test layout runtime graph. */
function setFilteredSpanCountByThreadRef(
  layout: TraceLayout,
  filteredSpanCountByThreadRef: ReadonlyMap<ThreadRef, number>
): void {
  const traceGraph = layout.traceGraph;
  if (!(traceGraph instanceof TraceGraph)) {
    throw new Error('Expected runtime TraceGraph');
  }
  Object.assign(traceGraph, {
    hasActiveSpanFilter: () => true,
    getFilteredSpanCountByThreadRef: () => filteredSpanCountByThreadRef
  });
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

function normalizeTraceLayoutRowSourceGraph(
  traceGraph: Parameters<typeof buildRuntimeTraceLayoutRows>[0]['traceGraph'] | JSONTrace
): Parameters<typeof buildRuntimeTraceLayoutRows>[0]['traceGraph'] {
  if (traceGraph instanceof TraceGraph) {
    return buildVisibleTraceGraph(traceGraph);
  }
  return isJSONTraceLike(traceGraph)
    ? buildVisibleTraceGraph(normalizeVisibleTraceGraphSource(traceGraph))
    : traceGraph;
}

function normalizeVisibleTraceGraphSource(traceGraph: JSONTrace): TraceGraph {
  const cachedVisibleTraceGraph = visibleTraceGraphCache.get(traceGraph);
  if (cachedVisibleTraceGraph) {
    if (
      'hasActiveSpanFilter' in traceGraph &&
      typeof traceGraph.hasActiveSpanFilter === 'function' &&
      'getFilteredSpanCountByThreadRef' in traceGraph &&
      typeof traceGraph.getFilteredSpanCountByThreadRef === 'function'
    ) {
      Object.assign(cachedVisibleTraceGraph, {
        hasActiveSpanFilter: traceGraph.hasActiveSpanFilter.bind(traceGraph),
        getFilteredSpanCountByThreadRef: traceGraph.getFilteredSpanCountByThreadRef.bind(traceGraph)
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
    'getFilteredSpanCountByThreadRef' in traceGraph &&
    typeof traceGraph.getFilteredSpanCountByThreadRef === 'function'
  ) {
    Object.assign(normalizedTraceGraph, {
      hasActiveSpanFilter: traceGraph.hasActiveSpanFilter.bind(traceGraph),
      getFilteredSpanCountByThreadRef: traceGraph.getFilteredSpanCountByThreadRef.bind(traceGraph)
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
  const processRows = buildLegacyPreparedProcessRows({
    graph: runtimeGraph,
    layout: traceLayout,
    processRows: params.processRows,
    settings: params.settings,
    colorScheme: params.colorScheme
  });
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
      rows: processRows,
      spanBinaryLocationByRef: buildPreparedSpanBinaryLocationByRef(processRows),
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

/** Builds binary-backed process rows while preserving test-owned row enrichments. */
function buildLegacyPreparedProcessRows(params: {
  /** Runtime graph that owns row-local span refs. */
  graph: TraceGraph;
  /** Current lane layout used to derive binary span rectangles. */
  layout: TraceLayout;
  /** Existing test row enrichments whose activity and overflow labels should be retained. */
  processRows: BuildDeckLayersForTraceParams['scene']['rows'];
  /** Render settings used to build row-local binary attributes. */
  settings: TraceVisSettings;
  /** Optional color scheme used for binary block colors. */
  colorScheme?: TraceColorScheme;
}): BuildDeckLayersForTraceParams['scene']['rows'] {
  const preparedRowsByProcessRef = new Map(
    buildTracePreparedProcessRows({
      graph: params.graph,
      layout: params.layout,
      settings: params.settings,
      colorScheme: params.colorScheme
    }).map(row => [row.row.processRef, row])
  );
  return params.processRows.map(row => {
    const preparedRow = preparedRowsByProcessRef.get(row.row.processRef);
    return preparedRow
      ? {
          ...preparedRow,
          collapsedActivityIntervals: row.collapsedActivityIntervals,
          overflowLabels: row.overflowLabels
        }
      : row;
  });
}

/** Builds the ref-only lookup used by prepared binary selected-span overlays. */
function buildPreparedSpanBinaryLocationByRef(
  rows: BuildDeckLayersForTraceParams['scene']['rows']
): NonNullable<BuildDeckLayersForTraceParams['scene']['spanBinaryLocationByRef']> {
  const spanBinaryLocationByRef = new Map<SpanRef, {rowIndex: number; spanIndex: number}>();
  rows.forEach((row, rowIndex) => {
    row.binaryBlockData?.spans.forEach((spanRef, spanIndex) => {
      spanBinaryLocationByRef.set(spanRef, {rowIndex, spanIndex});
    });
  });
  return spanBinaryLocationByRef;
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

function createMultiGraph(): JSONTrace {
  return buildJSONTrace([createRank('rank-1'), createRank('rank-2')], [], {
    name: 'test-graph-multi'
  });
}

/** Builds two processes connected by one cross-process dependency. */
function createCrossDependencyGraph(): JSONTrace {
  const startRank = createRank('rank-1');
  const endRank = {...createRank('rank-2'), rankNum: 1} satisfies TraceProcess;
  const crossDependency = {
    type: 'trace-cross-process-dependency',
    dependencyId: 'cross-dep-hidden-base' as TraceCrossProcessDependency['dependencyId'],
    endpointId: 'cross-dep-hidden-base:endpoint' as TraceCrossProcessDependency['endpointId'],
    startRankNum: startRank.rankNum,
    endRankNum: endRank.rankNum,
    startSpanId: startRank.spans[0]!.spanId,
    endSpanId: endRank.spans[0]!.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'cross',
    waitTimeMs: 2_000,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set<string>()
  } satisfies TraceCrossProcessDependency;
  return buildJSONTrace([startRank, endRank], [crossDependency], {
    name: 'cross-dependency-graph'
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

/** Builds local and cross-process dependencies whose geometry resolves through the runtime graph. */
function createDependencyAndCrossDependencyGraph(): JSONTrace {
  const localDependencyGraph = materializeJSONTrace(createDependencyGraph());
  const startRank = localDependencyGraph.processes[0]!;
  const endRank = {...createRank('rank-2'), rankNum: 1} satisfies TraceProcess;
  const crossDependency = {
    type: 'trace-cross-process-dependency',
    dependencyId: 'cross-visible-arrow' as TraceCrossProcessDependency['dependencyId'],
    endpointId: 'cross-visible-arrow:endpoint' as TraceCrossProcessDependency['endpointId'],
    startRankNum: startRank.rankNum,
    endRankNum: endRank.rankNum,
    startSpanId: startRank.spans[0]!.spanId,
    endSpanId: endRank.spans[0]!.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'cross',
    waitTimeMs: 100,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set<string>()
  } satisfies TraceCrossProcessDependency;
  return buildJSONTrace([startRank, endRank], [crossDependency], {
    name: 'dependency-and-cross-graph'
  });
}

function createLayout(graph: JSONTrace): TraceLayout {
  const traceGraph = normalizeVisibleTraceGraphSource(graph);
  const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
  const processLayouts = graph.processes.map((process, rankIndex) => {
    const yPosition = rankIndex * 2 + 1;
    const processRef = getRequiredProcessRef(traceGraph, process.processId);
    const threadRef = getRequiredThreadRef(
      traceGraph,
      process.processId,
      process.threads[0]!.threadId
    );
    const streamLayout = {
      threadRef,
      visible: true,
      yPosition,
      startPosition: [0, yPosition, 0] as [number, number, number],
      targetPosition: [0, yPosition, 0] as [number, number, number]
    };
    threadLayoutMapByRef.set(threadRef, streamLayout);

    return {
      processRef,
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
      traceGraph,
      layoutConfiguration: {laneSeparation: 0.7},
      processLayouts,
      processLayoutMapByRef: new Map(
        processLayouts.map(processLayout => [processLayout.processRef, processLayout])
      ),
      renderRows: [],
      threadLayoutMapByRef,
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

/** Returns one test layout with render rows derived from the supplied graph. */
function withProcessRenderRows(layout: TraceLayout, graph: JSONTrace | TraceGraph): TraceLayout {
  return {
    ...layout,
    renderRows: buildTraceLayoutRows({
      traceGraph: graph instanceof TraceGraph ? buildVisibleTraceGraph(graph) : graph,
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

/** Returns one layout with a process row collapsed or expanded consistently. */
function withProcessCollapsed(
  layout: TraceLayout,
  processRef: TraceLayoutRow['processRef'],
  isCollapsed: boolean
): TraceLayout {
  const processLayouts = layout.processLayouts.map(processLayout =>
    processLayout.processRef === processRef ? {...processLayout, isCollapsed} : processLayout
  );
  return {
    ...layout,
    processLayouts,
    processLayoutMapByRef: new Map(
      processLayouts.map(processLayout => [processLayout.processRef, processLayout])
    ),
    renderRows: layout.renderRows.map(row =>
      row.processRef === processRef ? {...row, isCollapsed} : row
    )
  };
}

function getRowEnrichments(
  layout: TraceLayout,
  graph: JSONTrace,
  collapsedActivityByProcessRef?: CollapsedActivityByProcessRef,
  localDependencyMode: TraceVisSettings['localDependencyMode'] = 'all'
) {
  const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
  return getMemoizedTraceLayoutRowEnrichments({
    traceLayout: {
      ...layout,
      traceGraph: runtimeGraph
    },
    collapsedActivityByProcessRef
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

const colorScheme: TraceColorScheme = {
  id: 'test',
  name: 'Test',
  getThreadColor: () => [1, 2, 3, 4]
};

describe('prepared scene memoization', () => {
  beforeEach(() => {
    __resetDerivedTraceDataCacheForTests();
  });

  it('returns the same references for identical inputs', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        processLayouts: [
          {
            ...createLayout(graph).processLayouts[0]!,
            isCollapsed: true
          }
        ]
      } satisfies TraceLayout,
      graph
    );
    const first = getMemoizedDerivedTraceData({
      traceGraph: graph,
      traceLayout: layout,
      colorScheme
    });
    const second = getMemoizedDerivedTraceData({
      traceGraph: graph,
      traceLayout: layout,
      colorScheme
    });

    expect(second).toBe(first);
    expect(second.instants).toBe(first.instants);
    expect(second.counters).toBe(first.counters);
  });

  it('invalidates cache when any key input changes', () => {
    const graph = createGraph();
    const layout = createLayout(graph);
    const first = getMemoizedDerivedTraceData({
      traceGraph: graph,
      traceLayout: layout,
      colorScheme
    });

    const updatedColorScheme: TraceColorScheme = {
      id: 'updated-test',
      name: 'Updated Test',
      getThreadColor: () => [9, 9, 9, 9]
    };
    const layoutClone = {...layout, threadLayoutMapByRef: new Map(layout.threadLayoutMapByRef)};
    const second = getMemoizedDerivedTraceData({
      traceGraph: graph,
      traceLayout: layoutClone,
      colorScheme: updatedColorScheme
    });

    expect(second).not.toBe(first);
    expect(second.instants).not.toBe(first.instants);
    expect(second.counters).not.toBe(first.counters);
  });

  it('creates distinct cache entries when build flags change', () => {
    const graph = createGraph();
    const layout = createLayout(graph);
    const first = getMemoizedDerivedTraceData({
      traceGraph: graph,
      traceLayout: layout,
      colorScheme,
      buildInstants: true,
      buildCounters: true
    });
    const second = getMemoizedDerivedTraceData({
      traceGraph: graph,
      traceLayout: layout,
      colorScheme,
      buildInstants: true,
      buildCounters: false
    });

    expect(second).not.toBe(first);
    expect(second.counters.counterPoints).toHaveLength(0);
    expect(second.counters.sparklineData).toHaveLength(0);
  });

  it('rebuilds hidden collapsed row binary span data after re-expand', () => {
    const graph = createGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const process = graph.processes[0]!;
    const processRef = getRequiredProcessRef(runtimeGraph, process.processId);
    const settings = getTraceSettings();
    const expandedLayout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const collapsedLayout = withProcessCollapsed(expandedLayout, processRef, true);

    const expandedRows = buildTracePreparedProcessRows({
      graph: runtimeGraph,
      layout: expandedLayout,
      settings,
      colorScheme
    });
    const collapsedRows = buildTracePreparedProcessRows({
      graph: runtimeGraph,
      layout: collapsedLayout,
      settings,
      colorScheme,
      previousRows: expandedRows
    });
    const reexpandedRows = buildTracePreparedProcessRows({
      graph: runtimeGraph,
      layout: expandedLayout,
      settings,
      colorScheme,
      previousRows: collapsedRows
    });

    expect(collapsedRows[0]?.binaryBlockData).not.toBe(expandedRows[0]?.binaryBlockData);
    expect(reexpandedRows[0]?.binaryBlockData).not.toBe(collapsedRows[0]?.binaryBlockData);
    expect(reexpandedRows[0]?.binaryBlockData?.spans).toBe(reexpandedRows[0]?.spans);
    const collapsedSizes = collapsedRows[0]?.binaryBlockData?.data.attributes.getSize?.value as
      | Float32Array
      | undefined;
    const reexpandedPositions = reexpandedRows[0]?.binaryBlockData?.data.attributes.getPosition
      ?.value as Float32Array | undefined;
    const reexpandedSizes = reexpandedRows[0]?.binaryBlockData?.data.attributes.getSize?.value as
      | Float32Array
      | undefined;
    expect(Array.from(reexpandedPositions ?? []).every(Number.isFinite)).toBe(true);
    expect(Array.from(reexpandedSizes ?? []).every(Number.isFinite)).toBe(true);
    expect(collapsedSizes?.[1]).toBe(0);
    expect(reexpandedSizes?.[0]).toBeGreaterThan(0);
    expect(reexpandedSizes?.[1]).toBeGreaterThan(0);
  });
});

describe('overview layers', () => {
  it('renders the main time grid with a strict depth test without writing depth', () => {
    const [gridLayer] = buildDeckLayersForGrid({
      minTimeMs: 0,
      maxTimeMs: 100
    });
    const gridLayerProps = gridLayer?.props as
      | {
          _subLayerProps?: Record<string, unknown>;
          modelMatrix?: Matrix4;
          parameters?: unknown;
        }
      | undefined;

    expect(gridLayerProps?.parameters).toEqual({
      blend: false,
      depthWriteEnabled: false,
      depthCompare: 'less'
    });
    expect(gridLayerProps?._subLayerProps).toMatchObject({
      'axis-line': {
        parameters: {
          blend: false,
          depthWriteEnabled: false,
          depthCompare: 'less'
        }
      },
      'tick-marks': {
        parameters: {
          blend: false,
          depthWriteEnabled: false,
          depthCompare: 'less'
        }
      }
    });
    expect(Array.from(gridLayerProps?.modelMatrix ?? []).slice(12, 15)).toEqual([0, -12, -1]);
  });

  it('renders minimap grid labels and the time axis at the top', () => {
    const formatTick = vi.fn();
    const layers = buildOverviewLayers({
      bounds: [
        [0, 0],
        [100, 10]
      ],
      highlightViewportId: 'main',
      formatTick
    });

    const gridLayer = layers.find(layer => layer.id === 'minimap-time-grids') as
      | {
          props: {
            tickLabels?: boolean;
            formatTick?: unknown;
            minY?: number;
            maxY?: number;
            labelY?: number;
          };
        }
      | undefined;
    const axisLayer = layers.find(layer => layer.id === 'minimap-time-axis') as
      | {
          props: {
            data?: readonly (readonly [number, number][])[];
            getColor?: readonly number[];
            getWidth?: number;
          };
        }
      | undefined;

    expect(gridLayer?.props.tickLabels).toBe(true);
    expect(gridLayer?.props.formatTick).toBe(formatTick);
    expect(gridLayer?.props.minY).toBe(0);
    expect(gridLayer?.props.maxY).toBe(10);
    expect(gridLayer?.props.labelY).toBe(1.6);
    expect(axisLayer?.props.data).toEqual([
      [
        [0, 0],
        [100, 0]
      ]
    ]);
    expect(axisLayer?.props.getColor).toEqual([0, 0, 0, 90]);
    expect(axisLayer?.props.getWidth).toBe(1);
    expect(layers.some(layer => layer.id === 'minimap-interaction-surface')).toBe(false);
    expect(layers.some(layer => layer.id === 'minimap-overview-label')).toBe(false);
  });

  it('renders minimap run event markers inside the overview bounds', () => {
    const layers = buildOverviewLayers({
      bounds: [
        [0, 0],
        [100, 10]
      ],
      highlightViewportId: 'main',
      eventMarkers: [
        {
          id: 'event-a',
          x: 42,
          object: {type: 'trace-event', eventId: 'event-a'}
        }
      ]
    });
    const eventLayer = layers.find(layer => layer.id === 'minimap-model-timeline-events') as
      | {
          props: {
            data: Array<{x: number; y: number}>;
            getPosition: (datum: {x: number; y: number}) => number[];
            pickable?: boolean;
          };
        }
      | undefined;

    expect(eventLayer?.props.pickable).toBe(true);
    expect(eventLayer?.props.data[0]?.y).toBeGreaterThan(0);
    expect(eventLayer?.props.data[0]?.y).toBeLessThan(10);
    const position = eventLayer?.props.getPosition(eventLayer.props.data[0]!);
    expect(position?.[0]).toBe(42);
    expect(position?.[1]).toBeCloseTo(0.7);
  });

  it('keeps optional overview layers mounted when they have no data', () => {
    const layers = buildOverviewLayers({
      bounds: [
        [0, 0],
        [100, 10]
      ],
      highlightViewportId: 'main'
    }) as Array<{
      id: string;
      props: {
        data?: readonly unknown[];
        visible?: boolean;
      };
    }>;
    const unloadedIntervalsLayer = layers.find(layer => layer.id === 'minimap-unloaded-intervals');
    const unloadedLabelsLayer = layers.find(
      layer => layer.id === 'minimap-unloaded-interval-labels'
    );
    const eventLayer = layers.find(layer => layer.id === 'minimap-model-timeline-events');

    expect(unloadedIntervalsLayer?.props.visible).toBe(false);
    expect(unloadedIntervalsLayer?.props.data).toHaveLength(0);
    expect(unloadedLabelsLayer?.props.visible).toBe(false);
    expect(unloadedLabelsLayer?.props.data).toHaveLength(0);
    expect(eventLayer?.props.visible).toBe(false);
    expect(eventLayer?.props.data).toHaveLength(0);
  });

  it('keeps minimap time grids for zero-width overview bounds', () => {
    const layers = buildOverviewLayers({
      bounds: [
        [0, 0],
        [0, 10]
      ],
      highlightViewportId: 'main'
    });

    const gridLayer = layers.find(layer => layer.id === 'minimap-time-grids') as
      | {
          props: {
            minX?: number;
            maxX?: number;
          };
        }
      | undefined;

    expect(gridLayer?.props.minX).toBe(0);
    expect(gridLayer?.props.maxX).toBe(0);
  });

  it('configures the minimap viewport overlay as hidden temporal ranges', () => {
    const bounds: Bounds = [
      [0, 0],
      [100, 10]
    ];
    const layers = buildOverviewLayers({
      bounds,
      highlightViewportId: 'main'
    });

    const viewportLayer = layers.find(layer => layer.id === 'minimap-viewport') as
      | {
          props: {bounds?: Bounds; getLineColor?: readonly number[]; lineWidthMinPixels?: number};
        }
      | undefined;

    expect(viewportLayer?.props.bounds).toEqual(bounds);
    expect(viewportLayer?.props.getLineColor).toEqual([15, 23, 42, 128]);
    expect(viewportLayer?.props.lineWidthMinPixels).toBe(2);
    expect(layers.findIndex(layer => layer.id === 'minimap-viewport')).toBeLessThan(
      layers.findIndex(layer => layer.id === 'minimap-time-grids')
    );
  });

  it('uses minimap bounds for full-height hidden viewport intervals', () => {
    const overlayData = getViewportHighlightOverlayData({
      viewportBounds: [20, -100, 80, -50],
      overviewBounds: [
        [0, 0],
        [100, 10]
      ]
    });

    expect(overlayData.hiddenIntervals).toEqual([
      {
        polygon: [
          [0, 0],
          [20, 0],
          [20, 10],
          [0, 10]
        ]
      },
      {
        polygon: [
          [80, 0],
          [100, 0],
          [100, 10],
          [80, 10]
        ]
      }
    ]);
    expect(overlayData.boundaryLines).toEqual([
      {
        path: [
          [20, 0],
          [20, 10]
        ]
      },
      {
        path: [
          [80, 0],
          [80, 10]
        ]
      }
    ]);
  });

  it('enables blending on minimap hidden viewport interval polygons', () => {
    const viewportLayer = new ViewportHighlightLayer({
      id: 'minimap-viewport',
      highlightedViewportIds: ['main'],
      bounds: [
        [0, 0],
        [100, 10]
      ]
    });
    viewportLayer.state = {
      viewports: [
        {
          getBounds: () => [20, -100, 80, -50]
        }
      ]
    } as ViewportHighlightLayer['state'];

    const subLayers = viewportLayer.renderLayers() as Array<{
      id: string;
      props: {parameters?: Record<string, unknown>};
    }>;
    const hiddenIntervalsLayer = subLayers.find(layer => layer.id.endsWith('hidden-intervals'));

    expect(hiddenIntervalsLayer?.props.parameters).toEqual({
      blend: true,
      depthWriteEnabled: false,
      depthCompare: 'always'
    });
  });

  it('omits minimap hidden intervals when the main viewport covers the overview range', () => {
    const overlayData = getViewportHighlightOverlayData({
      viewportBounds: [-20, -100, 120, -50],
      overviewBounds: [
        [0, 0],
        [100, 10]
      ]
    });

    expect(overlayData.hiddenIntervals).toEqual([]);
    expect(overlayData.boundaryLines).toEqual([]);
  });

  it('keeps minimap viewport highlight sublayers mounted when the full range is visible', () => {
    const viewportLayer = new ViewportHighlightLayer({
      id: 'minimap-viewport',
      highlightedViewportIds: ['main'],
      bounds: [
        [0, 0],
        [100, 10]
      ]
    });
    viewportLayer.state = {
      viewports: [
        {
          getBounds: () => [-20, -100, 120, -50]
        }
      ]
    } as ViewportHighlightLayer['state'];

    const subLayers = viewportLayer.renderLayers() as Array<{
      id: string;
      props: {
        data: readonly unknown[];
        visible?: boolean;
      };
    }>;

    expect(subLayers.map(layer => layer.id)).toEqual([
      'minimap-viewport-hidden-intervals',
      'minimap-viewport-boundary-lines'
    ]);
    expect(subLayers.every(layer => layer.props.visible === false)).toBe(true);
    expect(subLayers.every(layer => layer.props.data.length === 0)).toBe(true);
  });

  it('renders shaded and labeled minimap intervals outside loaded content bounds', () => {
    const layers = buildOverviewLayers({
      bounds: [
        [0, 0],
        [100, 10]
      ],
      highlightViewportId: 'main',
      loadedContentBounds: {minX: 20, maxX: 80}
    });

    const unloadedIntervalsLayer = layers.find(
      layer => layer.id === 'minimap-unloaded-intervals'
    ) as
      | {
          props: {
            data: Array<{label: string; labelX: number; labelY: number}>;
            getFillColor: readonly number[];
            parameters?: Record<string, unknown>;
          };
        }
      | undefined;
    const unloadedLabelLayer = layers.find(
      layer => layer.id === 'minimap-unloaded-interval-labels'
    ) as
      | {
          props: {
            data: Array<{label: string; labelX: number; labelY: number}>;
            getText: (datum: {label: string}) => string;
            getPosition: (datum: {labelX: number; labelY: number}) => number[];
          };
        }
      | undefined;

    expect(unloadedIntervalsLayer?.props.data).toHaveLength(2);
    expect(unloadedIntervalsLayer?.props.getFillColor).toEqual([15, 23, 42, 70]);
    expect(unloadedIntervalsLayer?.props.parameters).toEqual({
      blend: true,
      depthWriteEnabled: false,
      depthCompare: 'always'
    });
    expect(unloadedLabelLayer?.props.data).toHaveLength(2);
    expect(unloadedLabelLayer?.props.getText(unloadedLabelLayer.props.data[0]!)).toBe('Not loaded');
    expect(unloadedLabelLayer?.props.getPosition(unloadedLabelLayer.props.data[0]!)).toEqual([
      10, 6.300000000000001
    ]);
  });

  it('renders non-pickable minimap selected and hovered span indicator layers', () => {
    const indicators = [
      {
        id: 'selected-1',
        spanRef: 1 as SpanRef,
        kind: 'selected' as const,
        x: 20,
        startX: 10,
        endX: 30,
        y: 6,
        lineColor: [12, 34, 56, 190] as const
      },
      {
        id: 'hovered-2',
        spanRef: 2 as SpanRef,
        kind: 'hovered' as const,
        x: 40,
        startX: 39,
        endX: 41,
        y: 7
      }
    ];

    const layers = buildDeckLayersForMinimapSpanIndicators({
      bounds: [
        [0, 0],
        [100, 10]
      ],
      indicators,
      layerIdPrefix: 'minimap-trace'
    }) as Array<{
      id: string;
      props: {
        data?: unknown[];
        getColor?: (datum: {
          indicator: (typeof indicators)[number];
          x?: number;
        }) => readonly number[];
        getFillColor?: (indicator: (typeof indicators)[number]) => readonly number[];
        getLineColor?: (indicator: (typeof indicators)[number]) => readonly number[];
        getPath?: (datum: {path: readonly [number, number][]}) => readonly [number, number][];
        getPosition?: (
          datum: (typeof indicators)[number] | {indicator: (typeof indicators)[number]; x: number}
        ) => number[];
        getRadius?: (indicator: (typeof indicators)[number]) => number;
        getSize?: number;
        getText?: () => string;
        pickable?: boolean;
      };
    }>;

    expect(layers.map(layer => layer.id)).toEqual([
      'minimap-trace-minimap-span-indicator-hairlines',
      'minimap-trace-minimap-span-indicator-top-caps',
      'minimap-trace-minimap-span-indicator-whiskers',
      'minimap-trace-minimap-span-indicator-whisker-caps',
      'minimap-trace-minimap-span-indicator-dot-rings',
      'minimap-trace-minimap-span-indicator-dots'
    ]);
    expect(layers.every(layer => layer.props.pickable === false)).toBe(true);
    expect(layers[0]?.props.data).toHaveLength(2);
    expect(
      layers[0]?.props.getPath?.({
        path: [
          [20, 0],
          [20, 10]
        ]
      })
    ).toEqual([
      [20, 0],
      [20, 10]
    ]);
    expect(layers[0]?.props.getColor?.({indicator: indicators[0]!})).toEqual([0, 0, 0, 210]);
    expect(layers[1]?.props.getPosition?.(indicators[0]!)).toEqual([20, 0]);
    expect(layers[1]?.props.getFillColor?.(indicators[0]!)).toEqual([0, 0, 0, 245]);
    expect(layers[2]?.props.data).toHaveLength(2);
    expect(
      layers[2]?.props.getPath?.({
        path: [
          [10, 6],
          [30, 6]
        ]
      })
    ).toEqual([
      [10, 6],
      [30, 6]
    ]);
    expect(layers[2]?.props.getColor?.({indicator: indicators[0]!})).toEqual([0, 0, 0, 210]);
    expect(layers[3]?.props.data).toHaveLength(4);
    expect(layers[3]?.props.getText?.()).toBe('|');
    expect(layers[3]?.props.getSize).toBe(12);
    expect(layers[3]?.props.getPosition?.({indicator: indicators[0]!, x: 10})).toEqual([10, 6]);
    expect(layers[3]?.props.getPosition?.({indicator: indicators[0]!, x: 30})).toEqual([30, 6]);
    expect(layers[3]?.props.getColor?.({indicator: indicators[0]!, x: 10})).toEqual([0, 0, 0, 210]);
    expect(layers[4]?.props.getPosition?.(indicators[0]!)).toEqual([20, 6]);
    expect(layers[4]?.props.getRadius?.(indicators[0]!)).toBeGreaterThan(
      layers[5]?.props.getRadius?.(indicators[0]!) ?? 0
    );
    expect(layers[4]?.props.getLineColor?.(indicators[0]!)).toEqual([12, 34, 56, 220]);
    expect(layers[5]?.props.getPosition?.(indicators[0]!)).toEqual([20, 6]);
    expect(layers[5]?.props.getFillColor?.(indicators[0]!)).toEqual([0, 0, 0, 245]);
    expect(layers[5]?.props.getRadius?.(indicators[0]!)).toBeGreaterThan(
      layers[5]?.props.getRadius?.(indicators[1]!) ?? 0
    );
  });

  it('keeps minimap span indicator layers mounted when no indicators are active', () => {
    const layers = buildDeckLayersForMinimapSpanIndicators({
      bounds: [
        [0, 0],
        [100, 10]
      ],
      indicators: [],
      layerIdPrefix: 'minimap-trace'
    }) as Array<{
      id: string;
      props: {
        data?: readonly unknown[];
        visible?: boolean;
      };
    }>;

    expect(layers.map(layer => layer.id)).toEqual([
      'minimap-trace-minimap-span-indicator-hairlines',
      'minimap-trace-minimap-span-indicator-top-caps',
      'minimap-trace-minimap-span-indicator-whiskers',
      'minimap-trace-minimap-span-indicator-whisker-caps',
      'minimap-trace-minimap-span-indicator-dot-rings',
      'minimap-trace-minimap-span-indicator-dots'
    ]);
    expect(layers.every(layer => layer.props.visible === false)).toBe(true);
    expect(layers.every(layer => (layer.props.data?.length ?? 0) === 0)).toBe(true);
  });
});

describe('trace layout collapsed activity enrichment', () => {
  it('renders rank row separators from precomputed layout geometry within trace time extents', () => {
    const graph = createMultiGraph();
    const layout = {
      ...createLayout(graph),
      currentBounds: [
        [10, 0],
        [90, 3]
      ]
    } satisfies TraceLayout;
    const firstSeparatorLine = new Float32Array([-100, 2, 100, 2]);
    const separatorLine = new Float32Array([-100, 4, 100, 4]);
    const terminalSeparatorLine = new Float32Array([-100, 8, 100, 8]);
    layout.processLayouts[0]!.separatorLineInfinite = firstSeparatorLine;
    layout.processLayouts[1]!.separatorLineInfinite = separatorLine;
    layout.processLayouts[1]!.terminalSeparatorLineInfinite = terminalSeparatorLine;

    const layer = buildDeckRowSeparatorLayerForTrace({
      traceLayout: layout
    });

    expect(layer.id).toBe('rank-row-separators');
    const separatorData = layer.props.data as unknown as ReadonlyArray<{
      readonly row: TraceLayoutRow;
      readonly edge: 'top' | 'bottom';
      readonly path: Float32Array;
    }>;
    expect(
      separatorData.map(datum => ({
        row: datum.row,
        edge: datum.edge
      }))
    ).toEqual([
      {row: layout.renderRows[0], edge: 'top'},
      {row: layout.renderRows[1], edge: 'top'},
      {row: layout.renderRows[1], edge: 'bottom'}
    ]);
    const getPath = layer.props.getPath as (datum: {path: Float32Array}) => Float32Array;
    expect(Array.from(getPath(separatorData[0]!))).toEqual([-1000000, 2, 90, 2]);
    expect(Array.from(getPath(separatorData[1]!))).toEqual([-1000000, 4, 90, 4]);
    expect(Array.from(getPath(separatorData[2]!))).toEqual([-1000000, 8, 90, 8]);
    expect(layer.props.widthUnits).toBe('pixels');
    expect(layer.props.getColor).toEqual([0, 0, 0, 160]);
    expect(layer.props.getWidth).toBe(1);
    expect(layer.props.getDashArray).toEqual([5, 4]);
    expect(layer.props.dashJustified).toBe(true);
    expect(layer.props.extensions?.[0]).toBeInstanceOf(PathStyleExtension);
  });

  it('falls back to the last process band bottom for the terminal row separator', () => {
    const graph = createMultiGraph();
    const baseLayout = createLayout(graph);
    const layout = {
      ...baseLayout,
      currentBounds: [
        [10, 0],
        [90, 3]
      ],
      processLayouts: baseLayout.processLayouts.map((processLayout, index) =>
        index === 1
          ? {
              ...processLayout,
              yOffset: 4,
              yHeight: 1.25,
              terminalSeparatorLineInfinite: new Float32Array()
            }
          : processLayout
      )
    } satisfies TraceLayout;

    const layer = buildDeckRowSeparatorLayerForTrace({
      traceLayout: layout
    });
    const separatorData = layer.props.data as unknown as ReadonlyArray<{
      readonly edge: 'top' | 'bottom';
      readonly path: Float32Array;
    }>;
    const bottomSeparator = separatorData.find(datum => datum.edge === 'bottom');
    const getPath = layer.props.getPath as (datum: {path: Float32Array}) => Float32Array;

    expect(bottomSeparator).toBeDefined();
    expect(Array.from(getPath(bottomSeparator!))).toEqual([-1000000, 5.25, 90, 5.25]);
  });

  it('renders row separators above rank backgrounds and below selected cross-rank overlays', () => {
    const graph = createMultiGraph();
    const layout = createLayout(graph);

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const rankLayerIndex = layers.findIndex(layer => layer instanceof TraceProcessLayer);
    const separatorLayerIndex = layers.findIndex(layer => layer.id === 'rank-row-separators');
    const selectedCrossLayerIndex = layers.findIndex(layer =>
      layer.id.endsWith('cross-rank-dependency-selection')
    );

    expect(rankLayerIndex).toBeGreaterThanOrEqual(0);
    expect(separatorLayerIndex).toBeGreaterThan(rankLayerIndex);
    expect(separatorLayerIndex).toBeLessThan(selectedCrossLayerIndex);
    const rankLayer = layers[rankLayerIndex] as TraceProcessLayer;
    expect(rankLayer.props.collapsedActivityDirection).toBe('down');
  });

  it('builds trace layers from a prepared scene and transient selection object', () => {
    const graph = createMultiGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const layout = withRuntimeTraceLayout(createLayout(graph), runtimeGraph);

    const layers = buildRuntimeDeckLayersForTrace({
      scene: {
        graph: runtimeGraph,
        layout,
        rows: getRowEnrichments(layout, graph),
        visibleCrossDependencies: runtimeGraph.getVisibleCrossDependencySources(),
        minimapSpanIndicators: []
      },
      selection: {
        selectedSpanRefs: [],
        selectedDependencies: [],
        selectedCrossDependencies: []
      },
      handlers: {
        onSpanClick: () => undefined
      },
      stepNum: 0,
      settings: getTraceSettings()
    });

    expect(layers.some(layer => layer instanceof TraceProcessLayer)).toBe(true);
    expect(layers.some(layer => layer instanceof TraceCrossDependencyLayer)).toBe(true);
  });

  it('keeps row separators mounted but hidden in minimap layer groups', () => {
    const graph = createMultiGraph();
    const layout = createLayout(graph);

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings(),
      layerIdPrefix: 'minimap-trace'
    });

    const separatorLayer = layers.find(layer => layer.id === 'minimap-trace-rank-row-separators');
    expect(separatorLayer).toBeDefined();
    expect(separatorLayer?.props.visible).toBe(false);
    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as
      | TraceProcessLayer
      | undefined;
    expect(rankLayer?.props.collapsedActivityDirection).toBe('down');
  });

  it('keeps the process activity summary layer mounted when no summary data is present', () => {
    const layers = buildDeckLayerForTraceProcessActivitySummary({
      data: undefined
    });
    const summaryLayer = layers[0] as
      | {
          id: string;
          props: {
            data?: {length?: number};
            visible?: boolean;
          };
        }
      | undefined;

    expect(layers).toHaveLength(1);
    expect(summaryLayer?.id).toBe('process-activity-summary');
    expect(summaryLayer?.props.visible).toBe(false);
    expect(summaryLayer?.props.data?.length).toBe(0);
  });

  it('reports the picked process row from the process activity summary layer', () => {
    const graph = createGraph();
    const layout = createLayout(graph);
    const processRow = getRowEnrichments(layout, graph)[0]!.row;
    const onProcessClick = vi.fn();
    const layers = buildDeckLayerForTraceProcessActivitySummary({
      data: {
        data: {length: 1, attributes: {}},
        intervals: [{startX: 5, endX: 10, activity: 3}],
        processRows: [processRow],
        processRowIndices: new Uint32Array([0])
      },
      onProcessClick
    });
    const summaryLayer = layers[0] as unknown as
      | {
          props: {
            onClick?: (info: {index?: number}) => boolean | void;
          };
        }
      | undefined;

    expect(summaryLayer?.props.onClick?.({index: 0})).toBe(true);
    expect(onProcessClick).toHaveBeenCalledWith(processRow);
  });

  it('allows TraceProcessLayer to read collapsed activity intervals from prepared row enrichments', () => {
    const graph = createGraph();
    const intervals: TraceProcessActivityInterval[] = [
      {
        startX: 5,
        endX: 10,
        activity: 3,
        color: [1, 2, 3]
      }
    ];
    const layout = createLayout(graph);
    const settings = getTraceSettings();

    const processRows = getRowEnrichments(
      layout,
      graph,
      new Map([[layout.renderRows[0]!.processRef, intervals]])
    );
    const layers = buildDeckLayersForTrace({
      processRows,
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer);
    expect(rankLayer).toBeDefined();
    expect(processRows[0]?.collapsedActivityIntervals).toEqual(intervals);
  });

  it('keeps collapsed activity visible when a rank is collapsed', () => {
    const graph = createGraph();
    const expandedLayout = createLayout(graph);
    const layout = withProcessCollapsed(
      expandedLayout,
      expandedLayout.renderRows[0]!.processRef,
      true
    );
    const settings = getTraceSettings();
    const collapsedActivityByProcessRef = new Map([
      [
        layout.renderRows[0]!.processRef,
        [
          {
            startX: 2,
            endX: 8,
            activity: 4,
            color: [4, 5, 6]
          }
        ]
      ]
    ]) satisfies CollapsedActivityByProcessRef;

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph, collapsedActivityByProcessRef),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    expect(rankLayer).toBeDefined();

    const collapsedActivityLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('collapsed-activity'));
    expect(collapsedActivityLayer).toBeDefined();
    expect(collapsedActivityLayer?.props.visible).toBe(true);
  });

  it('renders collapsed activity for a structurally collapsed combined-thread process', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        processLayouts: [
          {
            ...createLayout(graph).processLayouts[0]!,
            isCollapsed: true,
            collapsedActivityY: 0.5,
            threadLayouts: [
              {
                ...createLayout(graph).processLayouts[0]!.threadLayouts[0]!,
                visible: false,
                yPosition: -1000,
                startPosition: [0, -1000, 0] as [number, number, number],
                targetPosition: [0, -1000, 0] as [number, number, number]
              }
            ]
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(
        layout,
        graph,
        new Map([
          [
            layout.renderRows[0]!.processRef,
            [
              {
                startX: 1,
                endX: 9,
                activity: 3
              } satisfies TraceProcessActivityInterval
            ]
          ]
        ])
      ),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings('combine-threads')
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    expect(rankLayer).toBeDefined();

    const collapsedActivityLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('collapsed-activity'));
    expect(collapsedActivityLayer).toBeDefined();
    expect(collapsedActivityLayer?.props.visible).toBe(true);
  });

  it('fades collapsed activity colors for non-selected main timeline rows', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        processLayouts: [
          {
            ...createLayout(graph).processLayouts[0]!,
            isCollapsed: true,
            collapsedActivityY: 0.5
          }
        ]
      } satisfies TraceLayout,
      graph
    );
    const interval = {
      startX: 1,
      endX: 9,
      activity: 3,
      color: [10, 20, 30]
    } satisfies TraceProcessActivityInterval;

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(
        layout,
        graph,
        new Map([[layout.renderRows[0]!.processRef, [interval]]])
      ),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      highlightedSpanRefs: new Set([encodeSpanRef(99, 99)]),
      settings: {
        ...getTraceSettings(),
        highlightFadeFactor: 0.6
      }
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    const collapsedActivityLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('collapsed-activity')) as
      | {
          props: {
            getFillColor: (datum: TraceProcessActivityInterval) => [number, number, number, number];
            parameters?: {blend?: boolean};
          };
        }
      | undefined;

    expect(collapsedActivityLayer?.props.getFillColor(interval)).toEqual([10, 20, 30, 153]);
    expect(collapsedActivityLayer?.props.parameters?.blend).toBe(true);
  });

  it('returns process tooltip objects for collapsed activity picks', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const interval = {startX: 1, endX: 9, activity: 3} satisfies TraceProcessActivityInterval;
    const rankLayer = new TraceProcessLayer({
      id: 'rank-collapsed-activity-picking',
      threads: graph.processes[0]!.threads,
      spans: [],
      dependencies: [],
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: graph.processes[0]!.processId,
      processName: graph.processes[0]!.name,
      rankNum: graph.processes[0]!.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings(),
      isCollapsed: true,
      collapsedActivityIntervals: [interval]
    });

    const pickingInfo = rankLayer.getPickingInfo({
      info: {object: interval},
      mode: 'hover',
      sourceLayer: {id: 'rank-collapsed-activity-picking-collapsed-activity'}
    } as never);

    expect(pickingInfo.object).toMatchObject({
      type: 'trace-process-info',
      processId: graph.processes[0]!.processId,
      processName: graph.processes[0]!.name,
      rankNum: graph.processes[0]!.rankNum
    });
  });

  it('can render collapsed activity downward for overview summaries', () => {
    const graph = createGraph();
    const interval = {
      startX: 1,
      endX: 9,
      activity: 3
    } satisfies TraceProcessActivityInterval;
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        processLayouts: [
          {
            ...createLayout(graph).processLayouts[0]!,
            isCollapsed: true,
            collapsedActivityY: 0.5
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const rankLayer = new TraceProcessLayer({
      id: 'rank-collapsed-activity-downward',
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
      collapsedActivityDirection: 'down',
      collapsedActivityIntervals: [interval]
    });

    const collapsedActivityLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('collapsed-activity')) as
      | {
          props: {
            getPosition: (datum: TraceProcessActivityInterval) => number[];
            getSize: (datum: TraceProcessActivityInterval) => number[];
          };
        }
      | undefined;

    expect(collapsedActivityLayer?.props.getPosition(interval)).toEqual([1, 0.1]);
    expect(collapsedActivityLayer?.props.getSize(interval)[1]).toBeGreaterThan(0);
  });

  it('renders explicit collapsed icicle activity geometry when provided', () => {
    const graph = createGraph();
    const interval = {
      startX: 1,
      endX: 9,
      activity: 3,
      yOffset: 0.28,
      height: 0.14
    } satisfies TraceProcessActivityInterval;
    const layout = withProcessRenderRows(
      {
        ...createLayout(graph),
        processLayouts: [
          {
            ...createLayout(graph).processLayouts[0]!,
            isCollapsed: true,
            collapsedActivityY: 0.5
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const rankLayer = new TraceProcessLayer({
      id: 'rank-collapsed-activity-icicle',
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
      collapsedActivityDirection: 'down',
      collapsedActivityIntervals: [interval]
    });

    const collapsedActivityLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('collapsed-activity')) as
      | {
          props: {
            getPosition: (datum: TraceProcessActivityInterval) => number[];
            getSize: (datum: TraceProcessActivityInterval) => number[];
          };
        }
      | undefined;

    expect(collapsedActivityLayer?.props.getPosition(interval)[0]).toBe(1);
    expect(collapsedActivityLayer?.props.getPosition(interval)[1]).toBeCloseTo(0.38, 6);
    expect(collapsedActivityLayer?.props.getSize(interval)).toEqual([8, 0.14]);
  });

  it('renders a filtered-span label below the collapsed activity overview for collapsed processes', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            isCollapsed: true,
            collapsedActivityY: 0.5,
            startPosition: [3, 0, 0] as [number, number, number]
          }
        ]
      } satisfies TraceLayout,
      graph
    );
    setFilteredSpanCountByThreadRef(
      layout,
      new Map([[getLayoutThreadRef(baseLayout, processId, threadId), 2]])
    );

    const layers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const filteredLabelLayer = layers.find(layer => layer.id.endsWith('legend-overflow-label'));
    expect(filteredLabelLayer).toBeDefined();
    const filteredLabelProps = filteredLabelLayer?.props as unknown as {
      readonly getTextAnchor: string;
      readonly data: Array<{
        readonly text: string;
        readonly x: number;
        readonly y: number;
      }>;
      readonly getText: (datum: {readonly text: string}) => string;
    };
    expect(filteredLabelProps.getTextAnchor).toBe('start');
    expect(filteredLabelProps.data).toHaveLength(1);
    expect(filteredLabelProps.getText(filteredLabelProps.data[0]!)).toBe('2 spans filtered');
    expect(filteredLabelProps.data[0]?.x).toBe(0);
    expect(filteredLabelProps.data[0]?.y).toBeCloseTo(1.2, 6);
  });

  it('renders collapsed filtered labels in the legend when the render row is collapsed without a collapsed rank layout', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    setFilteredSpanCountByThreadRef(
      baseLayout,
      new Map([[getLayoutThreadRef(baseLayout, processId, threadId), 3]])
    );
    const layout = {
      ...baseLayout,
      renderRows: baseLayout.renderRows.map(row => ({...row, isCollapsed: true}))
    } satisfies TraceLayout;
    const layers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: baseLayout,
      settings: getTraceSettings()
    });

    const filteredLabelLayer = layers.find(layer => layer.id.endsWith('legend-overflow-label'));
    expect(filteredLabelLayer).toBeDefined();
    const filteredLabelProps = filteredLabelLayer?.props as unknown as {
      readonly data: Array<{
        readonly text: string;
        readonly x: number;
      }>;
      readonly getText: (datum: {readonly text: string}) => string;
    };
    expect(filteredLabelProps.data).toHaveLength(1);
    expect(filteredLabelProps.getText(filteredLabelProps.data[0]!)).toBe('3 spans filtered');
    expect(filteredLabelProps.data[0]?.x).toBe(0);
  });

  it('keeps the legend overflow layer mounted when there is no legend overflow notice', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const overflowLayout = {
      ...getLayoutThread(baseLayout, processId, threadId),
      overflowSpanCount: 2,
      overflowLabel: {
        text: '2 deeper spans hidden, 1 span filtered in thread rank-1-thread',
        x: 0,
        y: 1,
        z: 0,
        view: 'main'
      }
    };
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            threadLayouts: [overflowLayout]
          }
        ],
        threadLayoutMapByRef: setLayoutThread(baseLayout, processId, threadId, overflowLayout),
        overflowLabels: [overflowLayout.overflowLabel!]
      } satisfies TraceLayout,
      graph
    );

    const layers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const overflowLayer = layers.find(layer => layer.id.endsWith('legend-overflow-label'));
    expect(overflowLayer).toBeDefined();
    expect(overflowLayer?.props.visible).toBe(false);
    expect(overflowLayer?.props.data).toHaveLength(0);
  });

  it('renders overflow notices in the main rank layer with clipped start anchoring', () => {
    const graph = createGraph();
    const baseBlock = graph.processes[0]!.spans[0]!;
    const topLaneBlock = {
      ...baseBlock,
      spanId: 'rank-1-span-top-lane' as TraceSpanId,
      name: 'rank-1-span-top-lane',
      timings: {
        ...baseBlock.timings,
        [baseBlock.primaryTimingKey]: {
          ...baseBlock.timings[baseBlock.primaryTimingKey]!,
          startTimeMs: 4,
          endTimeMs: 5
        }
      }
    };
    graph.processes[0]!.spans = [baseBlock, topLaneBlock];
    const baseLayout = createLayout(graph);
    const visibleTraceGraph = normalizeVisibleTraceGraphSource(graph);
    const baseBlockSpanRef =
      visibleTraceGraph.getSpanRefByExternalBlockId(baseBlock.spanId) ?? null;
    const topLaneBlockSpanRef =
      visibleTraceGraph.getSpanRefByExternalBlockId(topLaneBlock.spanId) ?? null;
    if (baseBlockSpanRef == null || topLaneBlockSpanRef == null) {
      throw new Error('Expected span refs for overflow label anchoring test');
    }
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const overflowLayout = {
      ...getLayoutThread(baseLayout, processId, threadId),
      spanLaneMap: new Map([
        [baseBlockSpanRef, 1],
        [topLaneBlockSpanRef, 0]
      ]),
      overflowSpanCount: 2,
      targetPosition: [
        9,
        getLayoutThread(baseLayout, processId, threadId).targetPosition[1],
        0
      ] as [number, number, number],
      overflowLabel: {
        text: 'legacy main label',
        x: 0,
        y: 1,
        z: 0,
        view: 'main'
      }
    };
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        currentBounds: [
          [0, baseLayout.currentBounds[0]![1]],
          [9, baseLayout.currentBounds[1]![1]]
        ],
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            threadLayouts: [overflowLayout]
          }
        ],
        threadLayoutMapByRef: setLayoutThread(baseLayout, processId, threadId, overflowLayout)
      } satisfies TraceLayout,
      graph
    );

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    expect(rankLayer).toBeDefined();
    const overflowLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('overflow-labels'));
    expect(overflowLayer).toBeDefined();
    const overflowLayerProps = overflowLayer?.props as unknown as {
      readonly contentAlignHorizontal: string;
      readonly getTextAnchor: string;
      readonly data: Array<{
        readonly text: string;
        readonly x: number;
        readonly y: number;
      }>;
      readonly getContentBox: (datum: {
        readonly text: string;
        readonly x: number;
        readonly y: number;
      }) => number[];
    };
    expect(overflowLayerProps.contentAlignHorizontal).toBe('start');
    expect(overflowLayerProps.getTextAnchor).toBe('start');
    expect(overflowLayerProps.data).toHaveLength(1);
    expect(overflowLayerProps.data[0]).toMatchObject({text: 'legacy main label', x: 0, y: 1});
    expect(overflowLayerProps.getContentBox(overflowLayerProps.data[0]!)).toEqual([0, -1, 9, 2]);
  });

  it('renders filtered-only overflow notices in the legend', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const overflowLayout = {
      ...getLayoutThread(baseLayout, processId, threadId),
      overflowSpanCount: 0,
      overflowLabel: {
        text: '1 span filtered in thread rank-1-thread',
        x: 0,
        y: 1,
        z: 0,
        view: 'legend'
      }
    };
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            threadLayouts: [overflowLayout]
          }
        ],
        threadLayoutMapByRef: setLayoutThread(baseLayout, processId, threadId, overflowLayout)
      } satisfies TraceLayout,
      graph
    );

    const layers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const overflowLayer = layers.find(layer => layer.id.endsWith('legend-overflow-label'));
    expect(overflowLayer).toBeDefined();
    const overflowLayerProps = overflowLayer?.props as unknown as {
      readonly data: Array<{
        readonly text: string;
      }>;
      readonly getText: (datum: {readonly text: string}) => string;
    };
    expect(overflowLayerProps.data).toHaveLength(1);
    expect(overflowLayerProps.getText(overflowLayerProps.data[0]!)).toBe(
      '1 span filtered in thread rank-1-thread'
    );
  });

  it('renders an all-filtered message in the legend when an expanded process has no visible lanes', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const hiddenLayout = {
      ...getLayoutThread(baseLayout, processId, threadId),
      visible: false,
      startPosition: [-1000, -1000, 0] as [number, number, number],
      targetPosition: [-1000, -1000, 0] as [number, number, number]
    };
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            startPosition: [3, 0.55, 0] as [number, number, number],
            threadLayouts: [hiddenLayout]
          }
        ],
        threadLayoutMapByRef: setLayoutThread(baseLayout, processId, threadId, hiddenLayout)
      } satisfies TraceLayout,
      graph
    );
    setFilteredSpanCountByThreadRef(
      layout,
      new Map([[getLayoutThreadRef(baseLayout, processId, threadId), 4]])
    );

    const layers = buildDeckLayersForLegend({
      processRows: layout.renderRows,
      processInfoMap: {},
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const overflowLayer = layers.find(layer => layer.id.endsWith('legend-overflow-label'));
    expect(overflowLayer).toBeDefined();
    const overflowLayerProps = overflowLayer?.props as unknown as {
      readonly data: Array<{
        readonly text: string;
        readonly x: number;
        readonly y: number;
      }>;
      readonly getText: (datum: {readonly text: string}) => string;
    };
    expect(overflowLayerProps.data).toHaveLength(1);
    expect(overflowLayerProps.data[0]?.x).toBe(0);
    expect(overflowLayerProps.data[0]?.y).toBeCloseTo(1.25, 6);
    expect(overflowLayerProps.getText(overflowLayerProps.data[0]!)).toBe(
      'All 4 spans filtered out in thread rank-1-stream'
    );
  });

  it('renders selected local dependencies above spans with thicker end-side markers', () => {
    const graph = createDependencyGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const processRef = getRequiredProcessRef(runtimeGraph, graph.processes[0]!.processId);
    const [selectedDependencySourceRef, bidirectionalSelectedDependencySourceRef] =
      runtimeGraph.getVisibleLocalDependencyRefs(processRef);
    const selectedDependencySource = selectedDependencySourceRef
      ? runtimeGraph.getVisibleDependencySourceByRef(selectedDependencySourceRef)
      : null;
    const bidirectionalDependencySource = bidirectionalSelectedDependencySourceRef
      ? runtimeGraph.getVisibleDependencySourceByRef(bidirectionalSelectedDependencySourceRef)
      : null;
    if (
      selectedDependencySource?.type !== 'trace-local-dependency' ||
      bidirectionalDependencySource?.type !== 'trace-local-dependency'
    ) {
      throw new Error('Expected visible local dependency sources');
    }
    const selectedDependency = {
      ...selectedDependencySource,
      selectedDirection: 'incoming' as const
    };
    const bidirectionalSelectedDependency = {
      ...bidirectionalDependencySource,
      bidirectional: true,
      selectedDirection: 'outgoing' as const
    };
    const layout = buildLayoutFromGraph(graph);

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [selectedDependency, bidirectionalSelectedDependency],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: {
        ...getTraceSettings(),
        showDependencies: false
      }
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    expect(rankLayer).toBeDefined();

    const baseDependencyLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('dependency-lines')) as
      | {
          props: {
            visible: boolean;
          };
        }
      | undefined;
    const selectedDependencyLayer = layers.find(layer =>
      layer?.id.endsWith('selected-local-dependency-overlays')
    ) as
      | {
          props: {
            getColor: (
              dependency: typeof selectedDependency | typeof bidirectionalSelectedDependency
            ) => readonly [number, number, number, number];
            getMarkerPlacements: (
              dependency: typeof selectedDependency | typeof bidirectionalSelectedDependency
            ) => readonly number[];
            getMarkerColor: (
              dependency: typeof selectedDependency | typeof bidirectionalSelectedDependency
            ) => readonly [number, number, number, number];
            getPath: (dependency: typeof selectedDependency) => Float32Array | [];
            getWidth: number;
            parameters: Record<string, string>;
            mode: string;
            visible: boolean;
          };
        }
      | undefined;
    const renderedLayerIds = rankLayer.renderLayers()?.map(layer => layer?.id);
    expect(baseDependencyLayer).toBeDefined();
    expect(baseDependencyLayer?.props.visible).toBe(false);
    expect(selectedDependencyLayer).toBeDefined();
    expect(selectedDependencyLayer?.props.visible).toBe(true);
    expect(selectedDependencyLayer?.props.getWidth).toBe(2);
    expect(selectedDependencyLayer?.props.parameters).toEqual({
      blend: false,
      depthTest: true,
      depthWriteEnabled: true,
      depthCompare: 'always'
    });
    expect(selectedDependencyLayer?.props.mode).toBe('line');
    expect(selectedDependencyLayer?.props.getMarkerPlacements(selectedDependency)).toEqual([1]);
    expect(selectedDependencyLayer?.props.getColor(selectedDependency)).toEqual(
      getSelectedLocalDependencyLineColor(
        selectedDependency.waitTimeMs,
        selectedDependency.selectedDirection
      )
    );
    expect(selectedDependencyLayer?.props.getMarkerColor(selectedDependency)).toEqual(
      getSelectedLocalDependencyLineColor(
        selectedDependency.waitTimeMs,
        selectedDependency.selectedDirection
      )
    );
    expect(
      Array.from(selectedDependencyLayer?.props.getPath(selectedDependency) ?? [])
    ).toHaveLength(4);
    expect(
      selectedDependencyLayer?.props.getMarkerPlacements(bidirectionalSelectedDependency)
    ).toEqual([1]);
    expect(selectedDependencyLayer?.props.getColor(bidirectionalSelectedDependency)).toEqual(
      getSelectedLocalDependencyLineColor(
        bidirectionalSelectedDependency.waitTimeMs,
        bidirectionalSelectedDependency.selectedDirection
      )
    );
    expect(selectedDependencyLayer?.props.getMarkerColor(bidirectionalSelectedDependency)).toEqual(
      getSelectedLocalDependencyLineColor(
        bidirectionalSelectedDependency.waitTimeMs,
        bidirectionalSelectedDependency.selectedDirection
      )
    );
    expect(renderedLayerIds?.some(layerId => layerId?.endsWith('dependency-lines'))).toBe(true);
    expect(layers.map(layer => layer.id)).toContain('selected-local-dependency-overlays');
  });

  it('keeps selected cross dependencies visible when base cross dependencies are hidden', () => {
    const graph = createCrossDependencyGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const selectedCrossDependencySource = runtimeGraph.getVisibleCrossDependencySources()[0];
    if (selectedCrossDependencySource?.type !== 'trace-cross-process-dependency') {
      throw new Error('Expected visible cross dependency source');
    }
    const selectedCrossDependency = {
      ...selectedCrossDependencySource,
      selectedDirection: 'outgoing' as const
    };
    const layout = buildLayoutFromGraph(graph);

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: {crossDependencies: [selectedCrossDependency]},
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [selectedCrossDependency],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: {
        ...getTraceSettings(),
        showCrossProcessDependencies: false
      }
    });

    const baseCrossLayer = layers.find(
      layer =>
        layer instanceof TraceCrossDependencyLayer && layer.id.endsWith('cross-rank-dependencies')
    ) as TraceCrossDependencyLayer;
    const selectedCrossLayer = layers.find(
      layer =>
        layer instanceof TraceCrossDependencyLayer &&
        layer.id.endsWith('cross-rank-dependency-selection')
    ) as TraceCrossDependencyLayer;
    const selectedCrossSubLayer = selectedCrossLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('selected-lines')) as
      | {
          props: {
            getColor: (
              dependency: typeof selectedCrossDependency
            ) => readonly [number, number, number, number];
            getMarkerColor: (
              dependency: typeof selectedCrossDependency
            ) => readonly [number, number, number, number];
            parameters: Record<string, boolean | string>;
            visible: boolean;
          };
        }
      | undefined;

    expect(baseCrossLayer).toBeDefined();
    expect(baseCrossLayer.props.visible).toBe(false);
    expect(selectedCrossLayer).toBeDefined();
    expect(selectedCrossSubLayer).toBeDefined();
    expect(selectedCrossSubLayer?.props.visible).toBe(true);
    expect(selectedCrossSubLayer?.props.parameters).toEqual({
      blend: false,
      depthTest: true,
      depthWriteEnabled: true,
      depthCompare: 'always'
    });
    expect(selectedCrossSubLayer?.props.getColor(selectedCrossDependency)).toEqual([
      162, 28, 175, 255
    ]);
    expect(selectedCrossSubLayer?.props.getMarkerColor(selectedCrossDependency)).toEqual([
      162, 28, 175, 255
    ]);
  });

  it('renders non-selected local dependency lines below span spans', () => {
    const graph = createDependencyGraph();
    const layout = buildLayoutFromGraph(graph);

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    const renderedLayerIds = rankLayer.renderLayers()?.map(layer => layer?.id);
    const dependencyLineLayerIndex =
      renderedLayerIds?.findIndex(layerId => layerId?.endsWith('dependency-lines')) ?? -1;
    const blockRectangleLayerIndex =
      renderedLayerIds?.findIndex(layerId => layerId?.endsWith('block-rectangles')) ?? -1;

    expect(dependencyLineLayerIndex).toBeGreaterThanOrEqual(0);
    expect(blockRectangleLayerIndex).toBeGreaterThanOrEqual(0);
    expect(dependencyLineLayerIndex).toBeLessThan(blockRectangleLayerIndex);
  });

  it('keeps normal straight dependency lines visible at low dependency opacity', () => {
    const graph = createDependencyAndCrossDependencyGraph();
    const materializedGraph = materializeJSONTrace(graph);
    const layout = buildLayoutFromGraph(graph);
    const [localDependency, submitDependency] = graph.processes[0]!.localDependencies;
    if (!localDependency || !submitDependency) {
      throw new Error('Expected visible local dependencies');
    }
    const crossDependency = materializedGraph.crossDependencies[0];
    if (!crossDependency) {
      throw new Error('Expected visible cross dependency');
    }
    const settings = {
      ...getTraceSettings(),
      showDependencies: true,
      showCrossProcessDependencies: true,
      dependencyOpacity: 0.05,
      showPathsOnly: false,
      lineRoutingMode: 'straight'
    } as TraceVisSettings;

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializedGraph,
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings
    });

    const rankLayer = layers.find(layer => layer instanceof TraceProcessLayer) as TraceProcessLayer;
    const localDependencyLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('dependency-lines')) as
      | {
          props: {
            data: {
              readonly attributes: {
                readonly getColor?: {
                  readonly value?: Uint8Array;
                };
              };
            };
            parameters: Record<string, boolean | string>;
          };
        }
      | undefined;
    const crossLayer = layers.find(
      layer =>
        layer instanceof TraceCrossDependencyLayer && layer.id.endsWith('cross-rank-dependencies')
    ) as TraceCrossDependencyLayer;
    const crossDependencyLayer = crossLayer
      .renderLayers()
      ?.find(layer => layer?.props.data === crossLayer.props.crossDependencies) as
      | {
          props: {
            getColor: (
              dependency: TraceCrossProcessDependency
            ) => readonly [number, number, number, number];
            getMarkerColor: (
              dependency: TraceCrossProcessDependency
            ) => readonly [number, number, number, number];
            parameters: Record<string, boolean | string>;
          };
        }
      | undefined;

    const dependencyRefs = rankLayer.props.binaryDependencyLineData?.dependencyRefs ?? [];
    const binaryDependencyColors = localDependencyLayer?.props.data.attributes.getColor?.value;
    const getBinaryDependencyColor = (dependencyId: TraceLocalDependency['dependencyId']) => {
      const dependencyIndex = dependencyRefs.findIndex(
        dependencyRef =>
          rankLayer.props.traceLayout.traceGraph.getVisibleDependencyIdByRef(dependencyRef) ===
          dependencyId
      );
      return dependencyIndex >= 0 && binaryDependencyColors
        ? Array.from(binaryDependencyColors.slice(dependencyIndex * 4, dependencyIndex * 4 + 4))
        : undefined;
    };
    const localLineColor = getBinaryDependencyColor(localDependency.dependencyId);
    const submitLineColor = getBinaryDependencyColor(submitDependency.dependencyId);
    const crossLineColor = crossDependencyLayer?.props.getColor(crossDependency);
    const crossMarkerColor = crossDependencyLayer?.props.getMarkerColor(crossDependency);

    expect(localLineColor).toEqual([239, 68, 68, 255]);
    expect(submitLineColor).toEqual([251, 218, 229, 255]);
    expect(crossLineColor).toEqual([208, 238, 251, 255]);
    expect(crossMarkerColor).toEqual(crossLineColor);
    expect(localDependencyLayer?.props.parameters).toEqual({
      blend: false,
      depthWriteEnabled: false,
      depthCompare: 'always'
    });
    expect(crossDependencyLayer?.props.parameters).toEqual({
      blend: false,
      depthWriteEnabled: false,
      depthCompare: 'always'
    });
  });

  it('mutes cross dependency colors for hidden endpoints', () => {
    const graph = createDependencyGraph();
    const visibleCrossDepRef = encodeVisibleCrossDependencyRef(0);
    const hiddenCrossDepRef = encodeVisibleCrossDependencyRef(1);
    const visibleCrossDep = {
      dependencyRef: visibleCrossDepRef,
      type: 'trace-cross-process-dependency' as const,
      waitTimeMs: 100
    } as unknown as TraceCrossDependencySource;
    const hiddenCrossDep = {
      ...visibleCrossDep,
      dependencyRef: hiddenCrossDepRef,
      startSpanRef: encodeSpanRef(0, 0),
      endSpanRef: encodeSpanRef(0, 1)
    } as unknown as TraceCrossDependencySource;
    const crossDeps = [visibleCrossDep, hiddenCrossDep];
    const baseLayout = buildLayoutFromGraph(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const hiddenEndpointThreadLayout = {
      ...getLayoutThread(baseLayout, processId, threadId),
      spanLaneMap: new Map([
        [hiddenCrossDep.startSpanRef!, 0],
        [hiddenCrossDep.endSpanRef!, 1]
      ]),
      lanes: {
        laneCount: 2,
        renderedLaneCount: 1,
        visibleLaneIndices: [0],
        isCollapsed: false,
        laneYPositions: [getLayoutThread(baseLayout, processId, threadId).yPosition]
      }
    } satisfies ThreadLayout;
    const processLayouts = [
      {
        ...baseLayout.processLayouts[0]!,
        threadLayouts: [hiddenEndpointThreadLayout]
      }
    ];
    const layout = {
      ...baseLayout,
      processLayouts,
      processLayoutMapByRef: new Map(
        processLayouts.map(processLayout => [processLayout.processRef, processLayout])
      ),
      threadLayoutMapByRef: setLayoutThread(
        baseLayout,
        processId,
        threadId,
        hiddenEndpointThreadLayout
      )
    } satisfies TraceLayout;

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: {crossDependencies: crossDeps},
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: {
        ...getTraceSettings(),
        showCrossProcessDependencies: true,
        dependencyOpacity: 1
      }
    });

    const crossLayer = layers.find(
      layer =>
        layer instanceof TraceCrossDependencyLayer && layer.id.endsWith('cross-rank-dependencies')
    ) as TraceCrossDependencyLayer;
    const crossDependencyLayer = crossLayer
      .renderLayers()
      ?.find(layer => layer?.props.data === crossLayer.props.crossDependencies) as
      | {
          props: {
            getColor: (
              dependency: TraceCrossDependencySource
            ) => readonly [number, number, number, number];
          };
        }
      | undefined;

    expect(crossDeps.map(dependency => crossDependencyLayer?.props.getColor(dependency))).toEqual([
      [46, 177, 236, 255],
      [121, 135, 155, 255]
    ]);
  });
});
