import * as arrow from 'apache-arrow';

import {
  buildArrowTraceCrossDependencyTable,
  buildArrowTraceLocalDependencyTable,
  buildArrowTraceLocalDependencyTableFromColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildCrossDependencyIdToIndexMap,
  buildTraceGraphData,
  computeArrowTraceTimeExtents
} from '../ingestion/arrow-trace';
import {log} from '../log';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from './trace-graph';
import {
  encodeChunkRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  getLocalDependencyRefRowIndex,
  getSpanRefRowIndex,
  isLocalDependencyRef
} from './trace-id-encoder';

import type {
  ArrowTraceChunk,
  ArrowTraceCrossDependencyTable,
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanSidecarTable,
  ArrowTraceSpanTable,
  TraceCrossProcessEndpointsBySpanRef,
  TraceGraphData,
  TraceSpanArrowSidecarRow
} from '../ingestion/arrow-trace';
import type {TraceGraphPreparedState} from './trace-graph';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependency,
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcessId,
  TraceSpanId
} from './trace-types';

/**
 * Process/rank payload appended into a mutable multi-process trace.
 *
 * Span and dependency Arrow tables are canonical; object arrays are accepted only as legacy
 * compatibility inputs for non-Arrow callers.
 */
export type MultiProcessTraceProcessData = {
  /** App-owned stable key for the storage chunk created from this process data. */
  chunkKey?: string;
  /** Final process index reserved before the process data was converted. */
  processIndex?: number;
  /** Whether span/dependency refs already encode `processIndex` and must not be rebased. */
  refsAreFinal?: boolean;
  /** Metadata-only process row used when assembling a TraceGraphData. */
  process: Readonly<ArrowTraceProcessMetadata>;
  /** Canonical process-local Arrow span table. */
  spanTable: ArrowTraceSpanTable;
  /** Optional canonical process-local Arrow dependency table. */
  localDependencyTable?: ArrowTraceLocalDependencyTable;
  /** Optional row-aligned Arrow sidecar table. */
  spanSidecarTable?: ArrowTraceSpanSidecarTable;
  /** Optional row-aligned sidecar rows for legacy cards/search/tooltips. */
  spanSidecarRows?: readonly TraceSpanArrowSidecarRow[];
  /** Unresolved cross-process endpoints grouped by endpoint id. */
  crossProcessEndpointsByEndpointId: Readonly<
    Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>
  >;
};

/**
 * Immutable multi-process trace assembly state used by process-scoped chunk loading.
 */
export type MultiProcessTrace<
  TProcessData extends MultiProcessTraceProcessData = MultiProcessTraceProcessData
> = {
  /** Human-friendly trace name. */
  name: string;
  /** Process keys available for this trace. */
  allProcessKeys: readonly string[];
  /** Loaded process keys in TraceGraphData process order. */
  loadedProcessKeys: readonly string[];
  /** Loaded process data keyed by app-owned process key. */
  processDataMap: Readonly<Record<string, TProcessData>>;
  /** Whether cross-process dependencies need a full rebuild. */
  crossDependenciesNeedUpdate: boolean;
  /** Cross-process dependencies for currently loaded processes. */
  crossDependencies: readonly TraceCrossProcessDependency[];
  /** Cached unresolved endpoint groups for currently loaded processes. */
  _crossProcessEndpointMap?: MultiProcessTraceEndpointMap;
  /** Cached dependency map keyed by a topology-aware dedupe key. */
  _crossDependencyMap?: Readonly<Record<string, TraceCrossProcessDependency>>;
  /** Whether the cached TraceGraphData needs rebuilding. */
  traceGraphDataNeedsUpdate: boolean;
  /** Cached step-level TraceGraphData, or null when no process is loaded. */
  traceGraphData: TraceGraphData | null;
  /** Whether the cached no-filter TraceGraph needs rebuilding. */
  traceGraphNeedsUpdate: boolean;
  /** Cached immutable no-filter TraceGraph, or null when no process is loaded. */
  traceGraph: TraceGraph | null;
  /** Cached no-filter span state for the cached immutable TraceGraph. */
  traceGraphPreparedState: TraceGraphPreparedState;
};

/** Options that customize cross-rank stitching while appending process chunks. */
export type MultiProcessTraceOptions = {
  /** Builds a stable dependency id for an endpoint pair. */
  createDependencyId?: (
    startSpanId: TraceSpanId,
    endSpanId: TraceSpanId,
    dependencyType: 'bidirectional'
  ) => TraceDependencyId;
  /** Builds a stable dependency id directly from resolved endpoint span refs. */
  createDependencyIdFromSpanRefs?: (
    startSpanRef: SpanRef,
    endSpanRef: SpanRef,
    dependencyType: 'bidirectional'
  ) => TraceDependencyId;
};

type MultiProcessTraceEndpointMap = Record<
  TraceCrossProcessEndpointId,
  readonly TraceCrossProcessEndpoint[]
>;

type SpanRefLookup = {
  /** Returns the span ref for one loaded process-local block id. */
  getForProcessIndex: (processIndex: number, spanId: TraceSpanId) => SpanRef | undefined;
  /** Returns the span ref for one rank-scoped block id. */
  getForRankNum: (rankNum: number | undefined, spanId: TraceSpanId) => SpanRef | undefined;
};

type CrossDependencyEndpointPairIndex = {
  /** Target-aware endpoints keyed by `sourceRank->targetRank`. */
  endpointsByRankPair: Map<string, TraceCrossProcessEndpoint[]>;
  /** Target-aware endpoints keyed by their requested target rank. */
  targetedEndpointsByEndRankNum: Map<number, TraceCrossProcessEndpoint[]>;
  /** Legacy target-less endpoints keyed by their owning rank. */
  wildcardEndpointsByStartRankNum: Map<number, TraceCrossProcessEndpoint[]>;
};

type MultiProcessTraceUpdateMetrics = {
  /** Time spent updating cross-dependency state for an appended process. */
  crossDependencyDurationMs: number;
  /** Time spent merging endpoint maps during a full cross-dependency rebuild. */
  endpointMergeDurationMs: number;
  /** Time spent rebuilding the cross-dependency map from endpoint groups. */
  dependencyMapDurationMs: number;
  /** Time spent shallow-copying the cached endpoint map for an incremental append. */
  endpointMapCopyDurationMs: number;
  /** Time spent shallow-copying the cached dependency map for an incremental append. */
  dependencyMapCopyDurationMs: number;
  /** Time spent matching added endpoints to existing endpoint groups. */
  endpointMatchingDurationMs: number;
  /** Time spent materializing the appended cross-dependency array. */
  crossDependencyArrayAppendDurationMs: number;
  /** Time spent locating currently loaded process data. */
  processDataLookupDurationMs: number;
  /** Total time spent building the next TraceGraphData. */
  traceGraphDataDurationMs: number;
  /** Time spent rebasing process-local dependencies and process metadata. */
  processRebaseDurationMs: number;
  /** Time spent rebasing cross dependencies to the current process order. */
  crossDependencyRebaseDurationMs: number;
  /** Time spent building the Arrow cross-dependency table. */
  crossDependencyTableDurationMs: number;
  /** Number of append updates that reused the previous Arrow cross-dependency table. */
  crossDependencyTableReuseCount: number;
  /** Time spent building the cross-dependency id-to-index map. */
  crossDependencyIndexDurationMs: number;
  /** Number of append updates that reused the previous cross-dependency id-to-index map. */
  crossDependencyIndexReuseCount: number;
  /** Time spent rebuilding dependency lookup indexes. */
  dependencyIndexDurationMs: number;
  /** Time spent computing merged TraceGraphData time extents. */
  timeExtentsDurationMs: number;
  /** Time spent constructing the final TraceGraphData object and table maps. */
  traceGraphDataObjectDurationMs: number;
  /** Time spent preparing no-filter TraceGraph span state. */
  traceGraphPreparedStateDurationMs: number;
  /** Time spent constructing the immutable TraceGraph wrapper. */
  traceGraphConstructDurationMs: number;
  /** Total time spent updating TraceGraph state from the fresh TraceGraphData. */
  traceGraphUpdateDurationMs: number;
};

/**
 * Creates an empty incremental multi-process trace.
 */
export function multiProcessTrace_create<
  TProcessData extends MultiProcessTraceProcessData = MultiProcessTraceProcessData
>(params: {
  /** Human-friendly trace name. */
  name: string;
  /** Initially available process keys. */
  allProcessKeys?: readonly string[];
}): MultiProcessTrace<TProcessData> {
  return {
    name: params.name,
    allProcessKeys: params.allProcessKeys ?? [],
    loadedProcessKeys: [],
    processDataMap: {},
    crossDependenciesNeedUpdate: false,
    crossDependencies: [],
    traceGraphDataNeedsUpdate: false,
    traceGraphData: null,
    traceGraphNeedsUpdate: false,
    traceGraph: null,
    traceGraphPreparedState: createEmptyTraceGraphPreparedState()
  };
}

/**
 * Updates the available process list without changing loaded process data.
 */
export function multiProcessTrace_updateProcessList<
  TProcessData extends MultiProcessTraceProcessData
>(
  trace: Readonly<MultiProcessTrace<TProcessData>>,
  processKeys: readonly string[]
): MultiProcessTrace<TProcessData> {
  return {
    ...trace,
    allProcessKeys: [...processKeys]
  };
}

/**
 * Adds one process and incrementally updates cross dependencies plus the cached TraceGraphData.
 */
