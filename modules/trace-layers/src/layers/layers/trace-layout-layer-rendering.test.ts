import {Matrix4} from '@math.gl/core';
import {describe, expect, it, vi} from 'vitest';
import {AnimationLayer, BlockLayer} from '@deck.gl-community/infovis-layers';

import {
  buildJSONTrace,
  buildDerivedTraceData as buildRuntimeDerivedTraceData,
  buildTraceLayoutRowEnrichments as buildRuntimeTraceLayoutRowEnrichments,
  buildTraceLayoutRows as buildRuntimeTraceLayoutRows,
  buildTraceLayouts as buildRuntimeTraceLayouts,
  buildTraceDeckBinaryCrossProcessDependencyLineData,
  buildTraceDeckBinaryProcessActivityData,
  buildTracePreparedProcessRows,
  encodeSpanRef,
  fillTraceLayoutSpanGeometry,
  isCrossProcessDependencyRef,
  materializeJSONTrace,
  shouldShowSameProcessDependencyByModeFields,
  TraceGraph
} from '../../trace';
import {createRuntimeTraceGraph} from '../../trace/trace-graph/trace-graph-test-fixtures';
import {buildTraceLayoutProcesses} from '../../trace/trace-layout/trace-geometry-layout-helpers';
import {
  buildDeckLayersForInstantsAndCounter,
  buildDeckLayersForLegend as buildRuntimeDeckLayersForLegend,
  buildDeckLayersForTrace as buildRuntimeDeckLayersForTrace
} from './deck-layers';
import {TraceLegendLayer} from './legend-layer';
import {TraceCrossProcessDependencyLayer} from './trace-cross-process-dependency-layer';
import {TraceProcessLayer} from './trace-process-layer';