export function multiProcessTrace_addProcessData<TProcessData extends MultiProcessTraceProcessData>(
  trace: Readonly<MultiProcessTrace<TProcessData>>,
  processKey: string,
  processData: TProcessData,
  options: MultiProcessTraceOptions = {}
): MultiProcessTrace<TProcessData> {
  if (trace.loadedProcessKeys.includes(processKey)) {
    return trace as MultiProcessTrace<TProcessData>;
  }

  const expectedProcessIndex = trace.loadedProcessKeys.length;
  if (processData.refsAreFinal && processData.processIndex !== expectedProcessIndex) {
    throw new Error(
      `Cannot append process ${processKey}: final refs use process index ${String(
        processData.processIndex
      )}, expected ${expectedProcessIndex}`
    );
  }

  const updateStartTime = performance.now();
  const metrics = createMultiProcessTraceUpdateMetrics();

  log.probe(1, `MultiProcessTrace append process ${processKey} start`, {
    name: trace.name,
    loadedProcessCount: trace.loadedProcessKeys.length,
    expectedProcessIndex,
    processDataProcessIndex: processData.processIndex,
    refsAreFinal: processData.refsAreFinal === true,
    addedEndpointGroupCount: Object.keys(processData.crossProcessEndpointsByEndpointId).length,
    previousCrossDependencyCount: trace.crossDependencies.length,
    hasEndpointMap: trace._crossProcessEndpointMap !== undefined,
    hasCrossDependencyMap: trace._crossDependencyMap !== undefined,
    crossDependenciesNeedUpdate: trace.crossDependenciesNeedUpdate
  })();
  const crossDependencyStartTime = performance.now();
  const crossDependencyState = buildCrossDependencyStateForAdd({
    addedProcessData: processData,
    metrics,
    options,
    trace
  });
  metrics.crossDependencyDurationMs = performance.now() - crossDependencyStartTime;

  const nextTrace: MultiProcessTrace<TProcessData> = {
    ...trace,
    loadedProcessKeys: [...trace.loadedProcessKeys, processKey],
    processDataMap: {
      ...trace.processDataMap,
      [processKey]: processData
    },
    crossDependenciesNeedUpdate: crossDependencyState.crossDependenciesNeedUpdate,
    crossDependencies: crossDependencyState.crossDependencies,
    _crossProcessEndpointMap: crossDependencyState._crossProcessEndpointMap,
    _crossDependencyMap: crossDependencyState._crossDependencyMap,
    traceGraphDataNeedsUpdate: true,
    traceGraphData: null,
    traceGraphNeedsUpdate: true,
    traceGraph: null
  };

  const updatedTrace = multiProcessTrace_updateTraceGraphData(nextTrace, {
    addedProcessData: processData,
    addedCrossDependencies:
      crossDependencyState.crossDependencyBuildMode === 'incremental'
        ? crossDependencyState.newCrossDependencies
        : undefined,
    metrics,
    options,
    previousTraceGraphData: trace.traceGraphData
  });

  log.probe(0, `MultiProcessTrace append process ${processKey} done`, {
    name: trace.name,
    loadedProcessCount: updatedTrace.loadedProcessKeys.length,
    addedSpanCount: processData.spanTable.numRows,
    totalSpanCount: updatedTrace.traceGraphData?.stats.spanCount ?? processData.spanTable.numRows,
    addedEndpointGroupCount: crossDependencyState.addedEndpointGroupCount,
    addedEndpointCount: crossDependencyState.addedEndpointCount,
    crossDependencyBuildMode: crossDependencyState.crossDependencyBuildMode,
    matchedEndpointGroupCount: crossDependencyState.matchedEndpointGroupCount,
    endpointPairCandidateCount: crossDependencyState.endpointPairCandidateCount,
    previousCrossDependencyCount: trace.crossDependencies.length,
    addedCrossDependencyCount: crossDependencyState.newCrossDependencyCount,
    crossDependencyCount: updatedTrace.crossDependencies.length,
    crossDependencyDurationMs: metrics.crossDependencyDurationMs,
    endpointMergeDurationMs: metrics.endpointMergeDurationMs,
    dependencyMapDurationMs: metrics.dependencyMapDurationMs,
    endpointMapCopyDurationMs: metrics.endpointMapCopyDurationMs,
    dependencyMapCopyDurationMs: metrics.dependencyMapCopyDurationMs,
    endpointMatchingDurationMs: metrics.endpointMatchingDurationMs,
    crossDependencyArrayAppendDurationMs: metrics.crossDependencyArrayAppendDurationMs,
    processDataLookupDurationMs: metrics.processDataLookupDurationMs,
    traceGraphDataDurationMs: metrics.traceGraphDataDurationMs,
    processRebaseDurationMs: metrics.processRebaseDurationMs,
    crossDependencyRebaseDurationMs: metrics.crossDependencyRebaseDurationMs,
    crossDependencyTableDurationMs: metrics.crossDependencyTableDurationMs,
    crossDependencyTableReuseCount: metrics.crossDependencyTableReuseCount,
    crossDependencyIndexDurationMs: metrics.crossDependencyIndexDurationMs,
    crossDependencyIndexReuseCount: metrics.crossDependencyIndexReuseCount,
    dependencyIndexDurationMs: metrics.dependencyIndexDurationMs,
    timeExtentsDurationMs: metrics.timeExtentsDurationMs,
    traceGraphDataObjectDurationMs: metrics.traceGraphDataObjectDurationMs,
    traceGraphPreparedStateDurationMs: metrics.traceGraphPreparedStateDurationMs,
    traceGraphConstructDurationMs: metrics.traceGraphConstructDurationMs,
    traceGraphUpdateDurationMs: metrics.traceGraphUpdateDurationMs,
    durationMs: performance.now() - updateStartTime
  })();

  return updatedTrace;
}

/**
 * Removes one process and invalidates cross-dependency and TraceGraphData caches.
 */
export function multiProcessTrace_removeProcessData<
  TProcessData extends MultiProcessTraceProcessData
>(
  trace: Readonly<MultiProcessTrace<TProcessData>>,
  processKey: string
): MultiProcessTrace<TProcessData> {
  if (!trace.loadedProcessKeys.includes(processKey)) {
    return trace as MultiProcessTrace<TProcessData>;
  }
  const removedProcessId = trace.processDataMap[processKey]?.process.processId as
    | TraceProcessId
    | undefined;
  const processDataMap = {...trace.processDataMap};
  delete processDataMap[processKey];

  return {
    ...trace,
    loadedProcessKeys: trace.loadedProcessKeys.filter(key => key !== processKey),
    processDataMap,
    crossDependenciesNeedUpdate: true,
    crossDependencies: [],
    _crossProcessEndpointMap: undefined,
    _crossDependencyMap: undefined,
    traceGraphDataNeedsUpdate: true,
    traceGraphData: null,
    traceGraphNeedsUpdate: true,
    traceGraph: null,
    traceGraphPreparedState: removedProcessId
      ? createEmptyTraceGraphPreparedState()
      : trace.traceGraphPreparedState
  };
}

/**
 * Rebuilds cross-process dependencies and the cached TraceGraphData when either cache is stale.
 */
export function multiProcessTrace_updateCrossDependencies<
  TProcessData extends MultiProcessTraceProcessData
>(
  trace: Readonly<MultiProcessTrace<TProcessData>>,
  options: MultiProcessTraceOptions = {}
): MultiProcessTrace<TProcessData> {
  if (!trace.crossDependenciesNeedUpdate && !trace.traceGraphDataNeedsUpdate) {
    return trace as MultiProcessTrace<TProcessData>;
  }
  const updateStartTime = performance.now();
  const metrics = createMultiProcessTraceUpdateMetrics();
  const processDataLookupStartTime = performance.now();
  const processDatas = getLoadedProcessDatas(trace);
  metrics.processDataLookupDurationMs = performance.now() - processDataLookupStartTime;

  const endpointMergeStartTime = performance.now();
  const endpointMap = mergeCrossProcessEndpointMaps(processDatas);
  metrics.endpointMergeDurationMs = performance.now() - endpointMergeStartTime;

  const dependencyMapStartTime = performance.now();
  const dependencyMap = buildCrossDependencyMapFromEndpointMap(endpointMap, options);
  metrics.dependencyMapDurationMs = performance.now() - dependencyMapStartTime;

  const nextTrace: MultiProcessTrace<TProcessData> = {
    ...trace,
    _crossProcessEndpointMap: endpointMap,
    _crossDependencyMap: dependencyMap,
    crossDependenciesNeedUpdate: false,
    crossDependencies: Object.values(dependencyMap),
    traceGraphDataNeedsUpdate: true,
    traceGraphNeedsUpdate: true,
    traceGraph: null
  };
  const updatedTrace = multiProcessTrace_updateTraceGraphData(nextTrace, {metrics, options});

  log.probe(0, `MultiProcessTrace rebuild ${trace.name} done`, {
    loadedProcessCount: updatedTrace.loadedProcessKeys.length,
    crossDependencyCount: updatedTrace.crossDependencies.length,
    processDataLookupDurationMs: metrics.processDataLookupDurationMs,
    endpointMergeDurationMs: metrics.endpointMergeDurationMs,
    dependencyMapDurationMs: metrics.dependencyMapDurationMs,
    traceGraphDataDurationMs: metrics.traceGraphDataDurationMs,
    processRebaseDurationMs: metrics.processRebaseDurationMs,
    crossDependencyRebaseDurationMs: metrics.crossDependencyRebaseDurationMs,
    crossDependencyTableDurationMs: metrics.crossDependencyTableDurationMs,
    crossDependencyTableReuseCount: metrics.crossDependencyTableReuseCount,
    crossDependencyIndexDurationMs: metrics.crossDependencyIndexDurationMs,
    crossDependencyIndexReuseCount: metrics.crossDependencyIndexReuseCount,
    dependencyIndexDurationMs: metrics.dependencyIndexDurationMs,
    traceGraphDataObjectDurationMs: metrics.traceGraphDataObjectDurationMs,
    traceGraphPreparedStateDurationMs: metrics.traceGraphPreparedStateDurationMs,
    traceGraphConstructDurationMs: metrics.traceGraphConstructDurationMs,
    traceGraphUpdateDurationMs: metrics.traceGraphUpdateDurationMs,
    durationMs: performance.now() - updateStartTime
  })();

  return updatedTrace;
}

/**
 * Returns a trace with a fresh cached TraceGraphData when the TraceGraphData cache is stale.
 */
export function multiProcessTrace_updateTraceGraphData<
  TProcessData extends MultiProcessTraceProcessData
>(
  trace: Readonly<MultiProcessTrace<TProcessData>>,
  incrementalOptions?: {
    /** Process that was just appended. */
    addedProcessData?: TProcessData;
    /** Cross dependencies created by the append, before span-ref rebasing. */
    addedCrossDependencies?: readonly TraceCrossProcessDependency[];
    /** Optional probe accumulator for the current update. */
    metrics?: MultiProcessTraceUpdateMetrics;
    /** Assembly options for the current update. */
    options?: MultiProcessTraceOptions;
    /** Cached TraceGraphData from before the append. */
    previousTraceGraphData?: TraceGraphData | null;
  }
): MultiProcessTrace<TProcessData> {
  if (!trace.traceGraphDataNeedsUpdate) {
    return trace as MultiProcessTrace<TProcessData>;
  }
  const processDataLookupStartTime = performance.now();
  const processDatas = getLoadedProcessDatas(trace);
  if (incrementalOptions?.metrics) {
    incrementalOptions.metrics.processDataLookupDurationMs +=
      performance.now() - processDataLookupStartTime;
  }

  const traceGraphDataStartTime = performance.now();
  const traceGraphData =
    incrementalOptions?.previousTraceGraphData && incrementalOptions.addedProcessData
      ? buildTraceGraphDataAfterProcessAppend({
          addedProcessData: incrementalOptions.addedProcessData,
          addedCrossDependencies: incrementalOptions.addedCrossDependencies,
          crossDependencies: trace.crossDependencies,
          metrics: incrementalOptions.metrics,
          options: incrementalOptions.options,
          previousTraceGraphData: incrementalOptions.previousTraceGraphData,
          processDatas,
          traceName: trace.name
        })
      : buildTraceGraphDataFromProcessDatas({
          crossDependencies: trace.crossDependencies,
          metrics: incrementalOptions?.metrics,
          options: incrementalOptions?.options,
          processDatas,
          traceName: trace.name
        });
  if (incrementalOptions?.metrics) {
    incrementalOptions.metrics.traceGraphDataDurationMs +=
      performance.now() - traceGraphDataStartTime;
  }

  return updateTraceGraphFromFreshTraceGraphData(
    {
      ...trace,
      traceGraphData,
      traceGraphDataNeedsUpdate: false,
      traceGraphNeedsUpdate: true,
      traceGraph: null
    },
    incrementalOptions?.metrics
  );
}

/**
 * Returns a trace with a fresh cached no-filter TraceGraph when the TraceGraph cache is stale.
 */
export function multiProcessTrace_updateTraceGraph<
  TProcessData extends MultiProcessTraceProcessData
>(trace: Readonly<MultiProcessTrace<TProcessData>>): MultiProcessTrace<TProcessData> {
  if (trace.traceGraphDataNeedsUpdate) {
    return multiProcessTrace_updateTraceGraphData(trace);
  }
  if (!trace.traceGraphNeedsUpdate) {
    return trace as MultiProcessTrace<TProcessData>;
  }
  return updateTraceGraphFromFreshTraceGraphData(trace);
}

/**
 * Returns the cached immutable no-filter TraceGraph.
 */
export function multiProcessTrace_getTraceGraph(
  trace: Readonly<MultiProcessTrace>
): TraceGraph | null {
  return trace.traceGraph;
}

/**
 * Builds TraceGraphData from currently loaded process data.
 */
export function multiProcessTrace_buildTraceGraphData(
  trace: Readonly<MultiProcessTrace>
): TraceGraphData | null {
  const processDatas = getLoadedProcessDatas(trace);
  return buildTraceGraphDataFromProcessDatas({
    crossDependencies: trace.crossDependencies,
    processDatas,
    traceName: trace.name
  });
}

/**
 * Returns the current cross-process dependency list.
 */
export function multiProcessTrace_getCrossDependencies(
  trace: Readonly<MultiProcessTrace>
): readonly TraceCrossProcessDependency[] {
  return trace.crossDependencies;
}

function getLoadedProcessDatas<TProcessData extends MultiProcessTraceProcessData>(
  trace: Readonly<MultiProcessTrace<TProcessData>>
): TProcessData[] {
  return trace.loadedProcessKeys.flatMap(processKey => {
    const processData = trace.processDataMap[processKey];
    return processData ? [processData] : [];
  });
}

function updateTraceGraphFromFreshTraceGraphData<TProcessData extends MultiProcessTraceProcessData>(
  trace: Readonly<MultiProcessTrace<TProcessData>>,
  metrics?: MultiProcessTraceUpdateMetrics
): MultiProcessTrace<TProcessData> {
  if (!trace.traceGraphData) {
    return {
      ...trace,
      traceGraphNeedsUpdate: false,
      traceGraph: null,
      traceGraphPreparedState: createEmptyTraceGraphPreparedState()
    };
  }

  const updateStartTime = performance.now();
  const preparedStateStartTime = performance.now();
  const traceGraphPreparedState = buildNoFilterTraceGraphPreparedState();
  if (metrics) {
    metrics.traceGraphPreparedStateDurationMs += performance.now() - preparedStateStartTime;
  }

  const constructStartTime = performance.now();
  const traceGraph = new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: `${trace.traceGraphData.name}:multi-process`,
      traceGraphData: trace.traceGraphData
    }),
    {
      preparedState: traceGraphPreparedState
    }
  );
  if (metrics) {
    metrics.traceGraphConstructDurationMs += performance.now() - constructStartTime;
    metrics.traceGraphUpdateDurationMs += performance.now() - updateStartTime;
  }

  return {
    ...trace,
    traceGraphNeedsUpdate: false,
    traceGraph,
    traceGraphPreparedState
  };
}

function createMultiProcessTraceUpdateMetrics(): MultiProcessTraceUpdateMetrics {
  return {
    crossDependencyDurationMs: 0,
    endpointMergeDurationMs: 0,
    dependencyMapDurationMs: 0,
    endpointMapCopyDurationMs: 0,
    dependencyMapCopyDurationMs: 0,
    endpointMatchingDurationMs: 0,
    crossDependencyArrayAppendDurationMs: 0,
    processDataLookupDurationMs: 0,
    traceGraphDataDurationMs: 0,
    processRebaseDurationMs: 0,
    crossDependencyRebaseDurationMs: 0,
    crossDependencyTableDurationMs: 0,
    crossDependencyTableReuseCount: 0,
    crossDependencyIndexDurationMs: 0,
    crossDependencyIndexReuseCount: 0,
    dependencyIndexDurationMs: 0,
    timeExtentsDurationMs: 0,
    traceGraphDataObjectDurationMs: 0,
    traceGraphPreparedStateDurationMs: 0,
    traceGraphConstructDurationMs: 0,
    traceGraphUpdateDurationMs: 0
  };
}

/**
 * Adds one measured subphase duration into a shared append/rebuild metrics accumulator.
 */
function addTraceUpdateMetric(
  metrics: MultiProcessTraceUpdateMetrics | undefined,
  key: keyof MultiProcessTraceUpdateMetrics,
  durationMs: number
): void {
  if (metrics) {
    metrics[key] += durationMs;
  }
}

function createEmptyTraceGraphPreparedState(): TraceGraphPreparedState {
  return {
    spanFilters: [],
    filteredSpanRefs: new Set<SpanRef>(),
    filteredSpanCountsByFilter: {
      spanFilterCount: 0,
      overlappingParentSpanFilterCount: 0,
      similarDurationChainSpanFilterCount: 0
    }
  };
}

function buildNoFilterTraceGraphPreparedState(): TraceGraphPreparedState {
  return createEmptyTraceGraphPreparedState();
}

function buildTraceGraphDataFromProcessDatas(params: {
  traceName: string;
  processDatas: readonly MultiProcessTraceProcessData[];
  crossDependencies: readonly TraceCrossProcessDependency[];
  metrics?: MultiProcessTraceUpdateMetrics;
  options?: MultiProcessTraceOptions;
}): TraceGraphData | null {
  if (params.processDatas.length === 0) {
    return null;
  }

  const spanRefLookup = buildSpanRefLookupForProcesses(params.processDatas);
  const processRebaseStartTime = performance.now();
  const processes = params.processDatas.map((processData, processIndex) =>
    buildMultiProcessTraceProcessMetadata(processData, processIndex, spanRefLookup)
  );
  addTraceUpdateMetric(
    params.metrics,
    'processRebaseDurationMs',
    performance.now() - processRebaseStartTime
  );
  const crossDependencyRebaseStartTime = performance.now();
  const rebasedCrossDependencies = rebaseCrossDependencies(params.crossDependencies, spanRefLookup);
  addTraceUpdateMetric(
    params.metrics,
    'crossDependencyRebaseDurationMs',
    performance.now() - crossDependencyRebaseStartTime
  );
  const crossDependencyTableStartTime = performance.now();
  const crossDependencyTable = buildArrowTraceCrossDependencyTable(rebasedCrossDependencies);
  addTraceUpdateMetric(
    params.metrics,
    'crossDependencyTableDurationMs',
    performance.now() - crossDependencyTableStartTime
  );
  const crossDependencyIndexStartTime = performance.now();
  const crossDependencyIdToIndexMap = buildCrossDependencyIdToIndexMap(rebasedCrossDependencies);
  addTraceUpdateMetric(
    params.metrics,
    'crossDependencyIndexDurationMs',
    performance.now() - crossDependencyIndexStartTime
  );
  const dependencyIndexStartTime = performance.now();
  const dependencyMap = buildDependencyIndex(processes, rebasedCrossDependencies);
  addTraceUpdateMetric(
    params.metrics,
    'dependencyIndexDurationMs',
    performance.now() - dependencyIndexStartTime
  );

  const traceGraphDataObjectStartTime = performance.now();
  const traceGraphData = buildTraceGraphData({
    name: params.traceName,
    processes,
    crossDependencies: rebasedCrossDependencies,
    spanTableMap: buildSpanTableMap(params.processDatas),
    localDependencyTableMap: buildLocalDependencyTableMap(params.processDatas, spanRefLookup),
    crossDependencyTable,
    spanSidecarMap: buildSpanSidecarMap(params.processDatas),
    spanSidecarTableMap: buildSpanSidecarTableMap(params.processDatas),
    crossProcessEndpointsBySpanRef: buildCrossProcessEndpointsBySpanRef(params.processDatas),
    chunks: buildArrowTraceChunksForProcessDatas(params.processDatas, spanRefLookup),
    crossDependencyIdToIndexMap,
    dependencyMap
  });
  addTraceUpdateMetric(
    params.metrics,
    'traceGraphDataObjectDurationMs',
    performance.now() - traceGraphDataObjectStartTime
  );
  return traceGraphData;
}