import type {
  CollapsedActivityByProcessRef,
  JSONTrace,
  SpanRef,
  ThreadLayout,
  ThreadRef,
  TraceColorScheme,
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceDeckBinaryBlockData,
  TraceDeckBinaryDependencyLineData,
  TraceInstant,
  TraceInstantId,
  TraceLayout,
  TraceLayoutRow,
  TraceProcess,
  TraceRenderSpan,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace';
import type {
  BuildDeckLayersForTraceParams,
  TraceDeckLayerHandlers,
  TraceDeckLayerSelection
} from './deck-layers';

const EMPTY_TRACE_PROCESS_BINARY_BLOCK_DATA = {
  data: {length: 0, attributes: {}},
  spans: []
} satisfies TraceDeckBinaryBlockData;
const EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA = {
  data: {length: 0, attributes: {}},
  dependencies: []
} satisfies TraceDeckBinaryDependencyLineData;

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

/** Returns one required runtime thread layout for a process-local test thread id. */
function getLayoutThread(
  layout: TraceLayout,
  processId: string,
  threadId: TraceThreadId
): ThreadLayout {
  const traceGraph = layout.traceGraph;
  if (!(traceGraph instanceof TraceGraph)) {
    throw new Error('Expected runtime TraceGraph');
  }
  const threadLayout = layout.threadLayoutMapByRef.get(
    getRequiredThreadRef(traceGraph, processId, threadId)
  );
  if (!threadLayout) {
    throw new Error(`Expected thread layout for ${processId}:${threadId}`);
  }
  return threadLayout;
}

/** Returns one required runtime process ref from a test layout graph. */
/** Returns a thread-layout map with one process-local test thread layout replaced. */
function setLayoutThread(
  layout: TraceLayout,
  processId: string,
  threadId: TraceThreadId,
  threadLayout: ThreadLayout
): ReadonlyMap<ThreadRef, ThreadLayout> {
  const traceGraph = layout.traceGraph;
  if (!(traceGraph instanceof TraceGraph)) {
    throw new Error('Expected runtime TraceGraph');
  }
  return new Map(layout.threadLayoutMapByRef).set(
    getRequiredThreadRef(traceGraph, processId, threadId),
    threadLayout
  );
}

function isJSONTraceLike(traceGraph: unknown): traceGraph is JSONTrace {
  return (
    traceGraph != null &&
    typeof traceGraph === 'object' &&
    'processes' in traceGraph &&
    !('traceGraph' in traceGraph) &&
    !('processSpanTableMap' in traceGraph)
  );
}

const runtimeTraceGraphCache = new WeakMap<JSONTrace, TraceGraph>();
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

function normalizeRuntimeTraceGraphSource(traceGraph: TraceGraph | JSONTrace): TraceGraph {
  if (traceGraph instanceof TraceGraph) {
    return traceGraph;
  }

  const cachedTraceGraph = runtimeTraceGraphCache.get(traceGraph);
  if (cachedTraceGraph) {
    return cachedTraceGraph;
  }

  const normalizedTraceGraph = createRuntimeTraceGraph(traceGraph, {});
  runtimeTraceGraphCache.set(traceGraph, normalizedTraceGraph);
  return normalizedTraceGraph;
}

function createRuntimeGraph(graph: JSONTrace): TraceGraph {
  return normalizeRuntimeTraceGraphSource(graph);
}

function normalizeTraceLayoutRowProcesses(
  traceGraph: TraceGraph | JSONTrace
): Parameters<typeof buildRuntimeTraceLayoutRows>[0]['processes'] {
  return buildTraceLayoutProcesses(
    traceGraph instanceof TraceGraph ? traceGraph : normalizeVisibleTraceGraphSource(traceGraph)
  );
}

function normalizeVisibleTraceGraphSource(traceGraph: JSONTrace): TraceGraph {
  return normalizeRuntimeTraceGraphSource(traceGraph);
}

function buildTraceLayoutRows(
  params: Omit<Parameters<typeof buildRuntimeTraceLayoutRows>[0], 'processes'> & {
    traceGraph: TraceGraph | JSONTrace;
  }
) {
  const {traceGraph, ...rowParams} = params;
  return buildRuntimeTraceLayoutRows({
    ...rowParams,
    processes: normalizeTraceLayoutRowProcesses(traceGraph)
  });
}

function buildTraceLayouts(
  params: Omit<Parameters<typeof buildRuntimeTraceLayouts>[0], 'traceGraphs'> & {
    traceGraphs: ReadonlyArray<TraceGraph | JSONTrace>;
  }
) {
  return buildRuntimeTraceLayouts({
    ...params,
    traceGraphs: params.traceGraphs.map(normalizeRuntimeTraceGraphSource)
  });
}

function buildDerivedTraceData(
  params: Omit<Parameters<typeof buildRuntimeDerivedTraceData>[0], 'traceGraph'> & {
    traceGraph: Parameters<typeof buildRuntimeDerivedTraceData>[0]['traceGraph'] | JSONTrace;
  }
) {
  const traceGraph =
    params.traceGraph instanceof TraceGraph
      ? params.traceGraph
      : isJSONTraceLike(params.traceGraph)
        ? normalizeVisibleTraceGraphSource(params.traceGraph)
        : (params.traceGraph as TraceGraph);
  return buildRuntimeDerivedTraceData({
    ...params,
    traceGraph,
    traceLayout: withRuntimeTraceLayout(params.traceLayout, traceGraph)
  });
}

function buildTraceLayoutRowEnrichments(
  params: Parameters<typeof buildRuntimeTraceLayoutRowEnrichments>[0]
) {
  return buildRuntimeTraceLayoutRowEnrichments({
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
            : normalizeRuntimeTraceGraphSource(params.traceGraph as never);
  const traceLayout = withRuntimeTraceLayout(params.traceLayout, runtimeGraph);
  const processRows = buildLegacyPreparedProcessRows({
    graph: runtimeGraph,
    layout: traceLayout,
    processRows: params.processRows,
    settings: params.settings,
    colorScheme: params.colorScheme
  });
  const crossProcessDependencies = (params.traceGraph as {crossProcessDependencies?: unknown})
    .crossProcessDependencies;
  const explicitCrossProcessDependencyRefs = Array.isArray(crossProcessDependencies)
    ? crossProcessDependencies.flatMap(dependency => {
        const dependencyRef = (dependency as {dependencyRef?: unknown}).dependencyRef;
        return typeof dependencyRef === 'number' && isCrossProcessDependencyRef(dependencyRef)
          ? [dependencyRef]
          : [];
      })
    : [];
  const crossProcessDependencyRefs =
    explicitCrossProcessDependencyRefs.length > 0
      ? explicitCrossProcessDependencyRefs
      : Array.from(runtimeGraph.iterateVisibleCrossProcessDependencyRefs());
  const binaryCrossProcessDependencyLineData =
    params.settings.lineRoutingMode === 'straight' && crossProcessDependencyRefs.length > 0
      ? buildTraceDeckBinaryCrossProcessDependencyLineData({
          dependencyRefs: crossProcessDependencyRefs,
          traceLayout,
          settings: params.settings
        })
      : undefined;
  return buildRuntimeDeckLayersForTrace({
    settings: params.settings,
    stepNum: params.stepNum,
    colorScheme: params.colorScheme,
    showRowSeparators: params.showRowSeparators,
    collapsedActivityDirection: params.collapsedActivityDirection,
    layerGroup: params.layerGroup,
    scene: {
      layout: traceLayout,
      rows: processRows,
      crossProcessDependencyRefs,
      binaryCrossProcessDependencyLineData,
      layerIdPrefix: params.layerIdPrefix,
      rankBackgroundColor: params.rankBackgroundColor,
      modelMatrix: params.modelMatrix,
      minimapSpanIndicators: []
    },
    selection: {
      hoveredSpan: params.hoveredSpan,
      selectedSpanRefs: params.selectedSpanRefs,
      selectedDependencies: params.selectedDependencies,
      selectedCrossProcessDependencies: params.selectedCrossProcessDependencies,
      selectedSameProcessDependencySourcesByProcessId:
        params.selectedSameProcessDependencySourcesByProcessId,
      selectedCrossProcessDependencySources: params.selectedCrossProcessDependencySources,
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
  const preparedRowsByProcessId = new Map(
    Array.from(preparedRowsByProcessRef.values(), row => [row.row.processId, row])
  );
  return params.processRows.map(row => {
    const preparedRow =
      preparedRowsByProcessRef.get(row.row.processRef) ??
      preparedRowsByProcessId.get(row.row.processId);
    return preparedRow
      ? {
          ...preparedRow,
          collapsedActivityIntervals: row.collapsedActivityIntervals,
          overflowLabels: row.overflowLabels
        }
      : row;
  });
}

/** Builds required binary process-row payloads for direct TraceProcessLayer tests. */
function getPreparedTraceProcessBinaryData(params: {
  /** Source graph that owns the process row. */
  graph: TraceGraph | JSONTrace;
  /** Current layout whose geometry should be represented by the binary row. */
  layout: TraceLayout;
  /** Settings used to derive row-local block and dependency attributes. */
  settings: TraceVisSettings;
}): {
  /** Prepared row-local block attributes and span refs. */
  binaryBlockData: TraceDeckBinaryBlockData;
  /** Prepared row-local dependency attributes and refs. */
  binaryDependencyLineData: TraceDeckBinaryDependencyLineData;
} {
  const graph =
    params.graph instanceof TraceGraph
      ? params.graph
      : normalizeVisibleTraceGraphSource(params.graph);
  const layout = withRuntimeTraceLayout(params.layout, graph);
  const row = buildTracePreparedProcessRows({
    graph,
    layout,
    settings: params.settings
  })[0];
  if (row?.binaryBlockData == null || row.binaryDependencyLineData == null) {
    throw new Error('Expected prepared binary process-row data.');
  }
  return {
    binaryBlockData: row.binaryBlockData,
    binaryDependencyLineData: row.binaryDependencyLineData
  };
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
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
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
    sameProcessDependencies: [],
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

/** Builds two process rows whose local thread ids intentionally collide. */
function createRepeatedThreadGraph(): JSONTrace {
  const sharedThreadId = 'shared-stream' as TraceThreadId;
  return buildJSONTrace(
    [createRank('rank-1'), createRank('rank-2')].map(rank =>
      retargetSingleThreadRankThreadId(rank, sharedThreadId)
    ),
    [],
    {name: 'test-graph-repeated-thread'}
  );
}

/** Rewrites one single-thread process fixture to reuse a process-local thread id. */
function retargetSingleThreadRankThreadId(
  rank: TraceProcess,
  threadId: TraceThreadId
): TraceProcess {
  const sourceThread = rank.threads[0]!;
  const thread = {...sourceThread, threadId} satisfies TraceThread;
  const spans = rank.spans.map(span => ({...span, threadId})) satisfies TraceSpan[];
  const instants = rank.instants.map(instant => ({...instant, threadId}));
  const counters = rank.counters.map(counter => ({...counter, threadId}));
  return {
    ...rank,
    threads: [thread],
    threadMap: {[threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
      string,
      TraceSpan
    >,
    instants,
    instantMap: Object.fromEntries(instants.map(instant => [instant.instantId, instant])),
    threadInstantMap: {[threadId]: instants},
    counters,
    counterMap: Object.fromEntries(counters.map(counter => [counter.counterId, counter])),
    threadCounterMap: {[threadId]: counters}
  } satisfies TraceProcess;
}

function createDependencyGraph(): JSONTrace {
  const rank = createRank('rank-1');
  const firstBlock = rank.spans[0]!;
  const secondBlock: TraceSpan = {
    ...firstBlock,
    spanId: 'rank-1-span-2' as TraceSpanId,
    name: 'rank-1-span-2',
    sameProcessDependencyIds: [],
    sameProcessDependencies: []
  };
  const warningDependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: 'dep-warning' as TraceSameProcessDependency['dependencyId'],
    startSpanId: firstBlock.spanId,
    endSpanId: secondBlock.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 5
  };
  const submitDependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: 'dep-submit' as TraceSameProcessDependency['dependencyId'],
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
        sameProcessDependencies: [warningDependency, submitDependency]
      }
    ],
    [],
    {name: 'dependency-graph'}
  );
}

/** Builds local and cross-process dependencies whose geometry resolves through the runtime graph. */
function createDependencyAndCrossProcessDependencyGraph(): JSONTrace {
  const sameProcessDependencyGraph = materializeJSONTrace(createDependencyGraph());
  const startRank = sameProcessDependencyGraph.processes[0]!;
  const endRank = {...createRank('rank-2'), rankNum: 1} satisfies TraceProcess;
  const crossProcessDependency = {
    type: 'trace-cross-process-dependency',
    dependencyId: 'cross-dep-mode' as TraceCrossProcessDependency['dependencyId'],
    endpointId: 'cross-dep-mode:endpoint' as TraceCrossProcessDependency['endpointId'],
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
  return buildJSONTrace([startRank, endRank], [crossProcessDependency], {
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
      yPosition
    };
    threadLayoutMapByRef.set(threadRef, streamLayout);

    return {
      processRef,
      yOffset: rankIndex * 2,
      yHeight: 1,
      labelY: rankIndex * 2,
      collapsedActivityY: rankIndex * 2,
      backgroundPolygonInfinite: new Float32Array(),
      contentStartY: rankIndex * 2,
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
      currentBounds: [
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
  sameProcessDependencyMode: TraceVisSettings['sameProcessDependencyMode'] = 'all'
) {
  const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
  return buildTraceLayoutRowEnrichments({
    traceLayout: {
      ...layout,
      traceGraph: runtimeGraph
    },
    collapsedActivityByProcessRef
  }).map(({row, collapsedActivityIntervals, overflowLabels}) => ({
    row,
    spans: Array.from(
      runtimeGraph.iterateVisibleSpanRefsByProcess(
        getRequiredProcessRef(runtimeGraph, row.processId)
      )
    ),
    dependencies: Array.from(
      runtimeGraph.iterateVisibleSameProcessDependencyRefsByProcess(
        getRequiredProcessRef(runtimeGraph, row.processId)
      )
    ).filter(dependencyRef =>
      shouldShowSameProcessDependencyByModeFields(
        sameProcessDependencyMode,
        runtimeGraph.getDependencyHasKeyword(dependencyRef, 'SUBMIT'),
        runtimeGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0
      )
    ),
    collapsedActivityIntervals,
    overflowLabels
  }));
}

function getTraceSettings(
  aggregationMode: 'separate-threads' | 'combine-threads' = 'separate-threads'
): TraceVisSettings {
  return {
    sameProcessDependencyMode: 'all',
    trackAggregationMode: aggregationMode,
    layoutDensity: 'comfortable',
    highlightFadeFactor: 1,
    showBlockText: true
  } as unknown as TraceVisSettings;
}

function buildLayoutFromGraph(
  graph: JSONTrace,
  aggregationMode: 'separate-threads' | 'combine-threads' = 'separate-threads',
  sameProcessDependencyMode: TraceVisSettings['sameProcessDependencyMode'] = 'all'
): TraceLayout {
  return buildTraceLayouts({
    traceGraphs: [graph],
    settings: {
      threadDisplayMode: 'all',
      selectedThreadNames: undefined,
      sortThreads: false,
      showCrossProcessDependencies: true,
      sameProcessDependencyMode,
      layoutDensity: 'comfortable',
      processLayoutMode: 'interleaved',
      trackAggregationMode: aggregationMode
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
    const graph = createDependencyAndCrossProcessDependencyGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const processRef = getRequiredProcessRef(runtimeGraph, graph.processes[0]!.processId);
    const selectedDependencyRef = Array.from(
      runtimeGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
    ).at(0);
    const selectedDependencySource =
      selectedDependencyRef == null
        ? null
        : runtimeGraph.getDependencySource(selectedDependencyRef);
    const selectedCrossProcessDependencySource = Array.from(
      runtimeGraph.iterateVisibleCrossProcessDependencyRefs()
    ).flatMap(dependencyRef => {
      const dependency = runtimeGraph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
    })[0];
    if (
      selectedDependencySource?.type !== 'trace-same-process-dependency' ||
      selectedCrossProcessDependencySource?.type !== 'trace-cross-process-dependency'
    ) {
      throw new Error('Expected visible selected dependency sources');
    }
    const selectedDependency = {
      ...selectedDependencySource,
      selectedDirection: 'incoming' as const
    };
    const selectedCrossProcessDependency = {
      ...selectedCrossProcessDependencySource,
      selectedDirection: 'incoming' as const
    };
    const layout = buildLayoutFromGraph(graph);

    function getDependencyModes(lineRoutingMode: TraceVisSettings['lineRoutingMode']) {
      const layers = buildDeckLayersForTrace({
        processRows: getRowEnrichments(layout, graph),
        traceGraph: materializeJSONTrace(graph),
        stepNum: 0,
        selectedSpanRefs: [],
        selectedDependencies: [selectedDependency],
        selectedCrossProcessDependencies: [selectedCrossProcessDependency],
        onSpanClick: () => undefined,
        traceLayout: layout,
        settings: {
          ...getTraceSettings(),
          lineRoutingMode
        } as TraceVisSettings
      });

      const crossLayer = layers.find(
        layer =>
          layer instanceof TraceCrossProcessDependencyLayer &&
          layer.id.endsWith('cross-rank-dependency-selection')
      ) as TraceCrossProcessDependencyLayer;
      const localLayer = layers.find(layer =>
        layer?.id.endsWith('selected-same-process-dependency-overlays')
      ) as {props: {mode: string}} | undefined;
      const crossSelectedLayer = crossLayer
        .renderLayers()
        ?.find(layer => layer?.props.data === crossLayer.props.selectedCrossProcessDependencies) as
        | {
            props: {
              data: readonly (typeof selectedCrossProcessDependency)[];
              getMarkerPlacements: (
                dependency: typeof selectedCrossProcessDependency
              ) => readonly number[];
              getPath: (dependency: typeof selectedCrossProcessDependency) => Float32Array | [];
              getWidth: number;
              mode: string;
            };
          }
        | undefined;

      return {
        localMode: localLayer?.props.mode,
        crossMode: crossSelectedLayer?.props.mode,
        crossMarkerPlacements: crossSelectedLayer?.props.getMarkerPlacements(
          selectedCrossProcessDependency
        ),
        crossPathLength: Array.from(
          crossSelectedLayer?.props.getPath(selectedCrossProcessDependency) ?? []
        ).length,
        crossWidth: crossSelectedLayer?.props.getWidth,
        topLayerId: layers.at(-1)?.id
      };
    }

    expect(getDependencyModes('straight')).toEqual({
      localMode: 'line',
      crossMode: 'line',
      crossMarkerPlacements: [1],
      crossPathLength: 4,
      crossWidth: 2,
      topLayerId: 'cross-rank-dependency-selection'
    });
    expect(getDependencyModes('curve')).toEqual({
      localMode: 'arc',
      crossMode: 'arc',
      crossMarkerPlacements: [1],
      crossPathLength: 4,
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

  it('builds reordered render rows from process layout refs instead of graph array indexes', () => {
    const graph = createMultiGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const layout = createLayout(graph);
    const reorderedProcessLayouts = [layout.processLayouts[1]!, layout.processLayouts[0]!];
    const renderRows = buildTraceLayoutRows({
      traceGraph: runtimeGraph,
      processLayouts: reorderedProcessLayouts
    });

    expect(renderRows.map(row => row.processId)).toEqual(['rank-2', 'rank-1']);
    expect(renderRows.map(row => row.processRef)).toEqual(
      reorderedProcessLayouts.map(processLayout => processLayout.processRef)
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
          yPosition: -1
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
            contentStartY: -4
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
        dependencyRef => runtimeGraph.getDependencyId(dependencyRef)
      )
    ).toEqual(['dep-warning']);
    expect(
      getRowEnrichments(submitRows, graph, undefined, 'submit')[0]?.dependencies.map(
        dependencyRef => runtimeGraph.getDependencyId(dependencyRef)
      )
    ).toEqual(['dep-warning', 'dep-submit']);
  });

  it('deck layer builders consume precomputed renderRows while using layout collapse state', () => {
    const graph = createDependencyGraph();
    const baseLayout = createLayout(graph);
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
    const traceProcessRows = getRowEnrichments(layout, graph);

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
      selectedCrossProcessDependencies: [],
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
    const firstVisibleStreamY = baseLayout.processLayouts[0]?.threadLayouts[0]?.yPosition;

    expect(legendLabelLayer?.props.data[0]?.name).toBe('Precomputed row');
    expect(processTopY).toBeDefined();
    expect(firstVisibleStreamY).toBeDefined();
    expect(legendLabelPosition?.[1]).toBeGreaterThanOrEqual(processTopY!);
    expect(legendLabelPosition?.[1]).toBeLessThan(firstVisibleStreamY!);
    expect(rankLayer.props.rankNum).toBe(42);
    expect(
      Array.from(rankLayer.props.binaryDependencyLineData?.dependencies ?? [], dependencyRef =>
        rankLayer.props.traceLayout.traceGraph.getDependencyId(dependencyRef)
      )
    ).toEqual(['dep-warning', 'dep-submit']);
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
          collapsedActivityIntervals: [],
          overflowLabels: []
        }
      ],
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossProcessDependencies: [],
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

  it('binds prepared binary span data to process layer deck data invalidation', () => {
    const graph = createGraph();
    const traceGraph = normalizeVisibleTraceGraphSource(graph);
    const layout = withRuntimeTraceLayout(
      withProcessRenderRows(createLayout(graph), graph),
      traceGraph
    );
    const processRow = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout,
      settings: getTraceSettings(),
      colorScheme
    })[0]!;
    const traceLayers = buildDeckLayersForTrace({
      processRows: [processRow],
      traceGraph,
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossProcessDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const rankLayer = traceLayers.find(
      layer => layer instanceof TraceProcessLayer
    ) as TraceProcessLayer;

    expect(rankLayer.props.binaryBlockData).toBeDefined();
    expect(rankLayer.props.data).toBe(rankLayer.props.binaryBlockData?.data);
  });

  it('keeps expanded span layers visible when a reordered row carries a stale rank index', () => {
    const graph = createMultiGraph();
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const baseLayout = createLayout(graph);
    const processLayouts = baseLayout.processLayouts.map((processLayout, rankIndex) => ({
      ...processLayout,
      isCollapsed: rankIndex === 0
    }));
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        processLayouts,
        processLayoutMapByRef: new Map(
          processLayouts.map(processLayout => [processLayout.processRef, processLayout])
        )
      } satisfies TraceLayout,
      runtimeGraph
    );
    const secondRow = layout.renderRows[1]!;
    const staleIndexRow = {...secondRow, rankIndex: 0} satisfies TraceLayoutRow;
    const traceLayers = buildDeckLayersForTrace({
      processRows: [
        {
          row: staleIndexRow,
          collapsedActivityIntervals: [],
          overflowLabels: []
        }
      ],
      traceGraph: runtimeGraph,
      stepNum: 0,
      selectedSpanRefs: [],
      selectedDependencies: [],
      selectedCrossProcessDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const rankLayer = traceLayers.find(
      layer => layer instanceof TraceProcessLayer
    ) as TraceProcessLayer;
    const blockLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-rectangles'));

    expect(staleIndexRow.rankIndex).toBe(0);
    expect(layout.processLayoutMapByRef.get(staleIndexRow.processRef)?.isCollapsed).toBe(false);
    expect(blockLayer?.props.visible).toBe(true);
  });

  it('projects activity bands from exact process refs when row indexes are stale', () => {
    const graph = createMultiGraph();
    const layout = createLayout(graph);
    const secondRow = layout.renderRows[1]!;
    const processRow = {
      row: secondRow,
      spans: [],
      dependencies: [],
      collapsedActivityIntervals: [{startX: 10, endX: 20, activity: 1}],
      overflowLabels: []
    };
    const staleIndexProcessRow = {
      ...processRow,
      row: {...secondRow, rankIndex: 0} satisfies TraceLayoutRow
    };
    const correctData = buildTraceDeckBinaryProcessActivityData({
      rows: [processRow],
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const staleIndexData = buildTraceDeckBinaryProcessActivityData({
      rows: [staleIndexProcessRow],
      traceLayout: layout,
      settings: getTraceSettings()
    });

    expect(Array.from(staleIndexData.data.attributes.getPosition.value as Float32Array)).toEqual(
      Array.from(correctData.data.attributes.getPosition.value as Float32Array)
    );
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
        settings,
        derivedData: buildDerivedTraceData({
          traceGraph: traceLayout.traceGraph,
          traceLayout,
          buildGlobalEvents: settings.showGlobalEvents,
          buildInstants: settings.showInstants,
          buildCounters: settings.showCounters
        })
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
    const settings = getTraceSettings();
    const layers = buildDeckLayersForInstantsAndCounter({
      settings,
      derivedData: buildDerivedTraceData({
        traceGraph: layout.traceGraph,
        traceLayout: layout,
        buildGlobalEvents: settings.showGlobalEvents,
        buildInstants: settings.showInstants,
        buildCounters: settings.showCounters
      })
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
      ...getPreparedTraceProcessBinaryData({
        graph,
        layout,
        settings: getTraceSettings()
      }),
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
      ...getPreparedTraceProcessBinaryData({
        graph,
        layout,
        settings: {
          ...getTraceSettings(),
          minSpanWidthPixels: 4
        }
      }),
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

  it('does not mount the removed non-binary border overlay', () => {
    const graph = createGraph();
    const layout = createLayout(graph);
    const rankLayer = new TraceProcessLayer({
      id: 'rank-span-border-overlay',
      threads: graph.processes[0]!.threads,
      ...getPreparedTraceProcessBinaryData({
        graph,
        layout,
        settings: getTraceSettings()
      }),
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
      ?.find(layer => layer?.id.endsWith('block-rectangle-borders'));

    expect(borderLayer).toBeUndefined();
  });

  it('uses current layout identity for prepared row update triggers', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const layout = createLayout(graph);
    const nextLayout = {
      ...layout,
      currentBounds: [
        [0, 0],
        [2, 2]
      ]
    } satisfies TraceLayout;
    const movedProcessLayout = {
      ...layout.processLayouts[0]!,
      yOffset: layout.processLayouts[0]!.yOffset + 8
    };
    const movedLayout = {
      ...layout,
      processLayouts: [movedProcessLayout],
      processLayoutMapByRef: new Map([[movedProcessLayout.processRef, movedProcessLayout]])
    } satisfies TraceLayout;
    const makeRankLayer = (traceLayout: TraceLayout) =>
      new TraceProcessLayer({
        id: 'rank-process-local-update-trigger',
        threads: process.threads,
        ...getPreparedTraceProcessBinaryData({
          graph,
          layout: traceLayout,
          settings: getTraceSettings()
        }),
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
    const getSpanLabelContentBoxTriggers = (traceLayout: TraceLayout) => {
      const spanLabelLayer = makeRankLayer(traceLayout)
        .renderLayers()
        ?.find(layer => layer?.id.endsWith('block-labels-above')) as
        | {
            props: {
              updateTriggers: {
                /** Label content-box update triggers retained by the rendered text layer. */
                getContentBox: readonly unknown[];
              };
            };
          }
        | undefined;
      return spanLabelLayer?.props.updateTriggers.getContentBox;
    };

    expect(getBlockPositionTriggers(nextLayout)).not.toEqual(getBlockPositionTriggers(layout));
    expect(getBlockPositionTriggers(movedLayout)).not.toEqual(getBlockPositionTriggers(layout));
    expect(getOverflowLabelPositionTriggers(nextLayout)).not.toEqual(
      getOverflowLabelPositionTriggers(layout)
    );
    expect(getOverflowLabelPositionTriggers(movedLayout)).not.toEqual(
      getOverflowLabelPositionTriggers(layout)
    );
    expect(getOverflowLabelPositionTriggers(layout)).toContain(layout);
    expect(getSpanLabelPositionTriggers(nextLayout)).not.toEqual(
      getSpanLabelPositionTriggers(layout)
    );
    expect(getSpanLabelPositionTriggers(movedLayout)).not.toEqual(
      getSpanLabelPositionTriggers(layout)
    );
    expect(getSpanLabelContentBoxTriggers(nextLayout)).not.toEqual(
      getSpanLabelContentBoxTriggers(layout)
    );
    expect(getSpanLabelContentBoxTriggers(movedLayout)).not.toEqual(
      getSpanLabelContentBoxTriggers(layout)
    );
  });

  it('passes the scene model matrix through to absolute binary attributes and labels', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const baseModelMatrix = new Matrix4().translate([5, 6, 0]);
    const layout = createLayout(graph);
    const rankLayer = new TraceProcessLayer({
      id: 'rank-binary-y-transform',
      threads: process.threads,
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
        spans: []
      },
      binaryDependencyLineData: EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA,
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
    const labelLayer = rankLayer
      .renderLayers()
      ?.find(layer => layer?.id.endsWith('block-labels-above')) as
      | {
          props: {
            modelMatrix?: Matrix4;
          };
        }
      | undefined;

    expect(Array.from(blockLayer?.props.modelMatrix ?? []).slice(12, 15)).toEqual([5, 6, 0]);
    expect(Array.from(labelLayer?.props.modelMatrix ?? []).slice(12, 15)).toEqual([5, 6, 0]);
  });

  it('uses row-local binary block geometry for labels while keeping span inputs stable', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const traceGraph = normalizeVisibleTraceGraphSource(graph);
    const spanRef = Array.from(
      traceGraph.iterateVisibleSpanRefsByProcess(
        getRequiredProcessRef(traceGraph, process.processId)
      )
    ).at(0)!;
    const invalidSpanRef = (spanRef + 1) as SpanRef;
    const spanRefs = [spanRef, invalidSpanRef];
    const layout = withRuntimeTraceLayout(
      withProcessRenderRows(createLayout(graph), graph),
      traceGraph
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
      spans: spanRefs
    };
    const makeRankLayer = (settings: TraceVisSettings, traceLayout = layout) =>
      new TraceProcessLayer({
        id: `rank-label-binary-geometry-${settings.enableFastTextLayer ? 'fast' : 'text'}`,
        threads: process.threads,
        binaryBlockData,
        binaryDependencyLineData: EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA,
        selectedSpanRefs: [],
        selectedDependencies: [],
        rankIndex: 0,
        processId: process.processId,
        rankNum: process.rankNum,
        stepNum: 0,
        onSpanClick: () => undefined,
        traceLayout,
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
            /** Label text accessor retained by the rendered text layer. */
            getText: (source: SpanRef) => string;
            updateTriggers: {
              /** Label content-box update triggers retained by the rendered text layer. */
              getContentBox: readonly unknown[];
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
            /** Label text accessor retained by the rendered fast text layer. */
            getText: (source: SpanRef) => string;
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
    expect(textLabelLayer?.props.getText(spanRef)).toBe(process.spans[0]!.name);
    expect(textLabelLayer?.props.getPosition(invalidSpanRef, {index: 1})).toEqual([0, -1_000_000]);
    expect(textLabelLayer?.props.getContentBox(invalidSpanRef, {index: 1})).toEqual([0, 0, 0, 0]);
    expect(textLabelLayer?.props.updateTriggers.getContentBox).toContain(binaryBlockData);
    expect(textLabelLayer?.props.updateTriggers.getText).toEqual([spanRefs.length, 0]);
    expect(fastTextLabelLayer?.props.data).toBe(spanRefs);
    expect(fastTextLabelLayer?.props.getPosition(spanRef, {index: 0})).toEqual([5, 6.025]);
    expect(fastTextLabelLayer?.props.getClipRect(spanRef, {index: 0})).toEqual([0, -1, 20, 2]);
    expect(fastTextLabelLayer?.props.getText(spanRef)).toBe(process.spans[0]!.name);
    expect(fastTextLabelLayer?.props.getPosition(spanRef, {index: 1})).toEqual([0, -1_000_000]);
    expect(fastTextLabelLayer?.props.getClipRect(invalidSpanRef, {index: 1})).toEqual([0, 0, 0, 0]);
    expect(fastTextLabelLayer?.props.updateTriggers.getText).toEqual([spanRefs.length, 0]);
    expect(fastTextLabelLayer?.props.updateTriggers.getTextUtf8).toEqual([spanRefs.length, 0]);
    const collapsedProcessLayouts = layout.processLayouts.map(processLayout => ({
      ...processLayout,
      isCollapsed: true
    }));
    const collapsedLayout = {
      ...layout,
      processLayouts: collapsedProcessLayouts,
      processLayoutMapByRef: new Map(
        collapsedProcessLayouts.map(processLayout => [processLayout.processRef, processLayout])
      ),
      renderRows: layout.renderRows.map(row => ({...row, isCollapsed: true}))
    } satisfies TraceLayout;
    const spanLabelWarningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const expandedRankLayer = makeRankLayer(getTraceSettings());
    expandedRankLayer.renderLayers();
    expandedRankLayer.updateState({
      props: expandedRankLayer.props,
      oldProps: makeRankLayer(getTraceSettings(), collapsedLayout).props
    } as never);
    expect(spanLabelWarningSpy).toHaveBeenCalledWith(
      '[tracevis] Expanded trace process label input would hide span text',
      expect.objectContaining({
        invalidSpanLabelRowCount: 1
      })
    );
    spanLabelWarningSpy.mockRestore();
  });

  it('adds left clearance only inside spans', () => {
    const graph = createGraph();
    const spanRef = Array.from(
      normalizeVisibleTraceGraphSource(graph).iterateVisibleSpanRefsByProcess(
        getRequiredProcessRef(
          normalizeVisibleTraceGraphSource(graph),
          graph.processes[0]!.processId
        )
      )
    ).at(0)!;
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const binaryBlockData = {
      data: {
        length: 1,
        attributes: {
          getPosition: {value: new Float32Array([10, 20, 0]), size: 3},
          getSize: {value: new Float32Array([20, 1]), size: 2},
          getFillColor: {value: new Uint8Array(4), size: 4},
          getLineColor: {value: new Uint8Array(4), size: 4}
        }
      },
      spans: [spanRef]
    };
    const makeRankLayer = (settings: TraceVisSettings) =>
      new TraceProcessLayer({
        id: `rank-label-inset-${settings.layoutDensity}`,
        threads: graph.processes[0]!.threads,
        binaryBlockData,
        binaryDependencyLineData: EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA,
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
            getContentBox: (
              source: typeof spanRef,
              objectInfo?: {readonly index?: number}
            ) => number[];
            getPixelOffset: readonly [number, number];
            getPosition: (
              source: typeof spanRef,
              objectInfo?: {readonly index?: number}
            ) => number[];
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

    expect(insideLabelProps?.getPosition(spanRef, {index: 0})).toEqual([10, 20]);
    expect(insideLabelProps?.getContentBox(spanRef, {index: 0})).toEqual([0, -0.5, 20, 2]);
    expect(insideLabelProps?.getPixelOffset).toEqual([6, 0]);
    expect(aboveLabelProps?.getPosition(spanRef, {index: 0})).toEqual([10, 20.025]);
    expect(aboveLabelProps?.getContentBox(spanRef, {index: 0})).toEqual([0, -1, 20, 2]);
    expect(aboveLabelProps?.getPixelOffset).toEqual([0, 0]);
  });

  it('keeps label glyph data for huge rows', () => {
    const graph = createGraph();
    const process = graph.processes[0]!;
    const spanRefs = Array.from({length: 5_001}, (_, index) => encodeSpanRef(0, index));
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const binaryPositions = new Float32Array(spanRefs.length * 3);
    const binarySizes = new Float32Array(spanRefs.length * 2);
    spanRefs.forEach((_, index) => {
      binaryPositions[index * 3] = index;
      binarySizes[index * 2] = 1;
      binarySizes[index * 2 + 1] = 1;
    });
    const rankLayer = new TraceProcessLayer({
      id: 'rank-huge-label-row',
      threads: process.threads,
      binaryBlockData: {
        data: {
          length: spanRefs.length,
          attributes: {
            getPosition: {value: binaryPositions, size: 3},
            getSize: {value: binarySizes, size: 2},
            getFillColor: {value: new Uint8Array(spanRefs.length * 4), size: 4},
            getLineColor: {value: new Uint8Array(spanRefs.length * 4), size: 4}
          }
        },
        spans: spanRefs
      },
      binaryDependencyLineData: EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA,
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
      spans: spanRefs
    };
    const binaryDependencyLineData = {
      data: {
        length: 0,
        attributes: {}
      },
      dependencies: []
    };
    const baseLayout = createLayout(graph);
    const expandedLayout = withProcessRenderRows(baseLayout, graph);
    const collapsedLayout = withProcessCollapsed(
      expandedLayout,
      expandedLayout.renderRows[0]!.processRef,
      true
    );
    const makeRankLayer = (traceLayout: TraceLayout) =>
      new TraceProcessLayer({
        id: 'rank-collapsed-label-row',
        threads: process.threads,
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
    expect(collapsedLabelLayer?.props.updateTriggers?.getContentBox).toEqual(
      expandedLabelLayer?.props.updateTriggers?.getContentBox
    );
    expect(collapsedLabelLayer?.props.updateTriggers?.getText).toEqual(
      expandedLabelLayer?.props.updateTriggers?.getText
    );
  });

  it('does not rebuild curve dependency data when a process is hidden by collapse', () => {
    const graph = createDependencyGraph();
    const process = graph.processes[0]!;
    const layout = buildLayoutFromGraph(graph);
    const collapsedLayout = withProcessCollapsed(layout, layout.renderRows[0]!.processRef, true);
    const settings = {
      ...getTraceSettings(),
      lineRoutingMode: 'curve',
      showDependencies: true
    } satisfies TraceVisSettings;
    const rankLayer = new TraceProcessLayer({
      id: 'rank-collapsed-curve-dependencies',
      threads: process.threads,
      ...getPreparedTraceProcessBinaryData({graph, layout, settings}),
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
          collapsedActivityIntervals: [],
          overflowLabels: []
        }
      ],
      traceGraph: {crossProcessDependencies: []},
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
    expect(legendLayer.props.threadRefs).toEqual(row.threadRefs);
  });

  it('keeps rank-layer bounds local when a rank has no local geometry', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const hiddenThreadLayout = {
      ...getLayoutThread(baseLayout, processId, threadId),
      visible: false
    };
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        currentBounds: [
          [0, 0],
          [500, 500]
        ],
        threadLayoutMapByRef: setLayoutThread(baseLayout, processId, threadId, hiddenThreadLayout),
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            threadLayouts: [hiddenThreadLayout]
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const rankLayer = new TraceProcessLayer({
      id: 'rank-local-bounds',
      threads: graph.processes[0]!.threads,
      binaryBlockData: EMPTY_TRACE_PROCESS_BINARY_BLOCK_DATA,
      binaryDependencyLineData: EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA,
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

  it('keeps separate-thread rank bounds row-local when process-local thread ids repeat', () => {
    const graph = createRepeatedThreadGraph();
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const firstRank = graph.processes[0]!;
    const rankLayer = new TraceProcessLayer({
      id: 'rank-repeated-thread-bounds',
      threads: firstRank.threads,
      binaryBlockData: EMPTY_TRACE_PROCESS_BINARY_BLOCK_DATA,
      binaryDependencyLineData: EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA,
      selectedSpanRefs: [],
      selectedDependencies: [],
      rankIndex: 0,
      processId: firstRank.processId,
      rankNum: firstRank.rankNum,
      stepNum: 0,
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });

    expect(rankLayer.getBounds()).toEqual([
      [-0.5, -0.5],
      [1.5, 1.5]
    ]);
  });

  it('includes collapsed activity intervals in rank-layer bounds without widening to trace bounds', () => {
    const graph = createGraph();
    const baseLayout = createLayout(graph);
    const processId = graph.processes[0]!.processId;
    const threadId = graph.processes[0]!.threads[0]!.threadId;
    const hiddenThreadLayout = {
      ...getLayoutThread(baseLayout, processId, threadId),
      visible: false
    };
    const layout = withProcessRenderRows(
      {
        ...baseLayout,
        currentBounds: [
          [0, 0],
          [500, 500]
        ],
        threadLayoutMapByRef: setLayoutThread(baseLayout, processId, threadId, hiddenThreadLayout),
        processLayouts: [
          {
            ...baseLayout.processLayouts[0]!,
            isCollapsed: true,
            collapsedActivityY: 0.25,
            threadLayouts: [hiddenThreadLayout]
          }
        ]
      } satisfies TraceLayout,
      graph
    );

    const rankLayer = new TraceProcessLayer({
      id: 'rank-collapsed-activity-bounds',
      threads: graph.processes[0]!.threads,
      binaryBlockData: EMPTY_TRACE_PROCESS_BINARY_BLOCK_DATA,
      binaryDependencyLineData: EMPTY_TRACE_PROCESS_BINARY_DEPENDENCY_DATA,
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

  it('derives selected span outline geometry from the current layout', () => {
    const graph = createGraph();
    const selectedSpanRef = encodeSpanRef(0, 0);
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const expectedGeometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    expect(
      fillTraceLayoutSpanGeometry({
        traceLayout: layout,
        spanRef: selectedSpanRef,
        target: expectedGeometry
      })
    ).toBe(true);
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
      | (AnimationLayer<BlockLayer<SpanRef>> & {
          props: {
            layer: BlockLayer<SpanRef> & {
              props: {
                data: readonly SpanRef[];
                getPosition: (source: SpanRef) => number[];
                getSize: (source: SpanRef) => number[];
                getLineWidth: number;
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
    expect(outlineLayer).toBeInstanceOf(BlockLayer);
    expect(outlineLayer?.props.data).toEqual([selectedSpanRef]);
    expect(outlineLayer?.props.getPosition(selectedSpanRef)).toEqual([
      expectedGeometry.x1,
      expectedGeometry.y1
    ]);
    expect(outlineLayer?.props.getSize(selectedSpanRef)).toEqual([
      expectedGeometry.x2 - expectedGeometry.x1,
      expectedGeometry.y2 - expectedGeometry.y1
    ]);
    expect(outlineLayer?.props.getLineWidth).toBe(4);
  });

  it('derives hovered span overlay geometry from the current layout', () => {
    const graph = createGraph();
    const hoveredSpanRef = encodeSpanRef(0, 0);
    const runtimeGraph = normalizeVisibleTraceGraphSource(graph);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const hoveredBlock = runtimeGraph.getSpanDetailSource(hoveredSpanRef);
    expect(hoveredBlock).not.toBeNull();
    if (!hoveredBlock) {
      return;
    }
    const expectedGeometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    expect(
      fillTraceLayoutSpanGeometry({
        traceLayout: layout,
        spanRef: hoveredSpanRef,
        target: expectedGeometry
      })
    ).toBe(true);

    const layers = buildDeckLayersForTrace({
      processRows: getRowEnrichments(layout, graph),
      traceGraph: materializeJSONTrace(graph),
      stepNum: 0,
      hoveredSpan: {rankIndex: 0, block: hoveredBlock},
      selectedSpanRefs: [],
      selectedDependencies: [],
      onSpanClick: () => undefined,
      traceLayout: layout,
      settings: getTraceSettings()
    });
    const hoveredLayer = layers.find(layer => layer.id.endsWith('hovered-block-overlay')) as
      | (BlockLayer<TraceRenderSpan> & {
          props: {
            data: readonly TraceRenderSpan[];
            getPosition: (source: TraceRenderSpan) => number[];
            getSize: (source: TraceRenderSpan) => number[];
          };
        })
      | undefined;

    expect(hoveredLayer).toBeInstanceOf(BlockLayer);
    expect(hoveredLayer?.props.data).toEqual([hoveredBlock]);
    expect(hoveredLayer?.props.getPosition(hoveredBlock)).toEqual([
      expectedGeometry.x1,
      expectedGeometry.y1
    ]);
    expect(hoveredLayer?.props.getSize(hoveredBlock)).toEqual([
      expectedGeometry.x2 - expectedGeometry.x1,
      expectedGeometry.y2 - expectedGeometry.y1
    ]);
  });

  it('renders selected span outlines from the scene-level overlay layer', () => {
    const graph = createMultiGraph();
    const runtimeGraph = createRuntimeTraceGraph(graph);
    const selectedSpanRef = encodeSpanRef(0, 0);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
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
    ) as AnimationLayer<BlockLayer<SpanRef>> | undefined;
    const secondSelectedLayer = secondLayers.find(layer =>
      layer.id.endsWith('selected-block-overlays')
    ) as AnimationLayer<BlockLayer<SpanRef>> | undefined;

    expect(firstSelectedLayer?.props.layer.props.data).toEqual([selectedSpanRef]);
    expect(secondSelectedLayer?.props.layer.props.data).toEqual([selectedSpanRef]);
  });

  it('uses an animated binary rectangle layer for selected span outlines', () => {
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
      | AnimationLayer<BlockLayer<SpanRef>>
      | undefined;
    const outlineLayer = selectedLayer?.props.layer;
    const selectedLayerIndex = layers.findIndex(layer =>
      layer.id.endsWith('selected-block-overlays')
    );

    expect(layers.find(layer => layer.id.endsWith('selected-block-halo'))).toBeUndefined();
    expect(selectedLayerIndex).toBeGreaterThanOrEqual(0);
    expect(selectedLayer).toBeInstanceOf(AnimationLayer);
    expect(outlineLayer).toBeInstanceOf(BlockLayer);
    expect(outlineLayer?.props.modelMatrix).toBe(modelMatrix);
    expect(outlineLayer?.props.getLineWidth).toBe(4);
    expect(outlineLayer?.props.extensions).toEqual([]);
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
          props: {getLineColor: number[]};
        }[]
      | undefined;
    expect(selectedLayer?.props.repeatType).toBe('loop');
    expect(animationFrames).toHaveLength(2);
    expect(animationFrames?.[0]).toMatchObject({
      duration: 1200,
      props: {
        getLineColor: [255, 0, 0, 255]
      }
    });
    expect(animationFrames?.[1]).toMatchObject({
      duration: 1200,
      props: {
        getLineColor: [0, 0, 0, 255]
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
      getSpanStyleForRef: ({spanRef}) =>
        spanRef === selectedSpanRef
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
      | AnimationLayer<BlockLayer<SpanRef>>
      | undefined;

    const getLineColor = selectedLayer?.props.layer.props.getLineColor;
    expect(getLineColor).toEqual([0, 0, 0, 255]);
    expect(getLineColor).not.toEqual(selectedFillColor);
  });

  it('keeps renderRows stable when unrelated display settings change', () => {
    const graph = createGraph();
    const layout = withProcessRenderRows(createLayout(graph), graph);
    const rebuiltLayout = {
      ...layout,
      layoutConfiguration: {
        ...layout.layoutConfiguration,
        laneSeparation: layout.layoutConfiguration?.laneSeparation ?? 0.7,
        timingKey: 'next'
      }
    } satisfies TraceLayout;

    expect(rebuiltLayout.renderRows).toBe(layout.renderRows);
    expect(getSingleRow(rebuiltLayout).threads).toBe(getSingleRow(layout).threads);
  });
});

describe('prepared scene derived data', () => {
  it('derives collapsed-activity intervals without retaining row enrichment state', () => {
    const graph = createMultiGraph();
    const runtimeGraph = createRuntimeGraph(graph);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const collapsedActivityByProcessRef = new Map([
      [layout.renderRows[0]!.processRef, [{startX: 9, endX: 10, activity: 1}]],
      [layout.renderRows[1]!.processRef, [{startX: 1, endX: 2, activity: 2}]]
    ]) satisfies CollapsedActivityByProcessRef;

    const first = buildTraceLayoutRowEnrichments({
      traceLayout: layout,
      collapsedActivityByProcessRef
    });
    const second = buildTraceLayoutRowEnrichments({
      traceLayout: layout,
      collapsedActivityByProcessRef
    });

    expect(second).not.toBe(first);
    expect(second[0]?.collapsedActivityIntervals).not.toBe(first[0]?.collapsedActivityIntervals);
    expect(second).toEqual(first);
    expect(second[0]?.collapsedActivityIntervals).toEqual([{startX: 9, endX: 10, activity: 1}]);
    expect(second[1]?.collapsedActivityIntervals).toEqual([{startX: 1, endX: 2, activity: 2}]);
  });

  it('keeps overflow-label enrichment off visible span projections', () => {
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
          y: threadLayout.yPosition
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
    const renderSpanRefsSpy = vi.spyOn(runtimeTraceGraph, 'iterateVisibleSpanRefsByProcess');

    buildTraceLayoutRowEnrichments({
      traceLayout: layout,
      collapsedActivityByProcessRef: new Map()
    });

    expect(renderSpanRefsSpy).not.toHaveBeenCalled();
  });

  it('derives positions and colors from the graph and layout', () => {
    const graph = createGraph();
    const materializedGraph = materializeJSONTrace(graph);
    const runtimeGraph = createRuntimeGraph(graph);
    const layout = withRuntimeTraceGraph(createLayout(graph), runtimeGraph);
    const {instants, counters} = buildDerivedTraceData({
      traceGraph: runtimeGraph,
      traceLayout: layout,
      colorScheme
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
  });
});