function buildTraceGraphDataAfterProcessAppend(params: {
  traceName: string;
  processDatas: readonly MultiProcessTraceProcessData[];
  addedProcessData: MultiProcessTraceProcessData;
  addedCrossDependencies?: readonly TraceCrossProcessDependency[];
  previousTraceGraphData: TraceGraphData;
  crossDependencies: readonly TraceCrossProcessDependency[];
  metrics?: MultiProcessTraceUpdateMetrics;
  options?: MultiProcessTraceOptions;
}): TraceGraphData | null {
  const processIndex = params.previousTraceGraphData.processes.length;
  const addedProcessId = params.addedProcessData.process.processId as TraceProcessId;
  if (
    params.processDatas.length !== processIndex + 1 ||
    params.processDatas[processIndex] !== params.addedProcessData ||
    params.previousTraceGraphData.processSpanTableMap[addedProcessId] !== undefined ||
    params.previousTraceGraphData.chunks.length !== processIndex ||
    !hasCompletePreviousChunkTables(params.previousTraceGraphData)
  ) {
    log.probe(1, 'MultiProcessTrace TraceGraphData append fallback rebuild', {
      traceName: params.traceName,
      processDataCount: params.processDatas.length,
      expectedProcessDataCount: processIndex + 1,
      addedProcessId,
      previousChunkCount: params.previousTraceGraphData.chunks.length,
      previousProcessCount: params.previousTraceGraphData.processes.length,
      previousHasAddedSpanTable:
        params.previousTraceGraphData.processSpanTableMap[addedProcessId] !== undefined,
      previousHasCompleteChunkTables: hasCompletePreviousChunkTables(params.previousTraceGraphData),
      addedCrossDependencyCount: params.addedCrossDependencies?.length,
      crossDependencyCount: params.crossDependencies.length
    })();
    return buildTraceGraphDataFromProcessDatas(params);
  }

  log.probe(1, 'MultiProcessTrace TraceGraphData append fast-path start', {
    traceName: params.traceName,
    processIndex,
    addedProcessId,
    addedSpanCount: params.addedProcessData.spanTable.numRows,
    previousSpanCount: params.previousTraceGraphData.stats.spanCount,
    previousCrossDependencyCount: params.previousTraceGraphData.crossDependencies.length,
    addedCrossDependencyCount: params.addedCrossDependencies?.length,
    crossDependencyCount: params.crossDependencies.length
  })();
  const spanRefLookup = buildSpanRefLookupForProcesses(params.processDatas);
  const processRebaseStartTime = performance.now();
  const addedProcess = buildMultiProcessTraceProcessMetadata(
    params.addedProcessData,
    processIndex,
    spanRefLookup
  );
  const processes = [...params.previousTraceGraphData.processes, addedProcess];
  addTraceUpdateMetric(
    params.metrics,
    'processRebaseDurationMs',
    performance.now() - processRebaseStartTime
  );
  log.probe(1, 'MultiProcessTrace TraceGraphData append cross-dependency rebase start', {
    traceName: params.traceName,
    addedCrossDependencyCount: params.addedCrossDependencies?.length,
    crossDependencyCount: params.crossDependencies.length
  })();
  const crossDependencyRebaseStartTime = performance.now();
  const rebasedAddedCrossDependencies =
    params.addedCrossDependencies != null
      ? rebaseCrossDependencies(params.addedCrossDependencies, spanRefLookup)
      : null;
  const hasRebasedAddedCrossDependencies =
    rebasedAddedCrossDependencies != null && rebasedAddedCrossDependencies.length > 0;
  const rebasedCrossDependencies =
    rebasedAddedCrossDependencies != null
      ? hasRebasedAddedCrossDependencies
        ? [...params.previousTraceGraphData.crossDependencies, ...rebasedAddedCrossDependencies]
        : params.previousTraceGraphData.crossDependencies
      : rebaseCrossDependencies(params.crossDependencies, spanRefLookup);
  addTraceUpdateMetric(
    params.metrics,
    'crossDependencyRebaseDurationMs',
    performance.now() - crossDependencyRebaseStartTime
  );
  log.probe(1, 'MultiProcessTrace TraceGraphData append cross-dependency rebase done', {
    traceName: params.traceName,
    rebasedAddedCrossDependencyCount: rebasedAddedCrossDependencies?.length,
    rebasedCrossDependencyCount: rebasedCrossDependencies.length,
    durationMs: performance.now() - crossDependencyRebaseStartTime
  })();
  log.probe(1, 'MultiProcessTrace TraceGraphData append cross-dependency table start', {
    traceName: params.traceName,
    hasRebasedAddedCrossDependencies,
    previousCrossDependencyTableRows: params.previousTraceGraphData.crossDependencyTable.numRows,
    rebasedCrossDependencyCount: rebasedCrossDependencies.length
  })();
  const crossDependencyTableStartTime = performance.now();
  const crossDependencyTable =
    rebasedAddedCrossDependencies != null && !hasRebasedAddedCrossDependencies
      ? params.previousTraceGraphData.crossDependencyTable
      : hasRebasedAddedCrossDependencies
        ? appendArrowTraceCrossDependencyTable({
            addedCrossDependencies: rebasedAddedCrossDependencies,
            previousCrossDependencyTable: params.previousTraceGraphData.crossDependencyTable
          })
        : buildArrowTraceCrossDependencyTable(rebasedCrossDependencies);
  if (rebasedAddedCrossDependencies != null && !hasRebasedAddedCrossDependencies) {
    addTraceUpdateMetric(params.metrics, 'crossDependencyTableReuseCount', 1);
  }
  addTraceUpdateMetric(
    params.metrics,
    'crossDependencyTableDurationMs',
    performance.now() - crossDependencyTableStartTime
  );
  log.probe(1, 'MultiProcessTrace TraceGraphData append cross-dependency table done', {
    traceName: params.traceName,
    crossDependencyTableRows: crossDependencyTable.numRows,
    durationMs: performance.now() - crossDependencyTableStartTime
  })();
  const crossDependencyIndexStartTime = performance.now();
  const crossDependencyIdToIndexMap =
    rebasedAddedCrossDependencies != null
      ? hasRebasedAddedCrossDependencies
        ? buildCrossDependencyIdToIndexMapAfterProcessAppend({
            addedCrossDependencies: rebasedAddedCrossDependencies,
            previousCrossDependencyCount: params.previousTraceGraphData.crossDependencies.length,
            previousCrossDependencyIdToIndexMap:
              params.previousTraceGraphData.crossDependencyIdToIndexMap ?? {}
          })
        : params.previousTraceGraphData.crossDependencyIdToIndexMap
      : buildCrossDependencyIdToIndexMap(rebasedCrossDependencies);
  if (rebasedAddedCrossDependencies != null && !hasRebasedAddedCrossDependencies) {
    addTraceUpdateMetric(params.metrics, 'crossDependencyIndexReuseCount', 1);
  }
  addTraceUpdateMetric(
    params.metrics,
    'crossDependencyIndexDurationMs',
    performance.now() - crossDependencyIndexStartTime
  );
  log.probe(1, 'MultiProcessTrace TraceGraphData append dependency index start', {
    traceName: params.traceName,
    hasIncrementalCrossDependencies: rebasedAddedCrossDependencies !== null,
    addedLocalDependencyCount: addedProcess.localDependencies?.length ?? 0,
    addedCrossDependencyCount: rebasedAddedCrossDependencies?.length
  })();
  const dependencyIndexStartTime = performance.now();
  const dependencyMap =
    rebasedAddedCrossDependencies != null
      ? buildDependencyIndexAfterProcessAppend({
          addedCrossDependencies: rebasedAddedCrossDependencies,
          addedProcess,
          previousDependencyMap: params.previousTraceGraphData.dependencyMap
        })
      : buildDependencyIndex(processes, rebasedCrossDependencies);
  addTraceUpdateMetric(
    params.metrics,
    'dependencyIndexDurationMs',
    performance.now() - dependencyIndexStartTime
  );
  log.probe(1, 'MultiProcessTrace TraceGraphData append dependency index done', {
    traceName: params.traceName,
    durationMs: performance.now() - dependencyIndexStartTime
  })();
  const spanTableMap = {
    ...buildSpanTableMapFromChunks(params.previousTraceGraphData.chunks),
    [addedProcessId]: params.addedProcessData.spanTable
  };
  const timeExtentsStartTime = performance.now();
  const timeExtents = computeArrowTraceTimeExtents(
    processes,
    spanTableMap,
    params.previousTraceGraphData.events
  );
  addTraceUpdateMetric(
    params.metrics,
    'timeExtentsDurationMs',
    performance.now() - timeExtentsStartTime
  );

  log.probe(1, 'MultiProcessTrace TraceGraphData append buildTraceGraphData start', {
    traceName: params.traceName,
    processCount: processes.length,
    rebasedCrossDependencyCount: rebasedCrossDependencies.length,
    addedSpanCount: params.addedProcessData.spanTable.numRows
  })();
  const traceGraphDataObjectStartTime = performance.now();
  const traceGraphData = buildTraceGraphData({
    name: params.traceName,
    processes,
    crossDependencies: rebasedCrossDependencies,
    spanTableMap,
    localDependencyTableMap: {
      ...params.previousTraceGraphData.localDependencyTableMap,
      [addedProcessId]: getLocalDependencyTable(
        params.addedProcessData,
        processIndex,
        spanRefLookup
      )
    },
    crossDependencyTable,
    spanSidecarMap: appendOptionalRecordEntry(
      params.previousTraceGraphData.spanSidecarMap,
      addedProcessId,
      normalizeSpanSidecarRowsForProcessIndex(
        params.addedProcessData.spanSidecarRows,
        processIndex,
        params.addedProcessData.refsAreFinal === true
      )
    ),
    spanSidecarTableMap: params.addedProcessData.spanSidecarTable
      ? {
          ...params.previousTraceGraphData.spanSidecarTableMap,
          [addedProcessId]: normalizeSpanSidecarTableForProcessIndex(
            params.addedProcessData.spanSidecarTable,
            processIndex,
            params.addedProcessData.refsAreFinal === true
          )
        }
      : params.previousTraceGraphData.spanSidecarTableMap,
    crossProcessEndpointsBySpanRef: mergeCrossProcessEndpointsBySpanRef(
      params.previousTraceGraphData.crossProcessEndpointsBySpanRef,
      buildCrossProcessEndpointsBySpanRef([params.addedProcessData])
    ),
    chunks: [
      ...params.previousTraceGraphData.chunks,
      buildArrowTraceChunkForProcessData(params.addedProcessData, processIndex, spanRefLookup)
    ],
    crossDependencyIdToIndexMap,
    events: params.previousTraceGraphData.events,
    timeExtents,
    dependencyMap
  });
  addTraceUpdateMetric(
    params.metrics,
    'traceGraphDataObjectDurationMs',
    performance.now() - traceGraphDataObjectStartTime
  );
  log.probe(1, 'MultiProcessTrace TraceGraphData append buildTraceGraphData done', {
    traceName: params.traceName,
    spanCount: traceGraphData.stats.spanCount,
    crossDependencyCount: traceGraphData.stats.crossDependencyCount,
    durationMs: performance.now() - traceGraphDataObjectStartTime
  })();
  return traceGraphData;
}

/**
 * Builds one cross-dependency table chunk for newly appended dependencies and returns a logical
 * table that reuses all previous record batches.
 */
function appendArrowTraceCrossDependencyTable(params: {
  /** Previously built logical cross-dependency table. */
  previousCrossDependencyTable: Readonly<ArrowTraceCrossDependencyTable>;
  /** Newly created dependencies after span-ref rebasing. */
  addedCrossDependencies: readonly TraceCrossProcessDependency[];
}): ArrowTraceCrossDependencyTable {
  const addedCrossDependencyTable = buildArrowTraceCrossDependencyTable(
    params.addedCrossDependencies
  );
  if (addedCrossDependencyTable.numRows === 0) {
    return params.previousCrossDependencyTable as ArrowTraceCrossDependencyTable;
  }
  if (params.previousCrossDependencyTable.numRows === 0) {
    return addedCrossDependencyTable;
  }
  return new arrow.Table(params.previousCrossDependencyTable.schema, [
    ...params.previousCrossDependencyTable.batches,
    ...addedCrossDependencyTable.batches
  ]) as ArrowTraceCrossDependencyTable;
}

function buildMultiProcessTraceProcessMetadata(
  processData: MultiProcessTraceProcessData,
  processIndex: number,
  spanRefLookup: SpanRefLookup
): ArrowTraceProcessMetadata {
  if (processData.localDependencyTable) {
    const processMetadata: ArrowTraceProcessMetadata = {...processData.process};
    delete processMetadata.localDependencies;
    return processMetadata;
  }
  return {
    ...processData.process,
    localDependencies: (processData.process.localDependencies ?? []).map(dependency =>
      rebaseLocalDependency(dependency, processIndex, spanRefLookup)
    )
  };
}

function rebaseLocalDependency(
  dependency: TraceLocalDependency,
  processIndex: number,
  spanRefLookup: SpanRefLookup
): TraceLocalDependency {
  const startSpanRef =
    rebaseSpanRefToProcessIndex(dependency.startSpanRef, processIndex) ??
    spanRefLookup.getForProcessIndex(processIndex, dependency.startSpanId);
  const endSpanRef =
    rebaseSpanRefToProcessIndex(dependency.endSpanRef, processIndex) ??
    spanRefLookup.getForProcessIndex(processIndex, dependency.endSpanId);

  return dependency.startSpanRef === startSpanRef && dependency.endSpanRef === endSpanRef
    ? dependency
    : {...dependency, startSpanRef, endSpanRef};
}

function rebaseCrossDependencies(
  crossDependencies: readonly TraceCrossProcessDependency[],
  spanRefLookup: SpanRefLookup
): TraceCrossProcessDependency[] {
  return crossDependencies.map(dependency => {
    const startSpanRef =
      dependency.startSpanRef ??
      spanRefLookup.getForRankNum(dependency.startRankNum, dependency.startSpanId);
    const endSpanRef =
      dependency.endSpanRef ??
      spanRefLookup.getForRankNum(dependency.endRankNum, dependency.endSpanId);
    return dependency.startSpanRef === startSpanRef && dependency.endSpanRef === endSpanRef
      ? dependency
      : {...dependency, startSpanRef, endSpanRef};
  });
}

function rebaseSpanRefToProcessIndex(
  spanRef: SpanRef | undefined,
  processIndex: number
): SpanRef | undefined {
  if (spanRef == null) {
    return undefined;
  }
  return encodeSpanRef(processIndex, getSpanRefRowIndex(spanRef));
}

/** Returns a lazy process/rank-scoped boundary resolver from external block id to SpanRef. */
function buildSpanRefLookupForProcesses(
  processDatas: readonly MultiProcessTraceProcessData[]
): SpanRefLookup {
  const spanRefLookupByProcessIndex = new Map<number, Readonly<Record<TraceSpanId, SpanRef>>>();
  const processIndexByRankNum = new Map<number, number>();
  return {
    getForProcessIndex: (processIndex, spanId) => {
      let processLookup = spanRefLookupByProcessIndex.get(processIndex);
      if (!processLookup) {
        const processData = processDatas[processIndex];
        if (!processData) {
          return undefined;
        }
        processLookup = buildSpanRefLookupForProcess(processData, processIndex);
        spanRefLookupByProcessIndex.set(processIndex, processLookup);
      }
      return processLookup[spanId];
    },
    getForRankNum: (rankNum, spanId) => {
      if (rankNum == null) {
        return undefined;
      }
      let processIndex = processIndexByRankNum.get(rankNum);
      if (processIndex == null) {
        processIndex = processDatas.findIndex(
          processData => processData.process.rankNum === rankNum
        );
        if (processIndex < 0) {
          return undefined;
        }
        processIndexByRankNum.set(rankNum, processIndex);
      }
      return (
        spanRefLookupByProcessIndex.get(processIndex)?.[spanId] ??
        buildSpanRefLookupForProcessIndex({
          spanId,
          processData: processDatas[processIndex]!,
          processIndex,
          spanRefLookupByProcessIndex
        })
      );
    }
  };
}

function buildSpanRefLookupForProcessIndex(params: {
  /** Block id to resolve. */
  spanId: TraceSpanId;
  /** Process data whose span table owns the block id. */
  processData: MultiProcessTraceProcessData;
  /** Current process index for SpanRef rebasing. */
  processIndex: number;
  /** Lazy process-local lookup cache. */
  spanRefLookupByProcessIndex: Map<number, Readonly<Record<TraceSpanId, SpanRef>>>;
}): SpanRef | undefined {
  const processLookup = buildSpanRefLookupForProcess(params.processData, params.processIndex);
  params.spanRefLookupByProcessIndex.set(params.processIndex, processLookup);
  return processLookup[params.spanId];
}

function buildSpanRefLookupForProcess(
  processData: MultiProcessTraceProcessData,
  processIndex: number
): Readonly<Record<TraceSpanId, SpanRef>> {
  const spanRefLookup = Object.create(null) as Record<TraceSpanId, SpanRef>;
  const spanIdColumn = processData.spanTable.getChild('span_id');
  if (!spanIdColumn) {
    return spanRefLookup;
  }
  for (let rowIndex = 0; rowIndex < processData.spanTable.numRows; rowIndex += 1) {
    const spanId = spanIdColumn.get(rowIndex);
    if (typeof spanId === 'string') {
      spanRefLookup[spanId as TraceSpanId] = encodeSpanRef(processIndex, rowIndex);
    }
  }
  return spanRefLookup;
}

function buildSpanTableMap(
  processDatas: readonly MultiProcessTraceProcessData[]
): Readonly<Record<TraceProcessId, ArrowTraceSpanTable>> {
  return Object.fromEntries(
    processDatas.map(processData => [
      processData.process.processId as TraceProcessId,
      processData.spanTable
    ])
  ) as Readonly<Record<TraceProcessId, ArrowTraceSpanTable>>;
}

/**
 * Builds storage chunks for loaded process data in encoded chunk order.
 */
function buildArrowTraceChunksForProcessDatas(
  processDatas: readonly MultiProcessTraceProcessData[],
  spanRefLookup: SpanRefLookup
): readonly ArrowTraceChunk[] {
  return processDatas.map((processData, chunkIndex) =>
    buildArrowTraceChunkForProcessData(processData, chunkIndex, spanRefLookup)
  );
}

/**
 * Builds one process-scoped storage chunk from generic loaded process data.
 */
function buildArrowTraceChunkForProcessData(
  processData: MultiProcessTraceProcessData,
  chunkIndex: number,
  spanRefLookup?: SpanRefLookup
): ArrowTraceChunk {
  const processId = processData.process.processId as TraceProcessId;
  return {
    chunkIndex,
    chunkRef: encodeChunkRef(chunkIndex),
    chunkKey: processData.chunkKey ?? processId,
    processRefs: [encodeProcessRef(chunkIndex)],
    processId,
    spanTable: processData.spanTable,
    localDependencyTable: getLocalDependencyTable(processData, chunkIndex, spanRefLookup),
    spanSidecarRows: normalizeSpanSidecarRowsForProcessIndex(
      processData.spanSidecarRows,
      chunkIndex,
      processData.refsAreFinal === true
    ),
    spanSidecarTable: normalizeSpanSidecarTableForProcessIndex(
      processData.spanSidecarTable,
      chunkIndex,
      processData.refsAreFinal === true
    )
  };
}

/**
 * Returns whether every previous process-scoped chunk can be reused for append assembly.
 */
function hasCompletePreviousChunkTables(traceGraphData: Readonly<TraceGraphData>): boolean {
  return traceGraphData.chunks.every(chunk => {
    if (chunk.processId == null) {
      return true;
    }
    return traceGraphData.localDependencyTableMap[chunk.processId] !== undefined;
  });
}

function buildSpanTableMapFromChunks(
  chunks: readonly ArrowTraceChunk[]
): Readonly<Record<TraceProcessId, ArrowTraceSpanTable>> {
  const spanTableMap = {} as Record<TraceProcessId, ArrowTraceSpanTable>;
  for (const chunk of chunks) {
    if (chunk.processId != null && spanTableMap[chunk.processId] == null) {
      spanTableMap[chunk.processId] = chunk.spanTable;
    }
  }
  return spanTableMap;
}

function buildLocalDependencyTableMap(
  processDatas: readonly MultiProcessTraceProcessData[],
  spanRefLookup: SpanRefLookup
): Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>> {
  return Object.fromEntries(
    processDatas.map((processData, processIndex) => [
      processData.process.processId as TraceProcessId,
      getLocalDependencyTable(processData, processIndex, spanRefLookup)
    ])
  ) as Readonly<Record<TraceProcessId, ArrowTraceLocalDependencyTable>>;
}

function getLocalDependencyTable(
  processData: MultiProcessTraceProcessData,
  processIndex?: number,
  spanRefLookup?: SpanRefLookup
): ArrowTraceLocalDependencyTable {
  if (processData.localDependencyTable) {
    if (processData.refsAreFinal) {
      return processData.localDependencyTable;
    }
    return normalizeLocalDependencyTableForProcessIndex(
      processData.localDependencyTable,
      processIndex ?? 0,
      spanRefLookup
    );
  }
  const localDependencies = processData.process.localDependencies ?? [];
  if (processIndex == null || !spanRefLookup) {
    return normalizeLocalDependencyTableForProcessIndex(
      buildArrowTraceLocalDependencyTable(localDependencies),
      0
    );
  }
  return normalizeLocalDependencyTableForProcessIndex(
    buildArrowTraceLocalDependencyTable(
      localDependencies.map(dependency =>
        rebaseLocalDependency(dependency, processIndex, spanRefLookup)
      )
    ),
    processIndex,
    spanRefLookup
  );
}

/**
 * Returns a local dependency table whose refs and endpoint span refs encode the final process index.
 */
function normalizeLocalDependencyTableForProcessIndex(
  table: ArrowTraceLocalDependencyTable,
  processIndex: number,
  spanRefLookup?: SpanRefLookup
): ArrowTraceLocalDependencyTable {
  if (processIndex === 0 && table.getChild('dependencyRef')) {
    return table;
  }

  const dependencyIdColumn = table.getChild('dependencyId');
  const startSpanRefColumn = table.getChild('startSpanRef');
  const startSpanIdColumn = table.getChild('startSpanId');
  const endSpanRefColumn = table.getChild('endSpanRef');
  const endSpanIdColumn = table.getChild('endSpanId');
  const waitModeColumn = table.getChild('waitMode');
  const bidirectionalColumn = table.getChild('bidirectional');
  const waitTimeMsColumn = table.getChild('waitTimeMs');
  const keywordsColumn = table.getChild('keywords');
  const hasParentKeywordColumn = table.getChild('hasParentKeyword');

  const dependencyRef: number[] = new Array(table.numRows);
  const dependencyId: string[] = new Array(table.numRows);
  const startSpanRef: Array<number | null> = new Array(table.numRows);
  const startSpanId: string[] = new Array(table.numRows);
  const endSpanRef: Array<number | null> = new Array(table.numRows);
  const endSpanId: string[] = new Array(table.numRows);
  const waitMode: string[] = new Array(table.numRows);
  const bidirectional: boolean[] = new Array(table.numRows);
  const waitTimeMs: number[] = new Array(table.numRows);
  const keywords: Array<readonly string[]> = new Array(table.numRows);
  const hasParentKeyword: boolean[] = new Array(table.numRows);

  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    dependencyRef[rowIndex] = encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, rowIndex));
    dependencyId[rowIndex] = readArrowString(dependencyIdColumn?.get(rowIndex));
    startSpanId[rowIndex] = readArrowString(startSpanIdColumn?.get(rowIndex));
    endSpanId[rowIndex] = readArrowString(endSpanIdColumn?.get(rowIndex));
    startSpanRef[rowIndex] = normalizeLocalDependencyEndpointSpanRef({
      spanId: startSpanId[rowIndex],
      processIndex,
      spanRef: normalizeArrowNumber(startSpanRefColumn?.get(rowIndex)),
      spanRefLookup
    });
    endSpanRef[rowIndex] = normalizeLocalDependencyEndpointSpanRef({
      spanId: endSpanId[rowIndex],
      processIndex,
      spanRef: normalizeArrowNumber(endSpanRefColumn?.get(rowIndex)),
      spanRefLookup
    });
    waitMode[rowIndex] = readArrowString(waitModeColumn?.get(rowIndex));
    bidirectional[rowIndex] = bidirectionalColumn?.get(rowIndex) === true;
    waitTimeMs[rowIndex] = normalizeArrowNumber(waitTimeMsColumn?.get(rowIndex)) ?? 0;
    keywords[rowIndex] = readArrowStringList(keywordsColumn?.get(rowIndex));
    hasParentKeyword[rowIndex] =
      hasParentKeywordColumn?.get(rowIndex) === true || keywords[rowIndex]!.includes('PARENT');
  }

  return buildArrowTraceLocalDependencyTableFromColumns({
    dependencyRef,
    dependencyId,
    startSpanRef,
    startSpanId,
    endSpanRef,
    endSpanId,
    waitMode,
    bidirectional,
    waitTimeMs,
    keywords,
    hasParentKeyword
  });
}

/**
 * Rebases one dependency endpoint span ref to the final process index, falling back to block lookup.
 */
function normalizeLocalDependencyEndpointSpanRef(params: {
  /** External block id for the endpoint row. */
  spanId: TraceSpanId | string;
  /** Final process index encoded into source refs. */
  processIndex: number;
  /** Existing endpoint span ref from the incoming local dependency table. */
  spanRef: number | null;
  /** Optional process-aware lookup for dependency tables missing span refs. */
  spanRefLookup?: SpanRefLookup;
}): number | null {
  return (
    rebaseSpanRefToProcessIndex(params.spanRef as SpanRef | undefined, params.processIndex) ??
    (params.spanId
      ? params.spanRefLookup?.getForProcessIndex(params.processIndex, params.spanId as TraceSpanId)
      : undefined) ??
    null
  );
}

/** Returns one Arrow scalar as a string, defaulting to an empty value for malformed rows. */
function readArrowString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Returns one Arrow scalar as a number, accepting bigint-backed uint values. */
function normalizeArrowNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isFinite(numberValue) ? numberValue : null;
}

/** Returns one Arrow list scalar as a string array without retaining Arrow row wrapper objects. */
function readArrowStringList(value: unknown): readonly string[] {
  if (value == null || typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    return [];
  }
  return Array.from(value as Iterable<unknown>).filter(
    (entry): entry is string => typeof entry === 'string'
  );
}

/** Rewrites span sidecar local dependency refs to the final process index. */
function normalizeSpanSidecarRowsForProcessIndex(
  rows: readonly TraceSpanArrowSidecarRow[] | undefined,
  processIndex: number,
  refsAreFinal = false
): readonly TraceSpanArrowSidecarRow[] | undefined {
  if (!rows) {
    return undefined;
  }
  if (refsAreFinal) {
    return rows;
  }

  return rows.map(row => ({
    ...row,
    incomingLocalDependencyRefs: normalizeSidecarLocalDependencyRefs(
      row.incomingLocalDependencyRefs ?? row.incomingLocalDependencyRowIndexes,
      processIndex
    ),
    outgoingLocalDependencyRefs: normalizeSidecarLocalDependencyRefs(
      row.outgoingLocalDependencyRefs ?? row.outgoingLocalDependencyRowIndexes,
      processIndex
    )
  }));
}

/** Rebuilds a span sidecar table with local dependency refs encoded for the final process index. */
function normalizeSpanSidecarTableForProcessIndex(
  table: ArrowTraceSpanSidecarTable | undefined,
  processIndex: number,
  refsAreFinal = false
): ArrowTraceSpanSidecarTable | undefined {
  if (!table) {
    return undefined;
  }
  if (refsAreFinal) {
    return table;
  }

  const incomingLocalDependencyRefColumn = table.getChild('incomingLocalDependencyRefs');
  const outgoingLocalDependencyRefColumn = table.getChild('outgoingLocalDependencyRefs');
  const incomingCrossDependencyRefColumn = table.getChild('incomingCrossDependencyRefs');
  const outgoingCrossDependencyRefColumn = table.getChild('outgoingCrossDependencyRefs');
  const crossDependencyRefColumn = table.getChild('crossDependencyRefs');
  const keywordColumn = table.getChild('keywords');
  const crossProcessEndpointIdColumn = table.getChild('crossProcessEndpointId');
  const userDataJsonColumn = table.getChild('userDataJson');

  const incomingLocalDependencyRefs: number[][] = [];
  const outgoingLocalDependencyRefs: number[][] = [];
  const incomingCrossDependencyRefs: number[][] = [];
  const outgoingCrossDependencyRefs: number[][] = [];
  const crossDependencyRefs: number[][] = [];
  const keywords: string[][] = [];
  const crossProcessEndpointId: Array<string | null> = [];
  const userDataJson: Array<string | null> = [];

  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    incomingLocalDependencyRefs.push(
      normalizeSidecarLocalDependencyRefs(
        readArrowNumberList(incomingLocalDependencyRefColumn?.get(rowIndex)),
        processIndex
      )
    );
    outgoingLocalDependencyRefs.push(
      normalizeSidecarLocalDependencyRefs(
        readArrowNumberList(outgoingLocalDependencyRefColumn?.get(rowIndex)),
        processIndex
      )
    );
    incomingCrossDependencyRefs.push(
      readArrowNumberList(incomingCrossDependencyRefColumn?.get(rowIndex))
    );
    outgoingCrossDependencyRefs.push(
      readArrowNumberList(outgoingCrossDependencyRefColumn?.get(rowIndex))
    );
    crossDependencyRefs.push(readArrowNumberList(crossDependencyRefColumn?.get(rowIndex)));
    keywords.push([...readArrowStringList(keywordColumn?.get(rowIndex))]);
    crossProcessEndpointId.push(
      readArrowString(crossProcessEndpointIdColumn?.get(rowIndex)) || null
    );
    userDataJson.push(readArrowString(userDataJsonColumn?.get(rowIndex)) || null);
  }

  return buildArrowTraceSpanSidecarTableFromColumns({
    incomingLocalDependencyRefs,
    outgoingLocalDependencyRefs,
    localDependencyRefs: incomingLocalDependencyRefs.map((incomingRefs, rowIndex) => [
      ...incomingRefs,
      ...outgoingLocalDependencyRefs[rowIndex]!
    ]),
    incomingCrossDependencyRefs,
    outgoingCrossDependencyRefs,
    crossDependencyRefs,
    keywords,
    crossProcessEndpointId,
    userDataJson
  });
}

/** Normalizes local dependency sidecar refs or row indexes into source local dependency refs. */
function normalizeSidecarLocalDependencyRefs(
  refsOrRowIndexes: readonly number[],
  processIndex: number
): number[] {
  return refsOrRowIndexes.flatMap(refOrRowIndex => {
    const rowIndex = isLocalDependencyRef(refOrRowIndex)
      ? getLocalDependencyRefRowIndex(refOrRowIndex)
      : refOrRowIndex;
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0) {
      return [];
    }
    return [encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))];
  });
}

/** Returns one Arrow list scalar as a number array without retaining Arrow row wrapper objects. */
function readArrowNumberList(value: unknown): number[] {
  if (value == null || typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    return [];
  }
  return Array.from(value as Iterable<unknown>).flatMap(entry => {
    const numberValue = normalizeArrowNumber(entry);
    return numberValue == null || !Number.isSafeInteger(numberValue) ? [] : [numberValue];
  });
}

function buildSpanSidecarMap(
  processDatas: readonly MultiProcessTraceProcessData[]
): Record<TraceProcessId, readonly TraceSpanArrowSidecarRow[]> | undefined {
  const entries = processDatas.flatMap((processData, processIndex) =>
    processData.spanSidecarRows
      ? [
          [
            processData.process.processId as TraceProcessId,
            normalizeSpanSidecarRowsForProcessIndex(
              processData.spanSidecarRows,
              processIndex,
              processData.refsAreFinal === true
            )
          ] as const
        ]
      : []
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as Record<TraceProcessId, readonly TraceSpanArrowSidecarRow[]>);
}

/**
 * Builds sparse unresolved cross-rank endpoint arrays keyed by exact owning span ref.
 */
function buildCrossProcessEndpointsBySpanRef(
  processDatas: readonly MultiProcessTraceProcessData[]
): TraceCrossProcessEndpointsBySpanRef | undefined {
  const endpointsBySpanRef = new Map<SpanRef, TraceCrossProcessEndpoint[]>();
  for (const processData of processDatas) {
    for (const endpoints of Object.values(processData.crossProcessEndpointsByEndpointId)) {
      for (const endpoint of endpoints) {
        if (endpoint.spanRef === undefined) {
          continue;
        }
        const existingEndpoints = endpointsBySpanRef.get(endpoint.spanRef);
        if (existingEndpoints) {
          existingEndpoints.push(endpoint);
        } else {
          endpointsBySpanRef.set(endpoint.spanRef, [endpoint]);
        }
      }
    }
  }
  return endpointsBySpanRef.size === 0 ? undefined : endpointsBySpanRef;
}

/**
 * Merges two sparse endpoint maps while preserving previous arrays for untouched span refs.
 */
function mergeCrossProcessEndpointsBySpanRef(
  previousEndpointsBySpanRef: TraceCrossProcessEndpointsBySpanRef | undefined,
  addedEndpointsBySpanRef: TraceCrossProcessEndpointsBySpanRef | undefined
): TraceCrossProcessEndpointsBySpanRef | undefined {
  if (!addedEndpointsBySpanRef) {
    return previousEndpointsBySpanRef;
  }
  if (!previousEndpointsBySpanRef) {
    return addedEndpointsBySpanRef;
  }
  const mergedEndpointsBySpanRef = new Map<SpanRef, readonly TraceCrossProcessEndpoint[]>(
    previousEndpointsBySpanRef
  );
  for (const [spanRef, addedEndpoints] of addedEndpointsBySpanRef) {
    const previousEndpoints = mergedEndpointsBySpanRef.get(spanRef);
    mergedEndpointsBySpanRef.set(
      spanRef,
      previousEndpoints ? [...previousEndpoints, ...addedEndpoints] : addedEndpoints
    );
  }
  return mergedEndpointsBySpanRef;
}

/**
 * Appends one optional record entry and preserves undefined when no entries exist.
 */
function appendOptionalRecordEntry<KeyT extends string, ValueT>(
  record: Readonly<Record<KeyT, ValueT>> | undefined,
  key: KeyT,
  value: ValueT | undefined
): Readonly<Record<KeyT, ValueT>> | undefined {
  if (value === undefined) {
    return record;
  }
  return {
    ...record,
    [key]: value
  } as Readonly<Record<KeyT, ValueT>>;
}

function buildSpanSidecarTableMap(
  processDatas: readonly MultiProcessTraceProcessData[]
): Readonly<Record<TraceProcessId, ArrowTraceSpanSidecarTable>> | undefined {
  const entries = processDatas.flatMap((processData, processIndex) =>
    processData.spanSidecarTable
      ? [
          [
            processData.process.processId as TraceProcessId,
            normalizeSpanSidecarTableForProcessIndex(
              processData.spanSidecarTable,
              processIndex,
              processData.refsAreFinal === true
            )
          ] as const
        ]
      : []
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as Readonly<Record<TraceProcessId, ArrowTraceSpanSidecarTable>>);
}

function buildDependencyIndex(
  processes: readonly ArrowTraceProcessMetadata[],
  crossDependencies: readonly TraceCrossProcessDependency[]
): Readonly<Record<TraceDependencyId, TraceDependency>> {
  const dependencyMap = Object.create(null) as Record<TraceDependencyId, TraceDependency>;
  for (const process of processes) {
    for (const dependency of process.localDependencies ?? []) {
      dependencyMap[dependency.dependencyId] = dependency;
    }
  }
  for (const dependency of crossDependencies) {
    dependencyMap[dependency.dependencyId] = dependency;
  }
  return dependencyMap;
}

/**
 * Extends the previous cross-dependency id index map with ids introduced by one process append.
 */
function buildCrossDependencyIdToIndexMapAfterProcessAppend(params: {
  addedCrossDependencies: readonly TraceCrossProcessDependency[];
  previousCrossDependencyCount: number;
  previousCrossDependencyIdToIndexMap: Readonly<Record<TraceDependencyId, number>>;
}): Readonly<Record<TraceDependencyId, number>> {
  const crossDependencyIdToIndexMap = {
    ...params.previousCrossDependencyIdToIndexMap
  } as Record<TraceDependencyId, number>;

  params.addedCrossDependencies.forEach((dependency, dependencyOffset) => {
    if (
      dependency.dependencyId != null &&
      crossDependencyIdToIndexMap[dependency.dependencyId] == null
    ) {
      crossDependencyIdToIndexMap[dependency.dependencyId] =
        params.previousCrossDependencyCount + dependencyOffset;
    }
  });

  return crossDependencyIdToIndexMap;
}

/**
 * Extends dependency indexes from the previous TraceGraphData with only the appended process and newly
 * created cross dependencies.
 */
function buildDependencyIndexAfterProcessAppend(params: {
  addedProcess: ArrowTraceProcessMetadata;
  addedCrossDependencies: readonly TraceCrossProcessDependency[];
  previousDependencyMap: Readonly<Record<TraceDependencyId, TraceDependency>>;
}): Readonly<Record<TraceDependencyId, TraceDependency>> {
  const dependencyMap = {...params.previousDependencyMap} as Record<
    TraceDependencyId,
    TraceDependency
  >;

  for (const dependency of params.addedProcess.localDependencies ?? []) {
    dependencyMap[dependency.dependencyId] = dependency;
  }
  for (const dependency of params.addedCrossDependencies) {
    dependencyMap[dependency.dependencyId] = dependency;
  }

  return dependencyMap;
}

function buildCrossDependencyStateForAdd<
  TProcessData extends MultiProcessTraceProcessData
>(params: {
  trace: Readonly<MultiProcessTrace<TProcessData>>;
  addedProcessData: TProcessData;
  metrics: MultiProcessTraceUpdateMetrics;
  options: MultiProcessTraceOptions;
}): {
  _crossProcessEndpointMap: MultiProcessTraceEndpointMap;
  _crossDependencyMap: Readonly<Record<string, TraceCrossProcessDependency>>;
  crossDependencies: readonly TraceCrossProcessDependency[];
  crossDependenciesNeedUpdate: boolean;
  addedEndpointGroupCount: number;
  addedEndpointCount: number;
  newCrossDependencyCount: number;
  newCrossDependencies: readonly TraceCrossProcessDependency[];
  crossDependencyBuildMode: 'incremental' | 'rebuild';
  matchedEndpointGroupCount: number;
  endpointPairCandidateCount: number;
} {
  const addedEndpointGroupCount = Object.keys(
    params.addedProcessData.crossProcessEndpointsByEndpointId
  ).length;
  log.probe(1, 'MultiProcessTrace cross-dependency setup endpoint count start', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    addedEndpointGroupCount,
    previousCrossDependencyCount: params.trace.crossDependencies.length,
    hasEndpointMap: params.trace._crossProcessEndpointMap !== undefined,
    hasCrossDependencyMap: params.trace._crossDependencyMap !== undefined
  })();
  const endpointCountStartTime = performance.now();
  const addedEndpointCount = countCrossProcessEndpointRows(
    params.addedProcessData.crossProcessEndpointsByEndpointId
  );
  log.probe(1, 'MultiProcessTrace cross-dependency setup endpoint count done', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    addedEndpointGroupCount,
    addedEndpointCount,
    durationMs: performance.now() - endpointCountStartTime
  })();
  if (
    !params.trace._crossProcessEndpointMap ||
    !params.trace._crossDependencyMap ||
    params.trace.crossDependenciesNeedUpdate
  ) {
    const endpointMergeStartTime = performance.now();
    const endpointMap = mergeCrossProcessEndpointMaps([
      ...getLoadedProcessDatas(params.trace),
      params.addedProcessData
    ]);
    params.metrics.endpointMergeDurationMs += performance.now() - endpointMergeStartTime;
    log.probe(1, 'MultiProcessTrace cross-dependency rebuild matching start', {
      loadedProcessCount: params.trace.loadedProcessKeys.length,
      endpointGroupCount: Object.keys(endpointMap).length,
      addedEndpointGroupCount,
      addedEndpointCount,
      previousCrossDependencyCount: params.trace.crossDependencies.length
    })();
    const dependencyMapStartTime = performance.now();
    const dependencyMap = buildCrossDependencyMapFromEndpointMap(endpointMap, params.options);
    params.metrics.dependencyMapDurationMs += performance.now() - dependencyMapStartTime;
    const crossDependencies = Object.values(dependencyMap);
    log.probe(1, 'MultiProcessTrace cross-dependency rebuild matching done', {
      crossDependencyCount: crossDependencies.length,
      durationMs: performance.now() - dependencyMapStartTime
    })();
    return {
      _crossProcessEndpointMap: endpointMap,
      _crossDependencyMap: dependencyMap,
      crossDependencies,
      crossDependenciesNeedUpdate: false,
      addedEndpointGroupCount,
      addedEndpointCount,
      newCrossDependencyCount: Math.max(
        0,
        crossDependencies.length - params.trace.crossDependencies.length
      ),
      newCrossDependencies: [],
      crossDependencyBuildMode: 'rebuild',
      matchedEndpointGroupCount: 0,
      endpointPairCandidateCount: countEndpointPairCandidates(endpointMap)
    };
  }

  log.probe(1, 'MultiProcessTrace cross-dependency incremental setup copy start', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    previousEndpointGroupCount: Object.keys(params.trace._crossProcessEndpointMap).length,
    previousCrossDependencyCount: params.trace.crossDependencies.length
  })();
  const endpointMapCopyStartTime = performance.now();
  const endpointMap: MultiProcessTraceEndpointMap = {...params.trace._crossProcessEndpointMap};
  params.metrics.endpointMapCopyDurationMs += performance.now() - endpointMapCopyStartTime;
  const dependencyMapCopyStartTime = performance.now();
  const dependencyMap: Record<string, TraceCrossProcessDependency> = {
    ...params.trace._crossDependencyMap
  };
  params.metrics.dependencyMapCopyDurationMs += performance.now() - dependencyMapCopyStartTime;
  log.probe(1, 'MultiProcessTrace cross-dependency incremental setup copy done', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    endpointMapCopyDurationMs: params.metrics.endpointMapCopyDurationMs,
    dependencyMapCopyDurationMs: params.metrics.dependencyMapCopyDurationMs
  })();
  const addedProcessIndex = params.trace.loadedProcessKeys.length;
  log.probe(1, 'MultiProcessTrace cross-dependency incremental endpoint rebase start', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    addedProcessIndex,
    addedEndpointGroupCount,
    addedEndpointCount
  })();
  const addedEndpointRebaseStartTime = performance.now();
  const addedEndpointMap =
    params.addedProcessData.refsAreFinal === true
      ? params.addedProcessData.crossProcessEndpointsByEndpointId
      : rebaseCrossProcessEndpointMap(
          params.addedProcessData.crossProcessEndpointsByEndpointId,
          addedProcessIndex
        );
  log.probe(1, 'MultiProcessTrace cross-dependency incremental endpoint rebase done', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    addedProcessIndex,
    addedEndpointGroupCount: Object.keys(addedEndpointMap).length,
    addedEndpointCount,
    durationMs: performance.now() - addedEndpointRebaseStartTime
  })();
  const newCrossDependencies: TraceCrossProcessDependency[] = [];
  let nextDependencyIndex = params.trace.crossDependencies.length;
  let matchedEndpointGroupCount = 0;
  let endpointPairCandidateCount = 0;

  log.probe(1, 'MultiProcessTrace cross-dependency incremental matching start', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    addedEndpointGroupCount,
    addedEndpointCount,
    previousEndpointGroupCount: Object.keys(endpointMap).length,
    previousCrossDependencyCount: params.trace.crossDependencies.length
  })();
  const endpointMatchingStartTime = performance.now();
  for (const [endpointId, addedEndpoints] of Object.entries(addedEndpointMap)) {
    const typedEndpointId = endpointId as TraceCrossProcessEndpointId;
    const existingEndpoints = endpointMap[typedEndpointId];
    if (existingEndpoints !== undefined) {
      matchedEndpointGroupCount += 1;
      endpointPairCandidateCount += existingEndpoints.length * addedEndpoints.length;
      nextDependencyIndex = addCrossDependenciesBetweenEndpointGroups({
        crossDependencyMap: dependencyMap,
        endpointId: typedEndpointId,
        leftEndpoints: existingEndpoints,
        newCrossDependencies,
        nextDependencyIndex,
        options: params.options,
        rightEndpoints: addedEndpoints
      });
      endpointMap[typedEndpointId] = [...existingEndpoints, ...addedEndpoints];
    } else {
      endpointMap[typedEndpointId] = [...addedEndpoints];
    }
    endpointPairCandidateCount += countEndpointPairCandidatesForEndpointGroup(addedEndpoints);
    nextDependencyIndex = addCrossDependenciesWithinEndpointGroup({
      crossDependencyMap: dependencyMap,
      endpointId: typedEndpointId,
      endpoints: addedEndpoints,
      newCrossDependencies,
      nextDependencyIndex,
      options: params.options
    });
  }
  params.metrics.endpointMatchingDurationMs += performance.now() - endpointMatchingStartTime;
  log.probe(1, 'MultiProcessTrace cross-dependency incremental matching done', {
    loadedProcessCount: params.trace.loadedProcessKeys.length,
    matchedEndpointGroupCount,
    endpointPairCandidateCount,
    newCrossDependencyCount: newCrossDependencies.length,
    nextCrossDependencyCount: params.trace.crossDependencies.length + newCrossDependencies.length,
    durationMs: performance.now() - endpointMatchingStartTime
  })();

  const crossDependencyArrayAppendStartTime = performance.now();
  const crossDependencies =
    newCrossDependencies.length === 0
      ? params.trace.crossDependencies
      : [...params.trace.crossDependencies, ...newCrossDependencies];
  params.metrics.crossDependencyArrayAppendDurationMs +=
    performance.now() - crossDependencyArrayAppendStartTime;
  return {
    _crossProcessEndpointMap: endpointMap,
    _crossDependencyMap: dependencyMap,
    crossDependencies,
    crossDependenciesNeedUpdate: false,
    addedEndpointGroupCount,
    addedEndpointCount,
    newCrossDependencyCount: newCrossDependencies.length,
    newCrossDependencies,
    crossDependencyBuildMode: 'incremental',
    matchedEndpointGroupCount,
    endpointPairCandidateCount
  };
}

/**
 * Counts endpoint rows across all endpoint ids in one endpoint map.
 */
function countCrossProcessEndpointRows(
  endpointMap: Readonly<Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>>
): number {
  return Object.values(endpointMap).reduce((sum, endpoints) => sum + endpoints.length, 0);
}

/**
 * Counts the number of pairwise endpoint comparisons required inside all endpoint groups.
 */
function countEndpointPairCandidates(endpointMap: MultiProcessTraceEndpointMap): number {
  return Object.values(endpointMap).reduce(
    (sum, endpoints) => sum + countEndpointPairCandidatesForEndpointGroup(endpoints),
    0
  );
}

/**
 * Counts pairwise endpoint comparisons required inside one endpoint group.
 */
function countEndpointPairCandidatesForEndpointGroup(
  endpoints: readonly TraceCrossProcessEndpoint[]
): number {
  return (endpoints.length * Math.max(0, endpoints.length - 1)) / 2;
}

function mergeCrossProcessEndpointMaps(
  processDatas: readonly MultiProcessTraceProcessData[]
): MultiProcessTraceEndpointMap {
  const endpointMap: Record<TraceCrossProcessEndpointId, TraceCrossProcessEndpoint[]> = {};
  for (const [processIndex, processData] of processDatas.entries()) {
    for (const [endpointId, endpoints] of Object.entries(
      processData.crossProcessEndpointsByEndpointId
    )) {
      const typedEndpointId = endpointId as TraceCrossProcessEndpointId;
      endpointMap[typedEndpointId] ??= [];
      endpointMap[typedEndpointId].push(
        ...(processData.refsAreFinal === true
          ? endpoints
          : endpoints.map(endpoint => rebaseCrossProcessEndpoint(endpoint, processIndex)))
      );
    }
  }
  return endpointMap;
}

function rebaseCrossProcessEndpointMap(
  endpointMap: Readonly<Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>>,
  processIndex: number
): MultiProcessTraceEndpointMap {
  return Object.fromEntries(
    Object.entries(endpointMap).map(([endpointId, endpoints]) => [
      endpointId,
      endpoints.map(endpoint => rebaseCrossProcessEndpoint(endpoint, processIndex))
    ])
  ) as MultiProcessTraceEndpointMap;
}

function rebaseCrossProcessEndpoint(
  endpoint: TraceCrossProcessEndpoint,
  processIndex: number
): TraceCrossProcessEndpoint {
  const spanRef = rebaseSpanRefToProcessIndex(endpoint.spanRef, processIndex);
  return endpoint.spanRef === spanRef ? endpoint : {...endpoint, spanRef};
}

function buildCrossDependencyMapFromEndpointMap(
  endpointMap: MultiProcessTraceEndpointMap,
  options: MultiProcessTraceOptions
): Record<string, TraceCrossProcessDependency> {
  const dependencyMap: Record<string, TraceCrossProcessDependency> = {};
  let nextDependencyIndex = 0;
  for (const [endpointId, endpoints] of Object.entries(endpointMap)) {
    nextDependencyIndex = addCrossDependenciesWithinEndpointGroup({
      crossDependencyMap: dependencyMap,
      endpointId: endpointId as TraceCrossProcessEndpointId,
      endpoints,
      nextDependencyIndex,
      options
    });
  }
  return dependencyMap;
}

function addCrossDependenciesBetweenEndpointGroups(params: {
  leftEndpoints: readonly TraceCrossProcessEndpoint[];
  rightEndpoints: readonly TraceCrossProcessEndpoint[];
  crossDependencyMap: Record<string, TraceCrossProcessDependency>;
  newCrossDependencies?: TraceCrossProcessDependency[];
  endpointId: TraceCrossProcessEndpointId;
  nextDependencyIndex: number;
  options: MultiProcessTraceOptions;
}): number {
  let nextDependencyIndex = params.nextDependencyIndex;
  const leftEndpointIndex = buildCrossDependencyEndpointPairIndex(params.leftEndpoints);
  for (const rightEndpoint of params.rightEndpoints) {
    nextDependencyIndex = addCrossDependenciesForEndpointAgainstIndex({
      crossDependencyMap: params.crossDependencyMap,
      endpoint: rightEndpoint,
      endpointId: params.endpointId,
      endpointIndex: leftEndpointIndex,
      newCrossDependencies: params.newCrossDependencies,
      nextDependencyIndex,
      options: params.options
    });
  }
  return nextDependencyIndex;
}

function addCrossDependenciesWithinEndpointGroup(params: {
  endpoints: readonly TraceCrossProcessEndpoint[];
  crossDependencyMap: Record<string, TraceCrossProcessDependency>;
  newCrossDependencies?: TraceCrossProcessDependency[];
  endpointId: TraceCrossProcessEndpointId;
  nextDependencyIndex: number;
  options: MultiProcessTraceOptions;
}): number {
  let nextDependencyIndex = params.nextDependencyIndex;
  const endpointIndex = createCrossDependencyEndpointPairIndex();
  for (const endpoint of params.endpoints) {
    if (endpoint) {
      nextDependencyIndex = addCrossDependenciesForEndpointAgainstIndex({
        crossDependencyMap: params.crossDependencyMap,
        endpoint,
        endpointId: params.endpointId,
        endpointIndex,
        newCrossDependencies: params.newCrossDependencies,
        nextDependencyIndex,
        options: params.options
      });
      addEndpointToCrossDependencyPairIndex(endpointIndex, endpoint);
    }
  }
  return nextDependencyIndex;
}

/**
 * Adds dependencies between one endpoint and the indexed endpoints that can actually satisfy its
 * requested remote rank.
 */
function addCrossDependenciesForEndpointAgainstIndex(params: {
  /** Mutable dependency map keyed by dependency id plus endpoint id. */
  crossDependencyMap: Record<string, TraceCrossProcessDependency>;
  /** Newly discovered endpoint to resolve against the existing index. */
  endpoint: TraceCrossProcessEndpoint;
  /** Shared endpoint group id. */
  endpointId: TraceCrossProcessEndpointId;
  /** Existing endpoints for the same endpoint id. */
  endpointIndex: CrossDependencyEndpointPairIndex;
  /** Optional append-only list of dependencies created during an incremental update. */
  newCrossDependencies?: TraceCrossProcessDependency[];
  /** Next visible dependency index to assign. */
  nextDependencyIndex: number;
  /** Assembly options, including app-specific dependency id construction. */
  options: MultiProcessTraceOptions;
}): number {
  let nextDependencyIndex = params.nextDependencyIndex;
  for (const candidateEndpoint of getCrossDependencyEndpointPairCandidates(
    params.endpointIndex,
    params.endpoint
  )) {
    nextDependencyIndex = addCrossDependencyForEndpointPair({
      crossDependencyMap: params.crossDependencyMap,
      endpointId: params.endpointId,
      leftEndpoint: candidateEndpoint,
      newCrossDependencies: params.newCrossDependencies,
      nextDependencyIndex,
      options: params.options,
      rightEndpoint: params.endpoint
    });
  }
  return nextDependencyIndex;
}

/**
 * Builds a target-aware lookup for endpoints inside one comm-group endpoint id.
 */
function buildCrossDependencyEndpointPairIndex(
  endpoints: readonly TraceCrossProcessEndpoint[]
): CrossDependencyEndpointPairIndex {
  const endpointIndex = createCrossDependencyEndpointPairIndex();
  for (const endpoint of endpoints) {
    addEndpointToCrossDependencyPairIndex(endpointIndex, endpoint);
  }
  return endpointIndex;
}

/**
 * Creates an empty target-aware endpoint lookup.
 */
function createCrossDependencyEndpointPairIndex(): CrossDependencyEndpointPairIndex {
  return {
    endpointsByRankPair: new Map(),
    targetedEndpointsByEndRankNum: new Map(),
    wildcardEndpointsByStartRankNum: new Map()
  };
}

/**
 * Adds one endpoint to the target-aware lookup used by cross-rank dependency resolution.
 */
function addEndpointToCrossDependencyPairIndex(
  endpointIndex: CrossDependencyEndpointPairIndex,
  endpoint: TraceCrossProcessEndpoint
): void {
  if (isTargetedCrossDependencyEndpoint(endpoint)) {
    appendMapArray(
      endpointIndex.endpointsByRankPair,
      getCrossDependencyEndpointRankPairKey(endpoint.startRankNum, endpoint.endRankNum),
      endpoint
    );
    appendMapArray(endpointIndex.targetedEndpointsByEndRankNum, endpoint.endRankNum, endpoint);
    return;
  }
  appendMapArray(endpointIndex.wildcardEndpointsByStartRankNum, endpoint.startRankNum, endpoint);
}

/**
 * Returns the indexed endpoints that can pair with the requested endpoint.
 */
function getCrossDependencyEndpointPairCandidates(
  endpointIndex: CrossDependencyEndpointPairIndex,
  endpoint: TraceCrossProcessEndpoint
): readonly TraceCrossProcessEndpoint[] {
  if (isTargetedCrossDependencyEndpoint(endpoint)) {
    return [
      ...(endpointIndex.endpointsByRankPair.get(
        getCrossDependencyEndpointRankPairKey(endpoint.endRankNum, endpoint.startRankNum)
      ) ?? []),
      ...(endpointIndex.wildcardEndpointsByStartRankNum.get(endpoint.endRankNum) ?? [])
    ];
  }

  const candidates: TraceCrossProcessEndpoint[] = [
    ...(endpointIndex.targetedEndpointsByEndRankNum.get(endpoint.startRankNum) ?? [])
  ];
  for (const [startRankNum, endpoints] of endpointIndex.wildcardEndpointsByStartRankNum) {
    if (startRankNum !== endpoint.startRankNum) {
      candidates.push(...endpoints);
    }
  }
  return candidates;
}

/**
 * Returns whether an endpoint identifies the remote rank it expects to pair with.
 */
function isTargetedCrossDependencyEndpoint(endpoint: TraceCrossProcessEndpoint): boolean {
  return endpoint.endRankNum !== endpoint.startRankNum;
}

/**
 * Builds the rank-pair key used by the target-aware endpoint lookup.
 */
function getCrossDependencyEndpointRankPairKey(startRankNum: number, endRankNum: number): string {
  return `${startRankNum}->${endRankNum}`;
}

/**
 * Appends a value to a mutable array-valued map.
 */
function appendMapArray<KeyT, ValueT>(map: Map<KeyT, ValueT[]>, key: KeyT, value: ValueT): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function addCrossDependencyForEndpointPair(params: {
  leftEndpoint: TraceCrossProcessEndpoint;
  rightEndpoint: TraceCrossProcessEndpoint;
  crossDependencyMap: Record<string, TraceCrossProcessDependency>;
  newCrossDependencies?: TraceCrossProcessDependency[];
  endpointId: TraceCrossProcessEndpointId;
  nextDependencyIndex: number;
  options: MultiProcessTraceOptions;
}): number {
  const {leftEndpoint, rightEndpoint} = params;
  if (
    leftEndpoint.spanId === rightEndpoint.spanId ||
    leftEndpoint.startRankNum === rightEndpoint.startRankNum
  ) {
    return params.nextDependencyIndex;
  }
  const dependencyId = createCrossDependencyId(leftEndpoint, rightEndpoint, params.options);
  const dedupeKey = `${dependencyId}-${params.endpointId}`;
  if (params.crossDependencyMap[dedupeKey]) {
    return params.nextDependencyIndex;
  }
  const dependency = createCrossDependencyFromEndpoints({
    dependencyId,
    dependencyRef: encodeVisibleCrossDependencyRef(params.nextDependencyIndex),
    endpointId: params.endpointId,
    leftEndpoint,
    rightEndpoint
  });
  params.crossDependencyMap[dedupeKey] = dependency;
  params.newCrossDependencies?.push(dependency);
  return params.nextDependencyIndex + 1;
}

function createCrossDependencyFromEndpoints(params: {
  leftEndpoint: TraceCrossProcessEndpoint;
  rightEndpoint: TraceCrossProcessEndpoint;
  endpointId: TraceCrossProcessEndpointId;
  dependencyId: TraceDependencyId;
  dependencyRef: TraceCrossProcessDependency['dependencyRef'];
}): TraceCrossProcessDependency {
  const {leftEndpoint, rightEndpoint} = params;
  return {
    type: 'trace-cross-process-dependency',
    dependencyRef: params.dependencyRef,
    dependencyId: params.dependencyId,
    endpointId: params.endpointId,
    startRankNum: leftEndpoint.startRankNum,
    endRankNum: rightEndpoint.startRankNum,
    startSpanId: leftEndpoint.spanId,
    endSpanId: rightEndpoint.spanId,
    startSpanRef: leftEndpoint.spanRef,
    endSpanRef: rightEndpoint.spanRef,
    bidirectional: true,
    waitMode: 'end-to-end',
    keywords: new Set(),
    topology: params.endpointId,
    waitTimeMs: leftEndpoint.waitTimeMs,
    waiting: leftEndpoint.waiting,
    waitNotFinished: leftEndpoint.waitNotFinished
  };
}

function createCrossDependencyId(
  leftEndpoint: TraceCrossProcessEndpoint,
  rightEndpoint: TraceCrossProcessEndpoint,
  options: MultiProcessTraceOptions
): TraceDependencyId {
  if (leftEndpoint.spanRef !== undefined && rightEndpoint.spanRef !== undefined) {
    const [startSpanRef, endSpanRef] =
      leftEndpoint.spanRef <= rightEndpoint.spanRef
        ? [leftEndpoint.spanRef, rightEndpoint.spanRef]
        : [rightEndpoint.spanRef, leftEndpoint.spanRef];
    const dependencyId = options.createDependencyIdFromSpanRefs?.(
      startSpanRef,
      endSpanRef,
      'bidirectional'
    );
    if (dependencyId) {
      return dependencyId;
    }
  }

  return (
    options.createDependencyId?.(leftEndpoint.spanId, rightEndpoint.spanId, 'bidirectional') ??
    (`${leftEndpoint.spanId}->${rightEndpoint.spanId}:bidirectional` as TraceDependencyId)
  );
}
