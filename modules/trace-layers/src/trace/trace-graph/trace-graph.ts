import {getHeapUsageProbeFields, log} from '../log';
import {
  getActiveTraceGraphSpanDisplaySource,
  getActiveTraceGraphSpanGeometrySource,
  getActiveTraceGraphSpanRenderSource,
  getArrowTraceSpanField,
  getTraceGraphSpanDisplaySource,
  getTraceGraphSpanRefProcessId,
  getTraceGraphSpanRenderSource,
  getTraceGraphSpanTableRowIndex,
  getUniqueTraceGraphSpanRef,
  iterateTraceGraphProcessSpanRefs
} from '../trace-graph-accessors';
import {
  buildTraceCardDependency,
  buildTraceCardSpan,
  getTraceSpanCardModel,
  getTraceSpanDescendants,
  getTraceSpanEndpointsWithDependencies,
  getTraceSpanIncomingDependencyEntries,
  getTraceSpanOutgoingDependencyEntries,
  getTraceSpanParentChainEntries
} from './build-trace-span-card-data';
import {buildTraceChunkRegistry} from './trace-chunk-registry';
import {getArrowTraceSpanLaneValue} from './trace-graph-arrow-fields';
import {
  buildTraceGraphUnfilteredLocalDependencySourceByRef,
  getTraceGraphCrossDependencyEndpointId,
  getTraceGraphCrossDependencyEndRankNum,
  getTraceGraphCrossDependencyStartRankNum,
  getTraceGraphCrossDependencyTopology,
  getTraceGraphCrossDependencyWaiting,
  getTraceGraphCrossDependencyWaitNotFinished,
  getTraceGraphDependencyBidirectional,
  getTraceGraphDependencyEndBlockId,
  getTraceGraphDependencyEndSpan,
  getTraceGraphDependencyHasKeyword,
  getTraceGraphDependencyId,
  getTraceGraphDependencyIsParent,
  getTraceGraphDependencyKeywords,
  getTraceGraphDependencyStartBlockId,
  getTraceGraphDependencyStartSpan,
  getTraceGraphDependencyUserData,
  getTraceGraphDependencyWaitMode,
  getTraceGraphDependencyWaitTimeMs,
  getTraceGraphUnfilteredVisibleLocalDependencySourceRefByRef,
  getTraceGraphVisibleDependencyBidirectional,
  getTraceGraphVisibleDependencyEndBlockId,
  getTraceGraphVisibleDependencyEndSpan,
  getTraceGraphVisibleDependencyHasKeyword,
  getTraceGraphVisibleDependencyIsParent,
  getTraceGraphVisibleDependencyKeywords,
  getTraceGraphVisibleDependencyStartBlockId,
  getTraceGraphVisibleDependencyStartSpan,
  getTraceGraphVisibleDependencyWaitMode,
  getTraceGraphVisibleDependencyWaitTimeMs
} from './trace-graph-dependency-accessors';
import {
  buildDependencyChainFromSourceAdapter,
  buildParentDependencyChainBySpanRef,
  buildSourceTraceGraphProjection,
  buildTraceGraphProjection,
  buildTraceGraphState,
  buildVisibleDependencyChainFromProjection,
  buildVisibleIndex,
  getDirectParentSpanRefMap,
  getUsableTraceGraphPreparedState,
  isValidSourceSpanRef
} from './trace-graph-internal-helpers';
import {
  buildFilteredSpanCountByThreadRefBySpanScan,
  buildGraphFilteredSpanCountByThreadRef,
  EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REFS,
  isLegacyVisibleDependencyRef,
  normalizeArrowRefNumber,
  normalizeDirectionalCrossDependencyRef,
  normalizeDirectionalLocalDependencyRef,
  normalizeOverlappingParentSpanFilter,
  normalizeSimilarDurationChainSpanFilter,
  TRACE_GRAPH_PARENT_KEYWORD as PARENT_KEYWORD,
  readArrowNumberListColumn
} from './trace-graph-runtime-helpers';
import {
  getFirstVisibleSearchDescendantSpanRef,
  searchTraceGraphBlockRecordsWithOptions
} from './trace-graph-search-records';
import {
  buildTraceSpanDependencySelection,
  getProcessScopedSpanRefsByProcessId,
  getSelectedCardSpanRef,
  getTraceSpanChildDependenciesFromTraceGraph,
  getVisiblePathBlockSources,
  getVisiblePathDependencySources,
  getVisibleSelectedCrossDependencySource,
  getVisibleSelectedLocalDependencySource,
  isVisibleSpanRef,
  materializeTraceSpanBySpanRef
} from './trace-graph-selection-utils';
import {
  getTraceGraphSpanFilterReason,
  getTraceGraphSpanRefFilterMask
} from './trace-graph-span-filter-reason';
import {
  buildCompiledTraceSpanFilterPlan,
  normalizeTraceSpanFilters
} from './trace-graph-span-filters';
import {searchLoadedChunkSpanRecords} from './trace-graph-span-search';
import {TRACE_SPAN_FILTER_MASK_NONE} from './trace-graph-types';
import {
  decodeTraceRef,
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef,
  getCrossDependencyRefIndex,
  getLocalDependencyRefProcessIndex,
  getLocalDependencyRefRowIndex,
  getVisibleCrossDependencyRefIndex,
  getVisibleLocalDependencyRefIndex,
  isCrossDependencyRef,
  isLocalDependencyRef,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from './trace-id-encoder';
import {buildTraceRuntimeEntityRefs} from './trace-runtime-entity-refs';

import type {
  ArrowTraceChunk,
  ArrowTraceCrossDependencyTable,
  ArrowTraceEventTable,
  ArrowTraceLocalDependencyTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanSidecarTableMap,
  TraceCrossProcessEndpointsBySpanRef,
  TraceGraphData,
  TraceProcessSpanRefTable,
  TraceSpanArrowSidecarMap,
  TraceSpanCrossDependencyRefMap
} from '../ingestion/arrow-trace';
import type {
  TraceCounterSource,
  TraceCrossDependencyRenderSource,
  TraceCrossDependencySource,
  TraceDependencyRenderSource,
  TraceDependencyRenderSourceCommon,
  TraceDependencySource,
  TraceEventSource,
  TraceInstantSource,
  TraceLocalDependencyRenderSource,
  TraceLocalDependencySource,
  TraceProcessSource,
  TraceRenderSpan,
  TraceSpanDisplaySource,
  TraceSpanGeometrySource,
  TraceThreadSource
} from '../trace-graph-accessors';
import type {TraceLayoutLaneDependencySource} from '../trace-layout/trace-geometry-layout-common';
import type {
  TraceCardSpan,
  TraceSpanCardChildDependency,
  TraceSpanCardDependencyEntry,
  TraceSpanCardDescendantResult,
  TraceSpanCardEndpointDependencyEntry,
  TraceSpanCardModel,
  TraceSpanCardParentChainEntry
} from './build-trace-span-card-data';
import type {
  TraceChunkBackedRef,
  TraceChunkRegistry,
  TraceProcessOwnedRef,
  TraceRuntimeChunk,
  TraceThreadOwnedRef
} from './trace-chunk-registry';
import type {TraceGraphRuntimeSource} from './trace-graph-runtime-source';
import type {CompiledTraceSpanFilterPlan} from './trace-graph-span-filters';
import type {TraceGraphStats} from './trace-graph-stats';
import type {
  TraceGraphDependencyLookupOptions,
  TraceGraphDescendantOptions,
  TraceGraphEntitySourceCache,
  TraceGraphFilteredSpanCountsByFilter,
  TraceGraphFilterOptions,
  TraceGraphOverlappingParentSpanFilter,
  TraceGraphPathBlockSource,
  TraceGraphPathDependencySource,
  TraceGraphProjection,
  TraceGraphSelectedCrossDependencySource,
  TraceGraphSelectedLocalDependencySource,
  TraceGraphSimilarDurationChainSpanFilter,
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanFilterReason,
  TraceGraphSpanFilterReasonInput,
  TraceGraphSpanFilterStore,
  TraceGraphSpanSearchRecord,
  TraceGraphVisibleDependencyOverride,
  TraceGraphVisibleIndex,
  TraceGraphVisibleLaneLayoutInfo,
  TraceGraphVisibleProcessCacheEntry,
  TraceGraphVisibleRuntimeCache,
  TraceGraphVisibleSpanSearchRecord,
  TraceSelectedDependencyDirection,
  TraceSpanDependencySelection,
  TraceSpanFilterMask
} from './trace-graph-types';
import type {
  CrossDependencyRef,
  DecodedTraceRef,
  LocalDependencyRef,
  ProcessRef,
  ThreadRef,
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleDependencyRef,
  VisibleLocalDependencyRef
} from './trace-id-encoder';
import type {TraceRuntimeEntityRefs} from './trace-runtime-entity-refs';
import type {
  SpanRef,
  TraceCounter,
  TraceCounterId,
  TraceCrossProcessDependency,
  TraceDependency,
  TraceDependencyId,
  TraceEvent,
  TraceEventId,
  TraceInstant,
  TraceInstantId,
  TracePath,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceSpanLayoutMode,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from './trace-types';

export type {
  TraceGraphDependencyLookupOptions,
  TraceGraphDescendantEntry,
  TraceGraphDescendantOptions,
  TraceGraphDescendantResult,
  TraceGraphEntitySourceCache,
  TraceGraphFilterOptions,
  TraceGraphFilteredSpanCountsByFilter,
  TraceGraphOverlappingParentSpanFilter,
  TraceGraphPathBlockSource,
  TraceGraphPathCrossDependencySource,
  TraceGraphPathDependencySource,
  TraceGraphPathLocalDependencySource,
  TraceGraphPreparedState,
  TraceGraphProjection,
  TraceGraphSelectedCrossDependencySource,
  TraceGraphSelectedLocalDependencySource,
  TraceGraphSimilarDurationChainSpanFilter,
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanFilterReason,
  TraceGraphSpanFilterReasonInput,
  TraceGraphSpanFilterState,
  TraceGraphSpanFilterStore,
  TraceGraphSpanSearchRecord,
  TraceGraphSpanStoreAvailability,
  TraceSpanFilterMask,
  TraceGraphVisibleSpanSearchRecord,
  TraceGraphVisibleIndex,
  TraceGraphVisibleLaneLayoutInfo,
  TraceGraphVisibleProcessCacheEntry,
  TraceGraphVisibleRuntimeCache,
  TraceSelectedDependencyDirection,
  TraceSpanDependencySelection
} from './trace-graph-types';
export {
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_SOURCE,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY,
  hasTraceSpanNameFilter,
  hasTraceSpanRegexpFilter,
  hasTraceSpanSourceFilter,
  hasTraceSpanTopologyFilter
} from './trace-graph-types';

export type {
  TraceSpanCardDependencyEntry,
  TraceSpanCardChildDependency,
  TraceSpanCardDescendantEntry,
  TraceSpanCardDescendantResult,
  TraceSpanCardEndpointDependencyEntry,
  TraceSpanCardModel,
  TraceSpanCardParentChainEntry,
  TraceCardSpan,
  TraceCardDependency,
  TraceCardCrossDependency
} from './build-trace-span-card-data';

let nextTraceGraphFilterStateRevision = 1;

/** Direction of a single-span dependency-neighborhood read. */
export type TraceSpanDependencyDirection = 'incoming' | 'outgoing';

/** Ref-native dependency lists attached to one span in a single direction. */
export type TraceSpanDirectionalDependencyRefs = {
  /** Process-local source dependency refs in dependency-table row order. */
  readonly localDependencyRefs: readonly LocalDependencyRef[];
  /** Graph-global cross-process dependency refs in dependency-table row order. */
  readonly crossDependencyRefs: readonly CrossDependencyRef[];
};

/** Bounded dependency refs plus the uncapped count for one directional span relation. */
export type TraceDirectionalDependencyRefSlice<
  TDependencyRef extends TraceDependencyRef | VisibleDependencyRef
> = {
  /** Dependency refs retained under the requested cap. */
  readonly dependencyRefs: readonly TDependencyRef[];
  /** Total directional dependency ref count before the cap. */
  readonly totalCount: number;
  /** Whether the returned refs omit additional directional dependencies. */
  readonly truncated: boolean;
};

type TraceSpanDirectionalDependencyRefBuckets = TraceSpanDirectionalDependencyRefs & {
  /** Total directional dependency ref count before the cap. */
  readonly totalCount: number;
  /** Whether the returned refs omit additional directional dependencies. */
  readonly truncated: boolean;
};

/**
 * Runtime trace-graph view over graph-owned Arrow tables and indexes.
 */
export class TraceGraph implements TraceGraphData {
  /** Human-friendly graph name. */
  readonly name: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  readonly spanLayout: TraceSpanLayoutMode;
  /** Metadata-only process records in graph order. */
  readonly processes: Readonly<ArrowTraceProcessMetadata[]>;
  /** Cross-process dependencies. */
  readonly crossDependencies: Readonly<TraceCrossProcessDependency[]>;
  /** Minimum timestamp. */
  readonly minTimeMs: number;
  /** Maximum timestamp. */
  readonly maxTimeMs: number;
  /** Raw ingestion thread metadata keyed by stream id. */
  readonly threadMap: Record<TraceThreadId, TraceThread>;
  /** Instant events keyed by owning thread. */
  readonly threadInstantMap: Record<TraceThreadId, TraceInstant[]>;
  /** Counter samples keyed by owning thread. */
  readonly threadCounterMap: Record<TraceThreadId, TraceCounter[]>;
  /** Instant metadata keyed by instant id. */
  readonly instantMap: Readonly<Record<TraceInstantId, TraceInstant>>;
  /** Counter metadata keyed by counter id. */
  readonly counterMap: Readonly<Record<TraceCounterId, TraceCounter>>;
  /** Counter min/max extents keyed by stream id. */
  readonly counterExtents: Readonly<Record<TraceThreadId, {min: number; max: number}>>;
  /** Canonical graph-global Arrow event table. */
  readonly events: Readonly<ArrowTraceEventTable>;
  /** Event metadata keyed by event id. */
  readonly eventMap: Readonly<Record<TraceEventId, TraceEvent>>;
  /** Process-local SpanRef/layout index tables keyed by process id. */
  readonly processSpanTableMap: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Process-local Arrow dependency tables keyed by process id. */
  readonly localDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceLocalDependencyTable>
  >;
  /** Graph-global Arrow cross-process dependency table. */
  readonly crossDependencyTable: Readonly<ArrowTraceCrossDependencyTable>;
  /** Optional row-aligned compatibility payloads keyed by process id. */
  readonly spanSidecarMap?: TraceSpanArrowSidecarMap;
  /** Optional row-aligned Arrow sidecar tables keyed by process id. */
  readonly spanSidecarTableMap?: ArrowTraceSpanSidecarTableMap;
  /** Optional sparse unresolved cross-rank endpoints keyed by exact span ref. */
  readonly crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
  /** Optional sparse directional cross-dependency refs keyed by exact span ref. */
  readonly spanCrossDependencyRefMap?: TraceSpanCrossDependencyRefMap;
  /** Loaded row-backed storage chunks. */
  readonly chunks: readonly ArrowTraceChunk[];
  /** Active chunk span refs. */
  readonly spanRefs?: readonly SpanRef[];
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: ReadonlyArray<TraceProcessId>;
  /** Stable map from cross-dependency ids to deterministic packed dependency indexes. */
  readonly crossDependencyIdToIndexMap: Readonly<Record<TraceDependencyId, number>>;
  /** Raw ingestion dependency metadata keyed by dependency id. */
  readonly dependencyMap: Readonly<Record<TraceDependencyId, TraceDependency>>;
  /** Aggregated graph-wide counts for the runtime tables. */
  readonly stats: TraceGraphStats;
  /** Stores filtered span refs in source row order for fast visible-index reuse. */
  readonly filteredSpanRefs: ReadonlySet<SpanRef>;
  /** Final filtered-span attribution counts grouped by the first filter stage that removed them. */
  readonly filteredSpanCountsByFilter: TraceGraphFilteredSpanCountsByFilter;
  /** Construction-scoped revision for graph-owned filter options. */
  readonly graphFilterStateRevision: number;

  private readonly spanFilters: readonly string[];
  /** Compiled text filters. */
  private readonly spanFilterPlan: CompiledTraceSpanFilterPlan;
  /** Topology filter that removes eligible overlapping parent-child spans from visible views. */
  private readonly overlappingParentSpanFilter: TraceGraphOverlappingParentSpanFilter | null;
  /** Topology filter that collapses eligible similar-duration parent chains from visible views. */
  private readonly similarDurationChainSpanFilter: TraceGraphSimilarDurationChainSpanFilter | null;
  /** Store lookup for loaded and outside refs. */
  private readonly traceStore: TraceGraphSpanFilterStore;
  private readonly runtimeEntityRefs: TraceRuntimeEntityRefs;
  private readonly chunkRegistry: TraceChunkRegistry;
  private filteredSpanCountByThreadRefCache?: ReadonlyMap<ThreadRef, number>;
  private sourceTraceGraphProjectionCache?: TraceGraphProjection;
  private traceGraphProjectionCache?: TraceGraphProjection;
  private visibleIndexCache?: TraceGraphVisibleIndex;
  private visibleRuntimeCache?: TraceGraphVisibleRuntimeCache;
  private visibleBlockSearchRecordsCache?: ReadonlyArray<TraceGraphVisibleSpanSearchRecord>;
  private entitySourceCache?: TraceGraphEntitySourceCache;
  /** Caches direct lane metadata for unfiltered graph views without building visible indexes. */
  private unfilteredVisibleLaneLayoutInfoCache?: TraceGraphVisibleLaneLayoutInfo;

  /** Builds filtered state from an Arrow-backed runtime source and optional span filters. */
  constructor(traceGraph: TraceGraphRuntimeSource, filterOptions: TraceGraphFilterOptions = {}) {
    const constructorStartTime = performance.now();
    const spanFilters = normalizeTraceSpanFilters(filterOptions.spanFilters);
    const spanFilterPlan = buildCompiledTraceSpanFilterPlan(spanFilters);
    const overlappingParentSpanFilter = normalizeOverlappingParentSpanFilter(
      filterOptions.overlappingParentSpanFilter
    );
    const similarDurationChainSpanFilter = normalizeSimilarDurationChainSpanFilter(
      filterOptions.similarDurationChainSpanFilter
    );
    const traceGraphData = traceGraph.traceGraphData;
    const traceStore = traceGraph.traceStore;
    const hasActiveSourceSpanFilter = traceStore?.hasActiveSourceSpanFilter() === true;
    const includeGraphSourceSpanFilters = !hasActiveSourceSpanFilter;
    const hasActiveGraphSpanFilter =
      spanFilters.length > 0 ||
      overlappingParentSpanFilter != null ||
      similarDurationChainSpanFilter != null;
    const stateBuildStartTime = performance.now();
    const preparedState = getUsableTraceGraphPreparedState(
      filterOptions.preparedState,
      spanFilters,
      overlappingParentSpanFilter,
      similarDurationChainSpanFilter
    );
    const filteredGraphState =
      preparedState ??
      (spanFilters.length === 0 &&
      overlappingParentSpanFilter == null &&
      similarDurationChainSpanFilter == null
        ? {
            spanFilters: [],
            overlappingParentSpanFilter: undefined,
            similarDurationChainSpanFilter: undefined,
            filteredSpanRefs: new Set(),
            filteredSpanCountsByFilter: {
              spanFilterCount: 0,
              overlappingParentSpanFilterCount: 0,
              similarDurationChainSpanFilterCount: 0
            }
          }
        : buildTraceGraphState(
            traceGraphData,
            spanFilters,
            includeGraphSourceSpanFilters,
            overlappingParentSpanFilter,
            similarDurationChainSpanFilter
          ));
    const stateBuildDurationMs = performance.now() - stateBuildStartTime;

    this.runtimeEntityRefs = buildTraceRuntimeEntityRefs(traceGraphData);
    this.chunkRegistry = buildTraceChunkRegistry(traceGraphData, this.runtimeEntityRefs);
    this.name = traceGraphData.name;
    this.spanLayout = traceGraphData.spanLayout === 'manual' ? 'manual' : 'auto';
    this.processes = traceGraphData.processes;
    this.crossDependencies = traceGraphData.crossDependencies;
    this.minTimeMs = traceGraphData.minTimeMs;
    this.maxTimeMs = traceGraphData.maxTimeMs;
    this.threadMap = traceGraphData.threadMap;
    this.threadInstantMap = traceGraphData.threadInstantMap;
    this.threadCounterMap = traceGraphData.threadCounterMap;
    this.instantMap = traceGraphData.instantMap;
    this.counterMap = traceGraphData.counterMap;
    this.counterExtents = traceGraphData.counterExtents;
    this.events = traceGraphData.events;
    this.eventMap = traceGraphData.eventMap;
    this.processSpanTableMap =
      filteredGraphState.processSpanTableMap ?? traceGraphData.processSpanTableMap;
    this.localDependencyTableMap = traceGraphData.localDependencyTableMap;
    this.crossDependencyTable = traceGraphData.crossDependencyTable;
    this.spanSidecarMap = traceGraphData.spanSidecarMap;
    this.spanSidecarTableMap = traceGraphData.spanSidecarTableMap;
    this.crossProcessEndpointsBySpanRef = traceGraphData.crossProcessEndpointsBySpanRef;
    this.spanCrossDependencyRefMap = traceGraphData.spanCrossDependencyRefMap;
    this.chunks = this.chunkRegistry.chunks;
    this.spanRefs = traceGraphData.spanRefs;
    this.crossDependencyIdToIndexMap =
      traceGraphData.crossDependencyIdToIndexMap ??
      ({} as Readonly<Record<TraceDependencyId, number>>);
    this.processIdsByIndex = traceGraphData.processIdsByIndex;
    this.dependencyMap = traceGraphData.dependencyMap;
    this.stats = traceGraphData.stats;
    this.filteredSpanRefs = filteredGraphState.filteredSpanRefs;
    this.filteredSpanCountsByFilter = filteredGraphState.filteredSpanCountsByFilter;
    this.graphFilterStateRevision = hasActiveGraphSpanFilter
      ? nextTraceGraphFilterStateRevision++
      : 0;
    this.spanFilters = spanFilters;
    this.spanFilterPlan = spanFilterPlan;
    this.overlappingParentSpanFilter = overlappingParentSpanFilter;
    this.similarDurationChainSpanFilter = similarDurationChainSpanFilter;
    this.traceStore = traceStore;
    log.probe(0, 'TraceGraph ready', {
      name: this.name,
      sourceType: 'trace-graph-data',
      spanCount: this.stats.spanCount,
      filterCount: this.spanFilters.length,
      hasOverlappingParentSpanFilter: this.overlappingParentSpanFilter != null,
      hasSimilarDurationChainSpanFilter: this.similarDurationChainSpanFilter != null,
      stateDurationMs: stateBuildDurationMs,
      usedPreparedState: preparedState !== null,
      totalDurationMs: performance.now() - constructorStartTime,
      ...getHeapUsageProbeFields()
    })();
  }

  /** Returns whether the exact span ref is filtered from the visible graph. */
  spanIsFiltered(spanRef: SpanRef): boolean {
    if (!isValidSourceSpanRef(this, spanRef)) {
      return true;
    }

    return (
      this.getSpanRefFilterMask(spanRef) !== TRACE_SPAN_FILTER_MASK_NONE ||
      this.traceStore?.isFiltered(spanRef) === true
    );
  }

  /** Returns filtered state for one span ref. */
  spanFilterReason(
    spanRef: SpanRef,
    missingSpanInput?: TraceGraphSpanFilterReasonInput
  ): TraceGraphSpanFilterReason {
    return getTraceGraphSpanFilterReason({
      traceGraph: this,
      spanRef,
      hasActiveGraphSpanFilter: this.hasActiveGraphSpanFilter(),
      traceStore: this.traceStore,
      filterPlan: this.spanFilterPlan,
      missingSpanInput
    });
  }

  /** Returns the graph filter mask. */
  private getSpanRefFilterMask(spanRef: SpanRef): TraceSpanFilterMask {
    return getTraceGraphSpanRefFilterMask(this, spanRef, this.hasActiveGraphSpanFilter());
  }

  /** Returns whether any non-empty span filter is active on the graph. */
  hasActiveSpanFilter(): boolean {
    return this.hasActiveGraphSpanFilter() || this.hasActiveTraceStoreSpanFilter();
  }

  /** Returns whether store filtering is active. */
  hasActiveTraceStoreSpanFilter(): boolean {
    return this.traceStore?.hasActiveSourceSpanFilter() === true;
  }

  /** Returns the store-owned source filter revision currently visible to this graph. */
  getSourceSpanFilterRevision(): number {
    return this.traceStore?.getSourceSpanFilterRevision?.() ?? 0;
  }

  /** Returns whether graph filters are active. */
  private hasActiveGraphSpanFilter(): boolean {
    return (
      this.spanFilters.length > 0 ||
      this.overlappingParentSpanFilter != null ||
      this.similarDurationChainSpanFilter != null
    );
  }

  /** Returns the nearest visible ancestor span ref for a filtered span ref. */
  getTraceSpanFilteredParentRef(spanRef: SpanRef): SpanRef | null {
    if (!isValidSourceSpanRef(this, spanRef)) {
      return null;
    }
    if (!this.spanIsFiltered(spanRef)) {
      return null;
    }
    const directParentSpanRefs = getDirectParentSpanRefMap(this);
    let currentParentRef = directParentSpanRefs.get(spanRef)?.[0] ?? null;

    while (currentParentRef != null && this.spanIsFiltered(currentParentRef)) {
      currentParentRef = directParentSpanRefs.get(currentParentRef)?.[0] ?? null;
    }

    return currentParentRef;
  }

  /** Returns filter provenance and explicit visible navigation targets for one exact span ref. */
  getTraceSpanFilterNavigation(spanRef: SpanRef): TraceGraphSpanFilterNavigation | null {
    if (!isValidSourceSpanRef(this, spanRef)) {
      return this.traceStore?.getSpanFilterNavigation?.({traceGraph: this, spanRef}) ?? null;
    }

    const filterReason = this.spanFilterReason(spanRef);
    const filterMask = filterReason.filterMask;
    if (!this.spanIsFiltered(spanRef)) {
      return {
        filterMask,
        visibleDescendantSpanRef: null,
        visibleAncestorSpanRef: null
      };
    }

    const visibleDescendantSpanRef = getFirstVisibleSearchDescendantSpanRef(this, spanRef);
    const visibleAncestorSpanRef = this.getTraceSpanFilteredParentRef(spanRef);
    return {
      filterMask,
      visibleDescendantSpanRef,
      visibleAncestorSpanRef
    };
  }

  /** Returns the original dependency chain as span-card rows without visible-only rewiring. */
  getDependencyChainBySpanRef(spanRef: SpanRef, dependencyKey: string): TraceCardSpan[] {
    if (dependencyKey.toUpperCase() === PARENT_KEYWORD) {
      return this.getParentDependencyChainEntriesBySpanRef(spanRef).map(entry => entry.span);
    }

    return buildDependencyChainFromSourceAdapter({
      spanRef,
      dependencyKey,
      traceGraph: this
    });
  }

  /** Returns original parent dependency rows without visible-only rewiring. */
  getParentDependencyChainEntriesBySpanRef(spanRef: SpanRef): TraceSpanCardParentChainEntry[] {
    return buildParentDependencyChainBySpanRef({
      spanRef,
      traceGraph: this,
      useVisibleParents: false
    });
  }

  /** Returns the dependency chain as span-card rows after filtered spans are stitched. */
  getVisibleDependencyChainBySpanRef(spanRef: SpanRef, dependencyKey: string): TraceCardSpan[] {
    if (dependencyKey.toUpperCase() === PARENT_KEYWORD) {
      return buildParentDependencyChainBySpanRef({
        spanRef,
        traceGraph: this,
        useVisibleParents: true
      }).map(entry => entry.span);
    }

    return buildVisibleDependencyChainFromProjection({
      spanRef,
      dependencyKey,
      traceGraph: this
    });
  }

  /** Returns process-aware parent-chain rows for the selected span card. */
  getTraceSpanParentChainEntries(
    spanRef: SpanRef,
    options: TraceGraphDependencyLookupOptions = {}
  ): TraceSpanCardParentChainEntry[] {
    return getTraceSpanParentChainEntries({
      spanRef,
      traceGraph: this,
      includeHidden: options.includeHidden ?? false
    });
  }

  /** Returns process-aware incoming dependency rows for the selected span card. */
  getTraceSpanIncomingDependencyEntries(
    spanRef: SpanRef,
    options: TraceGraphDependencyLookupOptions = {}
  ): TraceSpanCardDependencyEntry[] {
    return getTraceSpanIncomingDependencyEntries({
      spanRef,
      traceGraph: this,
      includeHidden: options.includeHidden ?? false
    });
  }

  /** Returns process-aware outgoing dependency rows for the selected span card. */
  getTraceSpanOutgoingDependencyEntries(
    spanRef: SpanRef,
    options: TraceGraphDependencyLookupOptions = {}
  ): TraceSpanCardDependencyEntry[] {
    return getTraceSpanOutgoingDependencyEntries({
      spanRef,
      traceGraph: this,
      includeHidden: options.includeHidden ?? false
    });
  }

  /** Returns visible child dependencies reachable from the provided span ref. */
  getTraceSpanChildDependencies(spanRef: SpanRef): TraceSpanCardChildDependency[] {
    const block = materializeTraceSpanBySpanRef(this, spanRef);
    if (!block) {
      return [];
    }

    return getTraceSpanChildDependenciesFromTraceGraph(block, this).flatMap(entry => {
      const childSpanRef = this.resolveSpanRefForBlock(entry.childBlock);
      if (childSpanRef == null) {
        return [];
      }

      const childSpan = buildTraceCardSpan({
        traceGraph: this,
        spanRef: childSpanRef,
        block: entry.childBlock
      });
      return childSpan
        ? [
            {
              dependency: buildTraceCardDependency({
                dependency: entry.dependency,
                traceGraph: this
              }),
              childSpanRef,
              childSpan
            } satisfies TraceSpanCardChildDependency
          ]
        : [];
    });
  }

  /** Returns recursive descendant rows reachable from the selected span card. */
  getTraceSpanDescendants(
    spanRef: SpanRef,
    options: TraceGraphDescendantOptions = {}
  ): TraceSpanCardDescendantResult {
    return getTraceSpanDescendants(this, spanRef, options);
  }

  /** Returns visible cross-process endpoints paired with resolved dependencies for a span card. */
  getTraceSpanEndpointsWithDependencies(spanRef: SpanRef): TraceSpanCardEndpointDependencyEntry[] {
    return getTraceSpanEndpointsWithDependencies(this, spanRef);
  }

  /** Returns all selected-card data for one exact span ref. */
  getTraceSpanCardModel(spanRef: SpanRef): TraceSpanCardModel | null {
    return getTraceSpanCardModel(this, spanRef);
  }

  /** Returns canonical process refs in graph order. */
  getProcessRefs(): ReadonlyArray<ProcessRef> {
    return this.runtimeEntityRefs.processRefs;
  }

  /** Process source. */
  getProcessSourceByRef(processRef: ProcessRef): TraceProcessSource | null {
    return this.getEntitySourceCache().processSourcesByRef.get(processRef) ?? null;
  }

  /** Returns the owning process source for a span ref. */
  getProcessSourceBySpanRef(spanRef: SpanRef): TraceProcessSource | null {
    const processRef = this.getProcessRefBySpanRef(spanRef);
    return processRef != null ? this.getProcessSourceByRef(processRef) : null;
  }

  /** Returns canonical thread refs in graph order. */
  getThreadRefs(): ReadonlyArray<ThreadRef> {
    return this.runtimeEntityRefs.threadRefs;
  }

  /** Returns thread source. */
  getThreadSourceByRef(threadRef: ThreadRef): TraceThreadSource | null {
    return this.getEntitySourceCache().threadSourcesByRef.get(threadRef) ?? null;
  }

  /** Returns the owning thread source for a span ref. */
  getThreadSourceBySpanRef(spanRef: SpanRef): TraceThreadSource | null {
    const threadRef = this.getThreadRefBySpanRef(spanRef);
    return threadRef != null ? this.getThreadSourceByRef(threadRef) : null;
  }

  /** Decodes one numeric runtime ref. */
  decodeRef(ref: number): DecodedTraceRef | null {
    return decodeTraceRef(ref);
  }

  /** Resolves the loaded storage chunk for a chunk-backed runtime ref. */
  getChunkByRef(ref: TraceChunkBackedRef): TraceRuntimeChunk | null {
    return this.chunkRegistry.getChunkByRef(ref);
  }

  /** Returns the stable block id for one span ref without materializing a TraceSpan. */
  getSpanBlockId(spanRef: SpanRef): TraceSpanId | null {
    return getArrowTraceSpanField(this, spanRef, 'spanId') as TraceSpanId | null;
  }

  /** Resolves a span ref from an external block id only when that id is unique in the graph. */
  getSpanRefByExternalBlockId(spanId: TraceSpanId): SpanRef | null {
    return getUniqueTraceGraphSpanRef(this, spanId);
  }

  /**
   * Returns the external block id for one span ref at URL, SQL, export, or compatibility boundaries.
   *
   * Runtime graph and layout code should keep using `SpanRef` when no external identifier is needed.
   */
  getExternalBlockId(spanRef: SpanRef): TraceSpanId | null {
    return this.getSpanBlockId(spanRef);
  }

  /** Returns the external block id string used by URL serializers for one span ref. */
  getExternalBlockIdForUrl(spanRef: SpanRef): string | null {
    return this.getExternalBlockId(spanRef);
  }

  /** Returns the stream id for one span ref without materializing a TraceSpan. */
  getSpanStreamId(spanRef: SpanRef): TraceThreadId | null {
    return getArrowTraceSpanField(this, spanRef, 'threadId') as TraceThreadId | null;
  }

  /** Returns the display name for one span ref without materializing a TraceSpan. */
  getSpanName(spanRef: SpanRef): string | null {
    return getArrowTraceSpanField(this, spanRef, 'name') as string | null;
  }

  /** Returns a span ref source label. */
  getSpanSource(spanRef: SpanRef): string | null {
    return getArrowTraceSpanField(this, spanRef, 'source') as string | null;
  }

  /** Returns the owning process display name for one span ref. */
  getSpanRankName(spanRef: SpanRef): string | null {
    return getArrowTraceSpanField(this, spanRef, 'processName') as string | null;
  }

  /** Returns the primary timing key for one span ref. */
  getSpanPrimaryTimingKey(spanRef: SpanRef): string | null {
    return getArrowTraceSpanField(this, spanRef, 'primaryTimingKey') as string | null;
  }

  /** Returns the primary timing status for one span ref. */
  getSpanStatus(spanRef: SpanRef): TraceSpanTiming['status'] | null {
    return getArrowTraceSpanField(this, spanRef, 'status') as TraceSpanTiming['status'] | null;
  }

  /** Returns the primary start time in milliseconds for one span ref. */
  getSpanStartTimeMs(spanRef: SpanRef): number | null {
    return getArrowTraceSpanField(this, spanRef, 'startTimeMs') as number | null;
  }

  /** Returns the primary end time in milliseconds for one span ref. */
  getSpanEndTimeMs(spanRef: SpanRef): number | null {
    return getArrowTraceSpanField(this, spanRef, 'endTimeMs') as number | null;
  }

  /** Returns the primary duration in milliseconds for one span ref. */
  getSpanDurationMs(spanRef: SpanRef): number | null {
    return getArrowTraceSpanField(this, spanRef, 'durationMs') as number | null;
  }

  /** Returns the formatted primary duration label for one span ref. */
  getSpanDurationLabel(spanRef: SpanRef): string | null {
    return getArrowTraceSpanField(this, spanRef, 'durationMsAsString') as string | null;
  }

  /** Returns keyword labels for one span ref without materializing a TraceSpan. */
  getSpanKeywords(spanRef: SpanRef): readonly string[] {
    return (getArrowTraceSpanField(this, spanRef, 'keywords') as readonly string[] | null) ?? [];
  }

  /** Returns decoded user data for one span ref without materializing a TraceSpan. */
  getSpanUserData(spanRef: SpanRef): Record<string, unknown> | undefined {
    return this.getSpanRenderSource(spanRef)?.userData;
  }

  /** Returns the Arrow-backed display source for one span ref without materializing a TraceSpan. */
  getSpanDisplaySource(spanRef: SpanRef): TraceSpanDisplaySource | null {
    return (
      getTraceGraphSpanDisplaySource(this, spanRef) ??
      this.traceStore?.getSpanDisplaySource?.(spanRef) ??
      null
    );
  }

  /** Returns the Arrow-backed render source for one span ref without expanding dependency ids. */
  getSpanRenderSource(spanRef: SpanRef): TraceRenderSpan | null {
    return (
      getTraceGraphSpanRenderSource(this, spanRef) ??
      this.traceStore?.getSpanRenderSource?.(spanRef) ??
      this.traceStore?.getSpanDisplaySource?.(spanRef) ??
      null
    );
  }

  /** Iterates packed refs for every graph-global cross dependency row in table order. */
  *iterateCrossDependencyRefs(): Iterable<CrossDependencyRef> {
    for (let rowIndex = 0; rowIndex < this.crossDependencyTable.numRows; rowIndex += 1) {
      yield encodeCrossDependencyRef(rowIndex);
    }
  }

  /** Returns the source span ref for one local or cross dependency ref without materializing it. */
  getDependencyStartSpan(dependencyRef: LocalDependencyRef | CrossDependencyRef): SpanRef | null {
    return getTraceGraphDependencyStartSpan(this, dependencyRef);
  }

  /** Returns the destination span ref for one local or cross dependency ref without materializing it. */
  getDependencyEndSpan(dependencyRef: LocalDependencyRef | CrossDependencyRef): SpanRef | null {
    return getTraceGraphDependencyEndSpan(this, dependencyRef);
  }

  /** Returns the stable dependency id for one local or cross dependency ref. */
  getDependencyId(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): TraceDependencyId | null {
    return getTraceGraphDependencyId(this, dependencyRef);
  }

  /** Returns the source block id for one local or cross dependency ref. */
  getDependencyStartBlockId(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): TraceSpanId | null {
    return getTraceGraphDependencyStartBlockId(this, dependencyRef);
  }

  /** Returns the destination block id for one local or cross dependency ref. */
  getDependencyEndBlockId(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): TraceSpanId | null {
    return getTraceGraphDependencyEndBlockId(this, dependencyRef);
  }

  /** Returns the wait-mode field for one local or cross dependency ref. */
  getDependencyWaitMode(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): TraceDependency['waitMode'] | null {
    return getTraceGraphDependencyWaitMode(this, dependencyRef);
  }

  /** Returns the bidirectional flag for one local or cross dependency ref. */
  getDependencyBidirectional(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): boolean | null {
    return getTraceGraphDependencyBidirectional(this, dependencyRef);
  }

  /** Returns the wait duration in milliseconds for one local or cross dependency ref. */
  getDependencyWaitTimeMs(dependencyRef: LocalDependencyRef | CrossDependencyRef): number | null {
    return getTraceGraphDependencyWaitTimeMs(this, dependencyRef);
  }

  /** Returns whether one local or cross dependency should route as a parent-child edge. */
  getDependencyIsParent(dependencyRef: LocalDependencyRef | CrossDependencyRef): boolean {
    return getTraceGraphDependencyIsParent(this, dependencyRef);
  }

  /** Returns dependency keywords for one local or cross dependency ref. */
  getDependencyKeywords(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): ReadonlySet<string> | null {
    return getTraceGraphDependencyKeywords(this, dependencyRef);
  }

  /** Returns optional app-specific user data attached to one source dependency. */
  getDependencyUserData(
    dependencyRef: LocalDependencyRef | CrossDependencyRef
  ): Record<string, unknown> | undefined {
    return getTraceGraphDependencyUserData(this, dependencyRef);
  }

  /** Returns whether one local or cross dependency row has a keyword without building a Set. */
  getDependencyHasKeyword(
    dependencyRef: LocalDependencyRef | CrossDependencyRef,
    keyword: string
  ): boolean {
    return getTraceGraphDependencyHasKeyword(this, dependencyRef, keyword);
  }

  /** Returns the endpoint id for one cross dependency ref without materializing an object. */
  getCrossDependencyEndpointId(
    dependencyRef: CrossDependencyRef
  ): TraceCrossProcessDependency['endpointId'] | null {
    return getTraceGraphCrossDependencyEndpointId(this, dependencyRef);
  }

  /** Returns the source rank number for one cross dependency ref. */
  getCrossDependencyStartRankNum(dependencyRef: CrossDependencyRef): number | null {
    return getTraceGraphCrossDependencyStartRankNum(this, dependencyRef);
  }

  /** Returns the destination rank number for one cross dependency ref. */
  getCrossDependencyEndRankNum(dependencyRef: CrossDependencyRef): number | null {
    return getTraceGraphCrossDependencyEndRankNum(this, dependencyRef);
  }

  /** Returns the topology label for one cross dependency ref. */
  getCrossDependencyTopology(dependencyRef: CrossDependencyRef): string | null {
    return getTraceGraphCrossDependencyTopology(this, dependencyRef);
  }

  /** Returns whether one cross dependency is still waiting. */
  getCrossDependencyWaiting(dependencyRef: CrossDependencyRef): boolean | null {
    return getTraceGraphCrossDependencyWaiting(this, dependencyRef);
  }

  /** Returns whether one cross dependency is still unfinished. */
  getCrossDependencyWaitNotFinished(dependencyRef: CrossDependencyRef): boolean | null {
    return getTraceGraphCrossDependencyWaitNotFinished(this, dependencyRef);
  }

  /** Resolves the semantic owning process ref for a runtime ref when ownership is unambiguous. */
  getProcessRefByRef(ref: TraceProcessOwnedRef): ProcessRef | null {
    return this.chunkRegistry.getProcessRefByRef(ref);
  }

  /** Resolves the semantic owning thread ref for a runtime ref when ownership is unambiguous. */
  getThreadRefByRef(ref: TraceThreadOwnedRef): ThreadRef | null {
    return this.chunkRegistry.getThreadRefByRef(ref);
  }

  /** Returns the thread ref stored on a span row, or null when the span is not in this graph. */
  getThreadRefBySpanRef(spanRef: SpanRef): ThreadRef | null {
    if (!isValidSourceSpanRef(this, spanRef)) {
      return null;
    }
    return this.chunkRegistry.getThreadRefByRef(spanRef);
  }

  /** Returns process thread sources. */
  getThreadSourcesByProcessRef(processRef: ProcessRef): ReadonlyArray<TraceThreadSource> {
    return this.getEntitySourceCache().threadSourcesByProcessRef.get(processRef) ?? [];
  }

  /** Returns the human-readable graph name for the canonical filtered source. */
  getName(): string {
    return this.name;
  }

  /** Returns the aggregated graph stats for the canonical filtered source. */
  getStats(): Readonly<TraceGraphStats> {
    return this.stats;
  }

  /** Returns graph-wide time bounds. */
  getTimeBounds(): Readonly<{minTimeMs: number; maxTimeMs: number}> {
    return {
      minTimeMs: this.minTimeMs,
      maxTimeMs: this.maxTimeMs
    };
  }

  /** Returns the process ref stored on a span row, or null when the span is not in this graph. */
  getProcessRefBySpanRef(spanRef: SpanRef): ProcessRef | null {
    if (!isValidSourceSpanRef(this, spanRef)) {
      return null;
    }
    return this.chunkRegistry.getProcessRefByRef(spanRef);
  }

  /** Resolves a process-scoped span ref. */
  getProcessScopedSpanRef(processRef: ProcessRef, spanId: TraceSpanId): SpanRef | null {
    const processId = this.getRawProcessIdByRef(processRef);
    if (!processId) {
      return null;
    }
    return getProcessScopedSpanRefsByProcessId(this)[processId]?.get(spanId) ?? null;
  }

  /** Returns visible processes. */
  getVisibleProcessRefs(): ReadonlyArray<ProcessRef> {
    const activeProcessRefs = this.spanRefs
      ? this.getActiveSpanProcessRefs()
      : this.getProcessRefs();
    if (!this.hasActiveSpanFilter()) {
      return activeProcessRefs;
    }

    const visibleProcessIds = new Set(this.getVisibleIndex().visibleProcessIds);
    return activeProcessRefs.filter(processRef => {
      const processId = this.getRawProcessIdByRef(processRef);
      return processId != null && visibleProcessIds.has(processId);
    });
  }

  /** Returns one visible process source. */
  getVisibleProcessSourceByRef(processRef: ProcessRef): TraceProcessSource | null {
    return this.getVisibleProcessRefs().includes(processRef)
      ? this.getProcessSourceByRef(processRef)
      : null;
  }

  /** Returns the owning rank number for a span ref. */
  getRankNumBySpanRef(spanRef: SpanRef): number | null {
    const processRef = this.getProcessRefBySpanRef(spanRef);
    return processRef != null ? this.getRankNumByProcessRef(processRef) : null;
  }

  /** Returns the rank number for a process ref. */
  getRankNumByProcessRef(processRef: ProcessRef): number | null {
    return this.getProcessSourceByRef(processRef)?.rankNum ?? null;
  }

  /** Returns the visible span count. */
  getVisibleBlockCount(): number {
    if (!this.hasActiveSpanFilter()) {
      return this.stats.spanCount;
    }

    return this.getVisibleIndex().visibleSpanRefSet.size;
  }

  /** Returns visible dependency refs touching a span without building dependency projections. */
  getVisibleDependencyRefsForSpan(spanRef: SpanRef): readonly VisibleDependencyRef[] {
    if (this.hasActiveSpanFilter()) {
      return this.getVisibleIndex().visibleDependencyRefsBySpanRef.get(spanRef) ?? [];
    }

    const refs = new Set<VisibleDependencyRef>();
    for (const direction of ['incoming', 'outgoing'] as const) {
      const directionalRefs = this.getSpanDirectionalDependencyRefs(spanRef, direction);
      for (const dependencyRef of directionalRefs.localDependencyRefs) {
        const visibleRef = this.getVisibleLocalDependencyRefBySourceRef(dependencyRef);
        if (visibleRef != null) {
          refs.add(visibleRef);
        }
      }
      for (const dependencyRef of directionalRefs.crossDependencyRefs) {
        const visibleRef = this.getVisibleCrossDependencyRefBySourceRef(dependencyRef);
        if (visibleRef != null) {
          refs.add(visibleRef);
        }
      }
    }
    return [...refs];
  }

  /** Returns lightweight visible render spans for a process. */
  getVisibleProcessRenderSpans(processRef: ProcessRef): ReadonlyArray<TraceRenderSpan> {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }
    if (processEntry.renderSpans) {
      return processEntry.renderSpans;
    }

    const visibleIndex = this.hasActiveSpanFilter() ? this.getVisibleIndex() : null;
    const renderSpans = this.getVisibleProcessRenderSpanRefs(processRef).flatMap(spanRef => {
      const sourceSpan = getActiveTraceGraphSpanRenderSource(this, spanRef);
      if (!sourceSpan) {
        return [];
      }
      const crossProcessDependencyEndpoints =
        visibleIndex?.endpointsBySpanRef.get(sourceSpan.spanRef) ??
        sourceSpan.crossProcessDependencyEndpoints;
      const crossProcessEndpointId =
        visibleIndex && visibleIndex.primaryEndpointIdBySpanRef.has(sourceSpan.spanRef)
          ? (visibleIndex.primaryEndpointIdBySpanRef.get(sourceSpan.spanRef) ?? null)
          : sourceSpan.crossProcessEndpointId;

      return [
        {
          ...sourceSpan,
          keywords: [...sourceSpan.keywords],
          crossProcessEndpointId,
          crossProcessDependencyEndpoints: [...crossProcessDependencyEndpoints]
        } satisfies TraceRenderSpan
      ];
    });

    processEntry.renderSpans = renderSpans;
    return processEntry.renderSpans;
  }

  /** Returns visible span refs for a process without materializing render-span objects. */
  getVisibleProcessRenderSpanRefs(processRef: ProcessRef): ReadonlyArray<SpanRef> {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }
    if (processEntry.renderSpanRefs) {
      return processEntry.renderSpanRefs;
    }

    const spanRefs = this.hasActiveSpanFilter()
      ? [...(this.getVisibleIndex().visibleSpanRefsByProcessId[processEntry.processId] ?? [])]
      : [...iterateTraceGraphProcessSpanRefs(this, processEntry.processId)];
    if (spanRefs.length === 0) {
      processEntry.renderSpanRefs = [];
      return processEntry.renderSpanRefs;
    }
    processEntry.renderSpanRefs = spanRefs;
    return processEntry.renderSpanRefs;
  }

  /** Returns Arrow-native geometry sources for one visible process in canonical visible order. */
  getVisibleProcessGeometrySources(processRef: ProcessRef): ReadonlyArray<TraceSpanGeometrySource> {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }
    if (processEntry.geometrySources) {
      return processEntry.geometrySources;
    }

    const spanRefs = this.hasActiveSpanFilter()
      ? (this.getVisibleIndex().visibleSpanRefsByProcessId[processEntry.processId] ?? [])
      : [...iterateTraceGraphProcessSpanRefs(this, processEntry.processId)];
    if (spanRefs.length === 0) {
      processEntry.geometrySources = [];
      return processEntry.geometrySources;
    }

    const visibleBlocks: TraceSpanGeometrySource[] = [];
    const appendGeometrySource = (spanRef: SpanRef): void => {
      const block = getActiveTraceGraphSpanGeometrySource(this, spanRef);
      if (block) {
        visibleBlocks.push(block);
      }
    };
    spanRefs.forEach(appendGeometrySource);
    processEntry.geometrySources = visibleBlocks;
    return processEntry.geometrySources;
  }

  /** Returns Arrow-native display sources for one visible process in canonical visible order. */
  getVisibleProcessDisplaySources(processRef: ProcessRef): ReadonlyArray<TraceSpanDisplaySource> {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }
    if (processEntry.displaySources) {
      return processEntry.displaySources;
    }

    const spanRefs = this.hasActiveSpanFilter()
      ? (this.getVisibleIndex().visibleSpanRefsByProcessId[processEntry.processId] ?? [])
      : [...iterateTraceGraphProcessSpanRefs(this, processEntry.processId)];
    if (spanRefs.length === 0) {
      processEntry.displaySources = [];
      processEntry.displaySourceIndexBySpanId = new Map();
      processEntry.displaySourceIndexBySpanRef = new Map();
      return processEntry.displaySources;
    }

    const visibleBlocks: TraceSpanDisplaySource[] = [];
    const appendDisplaySource = (spanRef: SpanRef): void => {
      const block = getActiveTraceGraphSpanDisplaySource(this, spanRef);
      if (block) {
        visibleBlocks.push(block);
      }
    };
    spanRefs.forEach(appendDisplaySource);
    processEntry.displaySources = visibleBlocks;
    processEntry.displaySourceIndexBySpanId = new Map(
      visibleBlocks.map((block, index) => [block.spanId, index] as const)
    );
    processEntry.displaySourceIndexBySpanRef = new Map(
      visibleBlocks.map((block, index) => [block.spanRef, index] as const)
    );
    return processEntry.displaySources;
  }

  /** Returns one Arrow-native display source by exact span ref from the visible filtered view. */
  getVisibleDisplaySourceBySpanRef(spanRef: SpanRef): TraceSpanDisplaySource | null {
    if (!isValidSourceSpanRef(this, spanRef) || !isVisibleSpanRef(this, spanRef)) {
      return null;
    }
    const processRef = this.getProcessRefBySpanRef(spanRef);
    if (processRef == null) {
      return null;
    }

    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return null;
    }

    const displaySources = this.getVisibleProcessDisplaySources(processRef);
    const displaySourceIndex = processEntry.displaySourceIndexBySpanRef?.get(spanRef);
    return displaySourceIndex == null ? null : (displaySources[displaySourceIndex] ?? null);
  }

  /** Resolves one source display source from an exact canonical span ref. */
  getDisplaySourceBySpanRef(spanRef: SpanRef): TraceSpanDisplaySource | null {
    return isValidSourceSpanRef(this, spanRef)
      ? getActiveTraceGraphSpanDisplaySource(this, spanRef)
      : null;
  }

  /** Resolves one visible span id from a compact visible span ref. */
  getVisibleSpanId(spanRef: SpanRef): TraceSpanId | null {
    return this.getVisibleSpanBlockId(spanRef);
  }

  /** Resolves one visible block id from a compact visible span ref. */
  getVisibleSpanBlockId(spanRef: SpanRef): TraceSpanId | null {
    if (!isVisibleSpanRef(this, spanRef)) {
      return null;
    }
    return getActiveTraceGraphSpanDisplaySource(this, spanRef)?.spanId ?? null;
  }

  /** Returns lightweight visible local dependency sources for Arrow-native layout. */
  getVisibleLocalDependencyLayoutSources(
    processRef: ProcessRef
  ): ReadonlyArray<TraceLayoutLaneDependencySource> {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }
    if (processEntry.localDependencyLayoutSources) {
      return processEntry.localDependencyLayoutSources;
    }

    const visibleDependencies = this.getVisibleLocalDependencySources(processRef).flatMap(
      dependency =>
        dependency.startSpanRef != null && dependency.endSpanRef != null
          ? [
              {
                dependencyId: dependency.dependencyId,
                startSpanRef: dependency.startSpanRef,
                endSpanRef: dependency.endSpanRef,
                hasParentKeyword: dependency.keywords.has('PARENT')
              } satisfies TraceLayoutLaneDependencySource
            ]
          : []
    );
    processEntry.localDependencyLayoutSources = visibleDependencies;
    return processEntry.localDependencyLayoutSources;
  }

  /** Returns ref-native visible local dependency sources for one process in canonical visible order. */
  getVisibleLocalDependencySources(
    processRef: ProcessRef
  ): ReadonlyArray<TraceLocalDependencySource> {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }
    if (processEntry.localDependencySources) {
      return processEntry.localDependencySources;
    }

    if (!this.hasActiveSpanFilter()) {
      const dependencyRefs = this.getLocalDependencyRefs(processRef);
      const visibleDependencies: TraceLocalDependencySource[] = [];
      for (const dependencyRef of dependencyRefs) {
        const dependency = this.buildUnfilteredLocalDependencySourceByRef(dependencyRef);
        if (dependency) {
          visibleDependencies.push(dependency);
        }
      }
      processEntry.localDependencySources = visibleDependencies;
      return processEntry.localDependencySources;
    }

    const dependencyRefs = this.getVisibleLocalDependencyRefs(processRef);
    const visibleDependencies = dependencyRefs.flatMap(dependencyRef => {
      const dependency = this.getVisibleDependencySourceByRef(dependencyRef);
      return dependency?.type === 'trace-local-dependency' ? [dependency] : [];
    });
    processEntry.localDependencySources = visibleDependencies;
    return processEntry.localDependencySources;
  }

  /** Returns visible local dependency refs for one process in canonical visible order. */
  getVisibleLocalDependencyRefs(processRef: ProcessRef): readonly VisibleLocalDependencyRef[] {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }
    if (processEntry.localDependencyRefs) {
      return processEntry.localDependencyRefs;
    }

    if (!this.hasActiveSpanFilter()) {
      const table = this.localDependencyTableMap[processEntry.processId];
      const startIndex = this.getUnfilteredVisibleLocalDependencyStartIndex(processEntry.processId);
      if (!table || startIndex == null) {
        processEntry.localDependencyRefs = [];
        return processEntry.localDependencyRefs;
      }
      const dependencyRefs: VisibleLocalDependencyRef[] = [];
      for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
        dependencyRefs.push(encodeVisibleLocalDependencyRef(startIndex + rowIndex));
      }
      processEntry.localDependencyRefs = dependencyRefs;
      return processEntry.localDependencyRefs;
    }

    const dependencyRefs =
      this.getVisibleIndex().visibleLocalDependencyRefsByProcessId[processEntry.processId];
    if (!dependencyRefs) {
      processEntry.localDependencyRefs = [];
      return processEntry.localDependencyRefs;
    }

    processEntry.localDependencyRefs = dependencyRefs;
    return processEntry.localDependencyRefs;
  }

  /** Returns source local dependency refs for one process in table order. */
  getLocalDependencyRefs(processRef: ProcessRef): readonly LocalDependencyRef[] {
    const processEntry = this.getVisibleProcessCacheEntry(processRef);
    if (!processEntry) {
      return [];
    }

    const table = this.localDependencyTableMap[processEntry.processId];
    if (!table) {
      return [];
    }

    const processIndex = this.processIdsByIndex.indexOf(processEntry.processId);
    if (processIndex < 0) {
      return [];
    }

    const dependencyRefColumn = table.getChild('dependencyRef');
    const dependencyRefs: LocalDependencyRef[] = [];
    for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
      const dependencyRef = normalizeArrowRefNumber(dependencyRefColumn?.get(rowIndex));
      const normalizedDependencyRef =
        dependencyRef == null ||
        getLocalDependencyRefProcessIndex(dependencyRef as LocalDependencyRef) !== processIndex
          ? encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))
          : (dependencyRef as LocalDependencyRef);
      dependencyRefs.push(normalizedDependencyRef);
    }
    return dependencyRefs;
  }

  /** Returns ref-native visible cross dependency sources after filtered-parent stitching. */
  getVisibleCrossDependencySources(): ReadonlyArray<TraceCrossDependencySource> {
    const visibleRuntimeCache = this.getVisibleRuntimeCache();
    if (visibleRuntimeCache.crossDependencySources) {
      return visibleRuntimeCache.crossDependencySources;
    }

    const buildStartTime = performance.now();
    if (!this.hasActiveSpanFilter()) {
      const visibleCrossDependencies = [...this.iterateCrossDependencyRefs()].flatMap(
        sourceDependencyRef => {
          const dependency = this.buildUnfilteredVisibleCrossDependencySource(sourceDependencyRef);
          return dependency ? [dependency] : [];
        }
      );
      visibleRuntimeCache.crossDependencySources = visibleCrossDependencies;
      log.probe(0, 'TraceGraph visible cross dependencies done', {
        name: this.name,
        mode: 'unfiltered-direct',
        crossDependencyCount: visibleCrossDependencies.length,
        durationMs: performance.now() - buildStartTime,
        ...getHeapUsageProbeFields()
      })();
      return visibleCrossDependencies;
    }

    const visibleCrossDependencies = this.getVisibleCrossDependencyRefs().flatMap(dependencyRef => {
      const dependency = this.getVisibleDependencySourceByRef(dependencyRef);
      return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
    });
    visibleRuntimeCache.crossDependencySources = visibleCrossDependencies;
    log.probe(0, 'TraceGraph visible cross dependencies done', {
      name: this.name,
      mode: 'filtered-index',
      crossDependencyCount: visibleCrossDependencies.length,
      durationMs: performance.now() - buildStartTime,
      ...getHeapUsageProbeFields()
    })();
    return visibleRuntimeCache.crossDependencySources;
  }

  /**
   * Builds one unfiltered visible cross-dependency source directly from Arrow columns.
   *
   * This intentionally avoids `getVisibleIndex()` because unfiltered cross-dependency layout can
   * stream the cross table without constructing local-dependency adjacency for every visible span.
   */
  private buildUnfilteredVisibleCrossDependencySource(
    sourceDependencyRef: CrossDependencyRef
  ): TraceCrossDependencySource | null {
    const dependencyId = this.getDependencyId(sourceDependencyRef);
    const startSpanId = this.getDependencyStartBlockId(sourceDependencyRef);
    const endSpanId = this.getDependencyEndBlockId(sourceDependencyRef);
    const endpointId = this.getCrossDependencyEndpointId(sourceDependencyRef);
    const startRankNum = this.getCrossDependencyStartRankNum(sourceDependencyRef);
    const endRankNum = this.getCrossDependencyEndRankNum(sourceDependencyRef);
    const topology = this.getCrossDependencyTopology(sourceDependencyRef);
    const waitMode = this.getDependencyWaitMode(sourceDependencyRef);
    if (
      !dependencyId ||
      !startSpanId ||
      !endSpanId ||
      !endpointId ||
      startRankNum == null ||
      endRankNum == null ||
      !topology ||
      !waitMode
    ) {
      return null;
    }

    return {
      type: 'trace-cross-process-dependency',
      dependencyRef: sourceDependencyRef,
      dependencyId,
      startSpanId,
      endSpanId,
      startSpanRef: this.getDependencyStartSpan(sourceDependencyRef) ?? undefined,
      endSpanRef: this.getDependencyEndSpan(sourceDependencyRef) ?? undefined,
      waitMode,
      bidirectional: this.getDependencyBidirectional(sourceDependencyRef) ?? false,
      waitTimeMs: this.getDependencyWaitTimeMs(sourceDependencyRef) ?? 0,
      keywords: this.getDependencyKeywords(sourceDependencyRef) ?? new Set(),
      userData: this.getDependencyUserData(sourceDependencyRef),
      endpointId,
      startRankNum,
      endRankNum,
      topology,
      waiting: this.getCrossDependencyWaiting(sourceDependencyRef) ?? false,
      waitNotFinished: this.getCrossDependencyWaitNotFinished(sourceDependencyRef) ?? false
    } satisfies TraceCrossDependencySource;
  }

  /** Returns cached visible lane metadata inferred from explicit block lane values. */
  getVisibleLaneLayoutInfo(): TraceGraphVisibleLaneLayoutInfo {
    return this.hasActiveSpanFilter()
      ? this.getVisibleIndex().visibleLaneLayoutInfo
      : this.getUnfilteredVisibleLaneLayoutInfo();
  }

  /** Builds or returns direct lane metadata for an unfiltered graph view. */
  private getUnfilteredVisibleLaneLayoutInfo(): TraceGraphVisibleLaneLayoutInfo {
    if (this.unfilteredVisibleLaneLayoutInfoCache) {
      return this.unfilteredVisibleLaneLayoutInfoCache;
    }

    const laneCountsByThreadRef = new Map<ThreadRef, number>();
    let explicitLaneValueCount = 0;
    for (const process of this.processes) {
      const processId = process.processId as TraceProcessId;
      for (const spanRef of iterateTraceGraphProcessSpanRefs(this, processId)) {
        const laneValue = getArrowTraceSpanLaneValue(this, spanRef);
        if (typeof laneValue !== 'number' || !Number.isFinite(laneValue) || laneValue < 0) {
          continue;
        }

        const threadRef = this.getThreadRefBySpanRef(spanRef);
        if (threadRef == null) {
          continue;
        }

        explicitLaneValueCount += 1;
        const currentLaneCount = laneCountsByThreadRef.get(threadRef) ?? 1;
        laneCountsByThreadRef.set(threadRef, Math.max(currentLaneCount, Math.floor(laneValue) + 1));
      }
    }

    this.unfilteredVisibleLaneLayoutInfoCache = {
      threadLaneLayoutMapByRef:
        laneCountsByThreadRef.size > 0
          ? new Map(
              [...laneCountsByThreadRef.entries()].map(([threadRef, laneCount]) => [
                threadRef,
                {laneCount}
              ])
            )
          : undefined,
      explicitLaneValueCount,
      threadsWithLaneDataCount: laneCountsByThreadRef.size
    };
    return this.unfilteredVisibleLaneLayoutInfoCache;
  }

  /** Builds one visible dependency source from visible indexes and Arrow-backed dependency fields. */
  private buildVisibleDependencySourceByRef(
    dependencyRef: VisibleDependencyRef
  ): TraceDependencySource | null {
    const visibleIndex = this.getVisibleIndex();
    if (isVisibleLocalDependencyRef(dependencyRef)) {
      const rowIndex = getVisibleLocalDependencyRefIndex(dependencyRef);
      const dependencyId = visibleIndex.visibleLocalDependencyIds[rowIndex] ?? null;
      const sourceDependencyRef = visibleIndex.visibleLocalDependencySourceRefs[rowIndex] ?? null;
      if (!dependencyId) {
        return null;
      }

      if (!sourceDependencyRef) {
        return this.buildOverrideOnlyVisibleLocalDependencySource({
          dependencyId,
          dependencyRef
        });
      }

      const override = visibleIndex.dependencyOverrideSpecsByRef.get(dependencyRef);
      const overrideStartSpanRef =
        override?.kind === 'local-rewrite' || override?.kind === 'local-parent'
          ? override.startSpanRef
          : null;
      const overrideEndSpanRef =
        override?.kind === 'local-rewrite' || override?.kind === 'local-parent'
          ? override.endSpanRef
          : null;
      const overrideUserData = override?.kind === 'local-parent' ? override.userData : undefined;
      const startSpanId =
        overrideStartSpanRef != null
          ? this.getSpanBlockId(overrideStartSpanRef)
          : this.getDependencyStartBlockId(sourceDependencyRef);
      const endSpanId =
        overrideEndSpanRef != null
          ? this.getSpanBlockId(overrideEndSpanRef)
          : this.getDependencyEndBlockId(sourceDependencyRef);
      const waitMode = this.getDependencyWaitMode(sourceDependencyRef);
      const bidirectional = this.getDependencyBidirectional(sourceDependencyRef);
      const waitTimeMs = this.getDependencyWaitTimeMs(sourceDependencyRef);
      if (!startSpanId || !endSpanId || !waitMode) {
        return null;
      }
      const startSpanRef = overrideStartSpanRef ?? this.getDependencyStartSpan(sourceDependencyRef);
      const endSpanRef = overrideEndSpanRef ?? this.getDependencyEndSpan(sourceDependencyRef);

      return {
        type: 'trace-local-dependency',
        dependencyRef,
        dependencyId,
        startSpanId,
        endSpanId,
        startSpanRef: startSpanRef ?? undefined,
        endSpanRef: endSpanRef ?? undefined,
        waitMode,
        bidirectional: bidirectional ?? false,
        waitTimeMs: waitTimeMs ?? 0,
        keywords: this.getDependencyKeywords(sourceDependencyRef) ?? new Set(),
        userData: overrideUserData ?? this.getDependencyUserData(sourceDependencyRef)
      } satisfies TraceLocalDependencySource;
    }

    if (!isVisibleCrossDependencyRef(dependencyRef)) {
      return null;
    }

    const rowIndex = getVisibleCrossDependencyRefIndex(dependencyRef);
    const dependencyId = visibleIndex.visibleCrossDependencyIds[rowIndex] ?? null;
    const sourceDependencyRef = visibleIndex.visibleCrossDependencySourceRefs[rowIndex] ?? null;
    if (!dependencyId) {
      return null;
    }

    if (!sourceDependencyRef) {
      return this.buildOverrideOnlyVisibleCrossDependencySource({
        dependencyId,
        dependencyRef
      });
    }

    const override = visibleIndex.dependencyOverrideSpecsByRef.get(dependencyRef);
    const overrideStartSpanRef = override?.kind === 'cross-parent' ? override.startSpanRef : null;
    const overrideEndSpanRef = override?.kind === 'cross-parent' ? override.endSpanRef : null;
    const overrideUserData = override?.kind === 'cross-parent' ? override.userData : undefined;
    const startSpanId =
      overrideStartSpanRef != null
        ? this.getSpanBlockId(overrideStartSpanRef)
        : this.getDependencyStartBlockId(sourceDependencyRef);
    const endSpanId =
      overrideEndSpanRef != null
        ? this.getSpanBlockId(overrideEndSpanRef)
        : this.getDependencyEndBlockId(sourceDependencyRef);
    const endpointId =
      override?.kind === 'cross-parent'
        ? override.endpointId
        : this.getCrossDependencyEndpointId(sourceDependencyRef);
    const startRankNum =
      override?.kind === 'cross-parent'
        ? override.startRankNum
        : this.getCrossDependencyStartRankNum(sourceDependencyRef);
    const endRankNum =
      override?.kind === 'cross-parent'
        ? override.endRankNum
        : this.getCrossDependencyEndRankNum(sourceDependencyRef);
    const topology =
      override?.kind === 'cross-parent'
        ? override.topology
        : this.getCrossDependencyTopology(sourceDependencyRef);
    const waiting =
      override?.kind === 'cross-parent'
        ? override.waiting
        : this.getCrossDependencyWaiting(sourceDependencyRef);
    const waitNotFinished =
      override?.kind === 'cross-parent'
        ? override.waitNotFinished
        : this.getCrossDependencyWaitNotFinished(sourceDependencyRef);
    const waitMode = this.getDependencyWaitMode(sourceDependencyRef);
    const bidirectional = this.getDependencyBidirectional(sourceDependencyRef);
    const waitTimeMs = this.getDependencyWaitTimeMs(sourceDependencyRef);
    if (
      !startSpanId ||
      !endSpanId ||
      !endpointId ||
      startRankNum == null ||
      endRankNum == null ||
      !topology ||
      !waitMode
    ) {
      return null;
    }
    const startSpanRef = overrideStartSpanRef ?? this.getDependencyStartSpan(sourceDependencyRef);
    const endSpanRef = overrideEndSpanRef ?? this.getDependencyEndSpan(sourceDependencyRef);

    return {
      type: 'trace-cross-process-dependency',
      dependencyRef,
      dependencyId,
      startSpanId,
      endSpanId,
      startSpanRef: startSpanRef ?? undefined,
      endSpanRef: endSpanRef ?? undefined,
      waitMode,
      bidirectional: bidirectional ?? false,
      waitTimeMs: waitTimeMs ?? 0,
      keywords: this.getDependencyKeywords(sourceDependencyRef) ?? new Set(),
      userData: overrideUserData ?? this.getDependencyUserData(sourceDependencyRef),
      endpointId,
      startRankNum,
      endRankNum,
      topology,
      waiting: waiting ?? false,
      waitNotFinished: waitNotFinished ?? false
    } satisfies TraceCrossDependencySource;
  }

  /** Builds one visible local dependency source when a filtered override fully describes it. */
  private buildOverrideOnlyVisibleLocalDependencySource(params: {
    /** Visible dependency id being resolved. */
    dependencyId: TraceDependencyId;
    /** Canonical visible dependency ref assigned by the active visible index. */
    dependencyRef: VisibleLocalDependencyRef;
  }): TraceLocalDependencySource | null {
    const override = this.getVisibleIndex().dependencyOverrideSpecsByRef.get(params.dependencyRef);
    if (override?.kind !== 'local-parent') {
      return null;
    }
    const startSpanId = this.getSpanBlockId(override.startSpanRef);
    const endSpanId = this.getSpanBlockId(override.endSpanRef);
    if (!startSpanId || !endSpanId) {
      return null;
    }
    return {
      type: 'trace-local-dependency',
      dependencyRef: params.dependencyRef,
      dependencyId: params.dependencyId,
      startSpanId,
      endSpanId,
      startSpanRef: override.startSpanRef,
      endSpanRef: override.endSpanRef,
      waitMode: override.waitMode,
      bidirectional: override.bidirectional,
      waitTimeMs: override.waitTimeMs,
      keywords: new Set(override.keywords),
      userData: override.userData
    } satisfies TraceLocalDependencySource;
  }

  /** Builds one visible cross dependency source when a filtered override fully describes it. */
  private buildOverrideOnlyVisibleCrossDependencySource(params: {
    /** Visible dependency id being resolved. */
    dependencyId: TraceDependencyId;
    /** Canonical visible dependency ref assigned by the active visible index. */
    dependencyRef: VisibleCrossDependencyRef;
  }): TraceCrossDependencySource | null {
    const override = this.getVisibleIndex().dependencyOverrideSpecsByRef.get(params.dependencyRef);
    if (override?.kind !== 'cross-parent') {
      return null;
    }
    const startSpanId = this.getSpanBlockId(override.startSpanRef);
    const endSpanId = this.getSpanBlockId(override.endSpanRef);
    if (
      !startSpanId ||
      !endSpanId ||
      !override.endpointId ||
      override.startRankNum == null ||
      override.endRankNum == null ||
      !override.topology
    ) {
      return null;
    }
    return {
      type: 'trace-cross-process-dependency',
      dependencyRef: params.dependencyRef,
      dependencyId: params.dependencyId,
      startSpanId,
      endSpanId,
      startSpanRef: override.startSpanRef,
      endSpanRef: override.endSpanRef,
      waitMode: override.waitMode,
      bidirectional: override.bidirectional,
      waitTimeMs: override.waitTimeMs,
      keywords: new Set(override.keywords),
      userData: override.userData,
      endpointId: override.endpointId,
      startRankNum: override.startRankNum,
      endRankNum: override.endRankNum,
      topology: override.topology,
      waiting: override.waiting,
      waitNotFinished: override.waitNotFinished
    } satisfies TraceCrossDependencySource;
  }

  /** Returns parent/child dependency traversal over visible dependencies keyed by span refs. */
  getTraceSpanDependencySelection(
    spanRef: SpanRef,
    options: {
      /** Dependency keywords to follow during traversal. */
      keywords?: ReadonlySet<string>;
      /** Optional upward traversal cap. */
      upLimit?: number;
      /** Optional downward traversal cap. */
      downLimit?: number;
    } = {}
  ): TraceSpanDependencySelection {
    return buildTraceSpanDependencySelection({
      spanRef,
      traceGraph: this,
      keywords: options.keywords ?? new Set<string>(),
      upLimit: options.upLimit,
      downLimit: options.downLimit
    });
  }

  /** Resolves one visible local dependency ref from a raw process-global dependency ref. */
  getVisibleLocalDependencyRefBySourceRef(
    dependencyRef: LocalDependencyRef
  ): VisibleLocalDependencyRef | null {
    if (!this.hasActiveSpanFilter()) {
      const processId = this.processIdsByIndex[getLocalDependencyRefProcessIndex(dependencyRef)];
      if (!processId) {
        return null;
      }

      const startIndex = this.getUnfilteredVisibleLocalDependencyStartIndex(processId);
      const rowIndex = getLocalDependencyRefRowIndex(dependencyRef);
      const table = this.localDependencyTableMap[processId];
      if (startIndex == null || !table || rowIndex >= table.numRows) {
        return null;
      }

      return encodeVisibleLocalDependencyRef(startIndex + rowIndex);
    }

    return this.getVisibleIndex().visibleLocalDependencyRefBySourceRef.get(dependencyRef) ?? null;
  }

  /** Resolves one visible cross dependency ref from a raw global dependency ref. */
  getVisibleCrossDependencyRefBySourceRef(
    dependencyRef: CrossDependencyRef
  ): VisibleCrossDependencyRef | null {
    if (!this.hasActiveSpanFilter()) {
      return encodeVisibleCrossDependencyRef(getCrossDependencyRefIndex(dependencyRef));
    }
    return this.getVisibleIndex().visibleCrossDependencyRefBySourceRef.get(dependencyRef) ?? null;
  }

  /** Resolves one visible dependency ref from an exact runtime dependency object. */
  getVisibleDependencyRefForDependency(dependency: TraceDependency): VisibleDependencyRef | null {
    const dependencyRef = dependency.dependencyRef;
    if (dependency.type === 'trace-local-dependency') {
      if (dependencyRef != null && isVisibleLocalDependencyRef(dependencyRef)) {
        return dependencyRef;
      }
      const rawDependencyRef =
        dependencyRef != null && isLocalDependencyRef(dependencyRef)
          ? (dependencyRef as LocalDependencyRef)
          : null;
      const rawVisibleDependencyRef = rawDependencyRef
        ? this.getVisibleLocalDependencyRefBySourceRef(rawDependencyRef)
        : null;
      if (rawVisibleDependencyRef != null) {
        return rawVisibleDependencyRef;
      }

      return null;
    }

    if (dependencyRef != null && isVisibleCrossDependencyRef(dependencyRef)) {
      return dependencyRef;
    }
    const rawDependencyRef =
      dependencyRef != null && isCrossDependencyRef(dependencyRef)
        ? (dependencyRef as CrossDependencyRef)
        : null;
    const rawVisibleDependencyRef = rawDependencyRef
      ? this.getVisibleCrossDependencyRefBySourceRef(rawDependencyRef)
      : null;
    return rawVisibleDependencyRef;
  }

  /** Resolves one ref-native visible dependency source from a visible dependency ref. */
  getVisibleDependencySourceByRef(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceDependencySource | null {
    if (isLocalDependencyRef(dependencyRef)) {
      return this.buildUnfilteredLocalDependencySourceByRef(dependencyRef);
    }
    if (isCrossDependencyRef(dependencyRef)) {
      return this.buildUnfilteredVisibleCrossDependencySource(dependencyRef);
    }
    if (!this.hasActiveSpanFilter() && isVisibleLocalDependencyRef(dependencyRef)) {
      const sourceRef = this.getUnfilteredVisibleLocalDependencySourceRefByRef(dependencyRef);
      const source = sourceRef ? this.buildUnfilteredLocalDependencySourceByRef(sourceRef) : null;
      return source ? {...source, dependencyRef} : null;
    }
    if (!this.hasActiveSpanFilter() && isVisibleCrossDependencyRef(dependencyRef)) {
      const sourceRef = encodeCrossDependencyRef(getVisibleCrossDependencyRefIndex(dependencyRef));
      const source = this.buildUnfilteredVisibleCrossDependencySource(sourceRef);
      return source ? {...source, dependencyRef} : null;
    }
    if (!isLegacyVisibleDependencyRef(dependencyRef)) {
      return null;
    }

    const visibleRuntimeCache = this.getVisibleRuntimeCache();
    const cachedDependency = visibleRuntimeCache.dependencySourcesByRef.get(dependencyRef);
    if (cachedDependency !== undefined) {
      return cachedDependency;
    }

    const sourceWithRefs = this.withRuntimeDependencySourceRefs(
      this.buildVisibleDependencySourceByRef(dependencyRef)
    );
    visibleRuntimeCache.dependencySourcesByRef.set(dependencyRef, sourceWithRefs);
    return sourceWithRefs;
  }

  /** Resolves one lightweight visible dependency source without reading descriptive fields. */
  getVisibleDependencyRenderSourceByRef(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceDependencyRenderSource | null {
    const visibleDependencyRef = this.getVisibleDependencyRefByRef(dependencyRef);
    if (visibleDependencyRef == null) {
      return null;
    }

    const startSpanRef = this.getVisibleDependencyStartSpan(visibleDependencyRef);
    const endSpanRef = this.getVisibleDependencyEndSpan(visibleDependencyRef);
    const waitMode = this.getVisibleDependencyWaitMode(visibleDependencyRef);
    if (!waitMode) {
      return null;
    }

    const renderSource = {
      startSpanRef,
      endSpanRef,
      waitMode,
      bidirectional: this.getVisibleDependencyBidirectional(visibleDependencyRef) === true,
      waitTimeMs: this.getVisibleDependencyWaitTimeMs(visibleDependencyRef) ?? 0,
      isParent: this.getVisibleDependencyIsParent(visibleDependencyRef)
    } satisfies TraceDependencyRenderSourceCommon;

    if (isVisibleLocalDependencyRef(visibleDependencyRef)) {
      const processRef = this.getVisibleLocalDependencyProcessRefByRef(visibleDependencyRef);
      return processRef == null
        ? null
        : ({
            ...renderSource,
            type: 'trace-local-dependency',
            dependencyRef: visibleDependencyRef,
            processRef
          } satisfies TraceLocalDependencyRenderSource);
    }

    const rankNums = this.getVisibleCrossDependencyRankNums(visibleDependencyRef);
    return rankNums == null
      ? null
      : ({
          ...renderSource,
          type: 'trace-cross-process-dependency',
          dependencyRef: visibleDependencyRef,
          ...rankNums
        } satisfies TraceCrossDependencyRenderSource);
  }

  /** Reads immediate dependency refs attached to one span without building graph projections. */
  getSpanDirectionalDependencyRefs(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection
  ): TraceSpanDirectionalDependencyRefs {
    const dependencyRefs = this.getSpanDirectionalDependencyRefBuckets(
      spanRef,
      direction,
      Number.POSITIVE_INFINITY
    );
    return {
      localDependencyRefs: dependencyRefs.localDependencyRefs,
      crossDependencyRefs: dependencyRefs.crossDependencyRefs
    };
  }

  /** Reads bounded immediate dependency refs attached to one span without materializing edges. */
  getSpanDirectionalDependencyRefSlice(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number
  ): TraceDirectionalDependencyRefSlice<TraceDependencyRef> {
    const dependencyRefs = this.getSpanDirectionalDependencyRefBuckets(spanRef, direction, limit);
    return {
      dependencyRefs: [
        ...dependencyRefs.localDependencyRefs,
        ...dependencyRefs.crossDependencyRefs
      ],
      totalCount: dependencyRefs.totalCount,
      truncated: dependencyRefs.truncated
    };
  }

  /** Reads bounded visible dependency refs touching one span in one rendered direction. */
  getVisibleDirectionalDependencyRefSlice(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number
  ): TraceDirectionalDependencyRefSlice<VisibleDependencyRef> {
    const normalizedLimit = normalizeDependencyRefLimit(limit);
    if (!this.hasActiveSpanFilter()) {
      const sourceDependencyRefs = this.getSpanDirectionalDependencyRefSlice(
        spanRef,
        direction,
        normalizedLimit
      );
      const dependencyRefs = sourceDependencyRefs.dependencyRefs.flatMap(dependencyRef => {
        const visibleDependencyRef = this.getVisibleDependencyRefByRef(dependencyRef);
        return visibleDependencyRef != null ? [visibleDependencyRef] : [];
      });
      return {
        dependencyRefs,
        totalCount: sourceDependencyRefs.totalCount,
        truncated: sourceDependencyRefs.truncated
      };
    }

    const dependencyRefs: VisibleDependencyRef[] = [];
    const seenDependencyRefs = new Set<VisibleDependencyRef>();
    let totalCount = 0;
    for (const dependencyRef of this.getVisibleDependencyRefsForSpan(spanRef)) {
      const dependencyStartSpanRef = this.getVisibleDependencyStartSpan(dependencyRef);
      const dependencyEndSpanRef = this.getVisibleDependencyEndSpan(dependencyRef);
      if (
        (direction === 'incoming' && dependencyEndSpanRef !== spanRef) ||
        (direction === 'outgoing' && dependencyStartSpanRef !== spanRef) ||
        seenDependencyRefs.has(dependencyRef)
      ) {
        continue;
      }
      seenDependencyRefs.add(dependencyRef);
      totalCount += 1;
      if (dependencyRefs.length < normalizedLimit) {
        dependencyRefs.push(dependencyRef);
      }
    }
    return {
      dependencyRefs,
      totalCount,
      truncated: totalCount > dependencyRefs.length
    };
  }

  /** Reads bounded cross dependency refs attached to one span without reading local refs. */
  getSpanDirectionalCrossDependencyRefSlice(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number
  ): TraceDirectionalDependencyRefSlice<CrossDependencyRef> {
    const dependencyRefs = this.getSpanDirectionalDependencyRefBuckets(
      spanRef,
      direction,
      limit,
      false
    );
    return {
      dependencyRefs: dependencyRefs.crossDependencyRefs,
      totalCount: dependencyRefs.totalCount,
      truncated: dependencyRefs.truncated
    };
  }

  /** Resolves bounded directional source refs while preserving local and cross ref buckets. */
  private getSpanDirectionalDependencyRefBuckets(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number,
    includeLocalDependencyRefs = true
  ): TraceSpanDirectionalDependencyRefBuckets {
    const processId = getTraceGraphSpanRefProcessId(this, spanRef);
    if (!processId) {
      return EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REF_BUCKETS;
    }

    const rowIndex = getTraceGraphSpanTableRowIndex(this, spanRef);
    if (rowIndex == null) {
      return EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REF_BUCKETS;
    }
    const normalizedLimit = normalizeDependencyRefLimit(limit);
    const sidecarTable = this.spanSidecarTableMap?.[processId];
    const localColumnName =
      direction === 'incoming' ? 'incomingLocalDependencyRefs' : 'outgoingLocalDependencyRefs';
    const crossColumnName =
      direction === 'incoming' ? 'incomingCrossDependencyRefs' : 'outgoingCrossDependencyRefs';
    const tableLocalDependencyRefs =
      includeLocalDependencyRefs && sidecarTable
        ? readArrowNumberListColumn(sidecarTable, localColumnName, rowIndex)
        : null;
    const tableCrossDependencyRefs = sidecarTable
      ? readArrowNumberListColumn(sidecarTable, crossColumnName, rowIndex)
      : null;
    const sparseCrossDependencyRefs =
      direction === 'incoming'
        ? this.spanCrossDependencyRefMap?.incomingCrossDependencyRefsBySpanRef.get(spanRef)
        : this.spanCrossDependencyRefMap?.outgoingCrossDependencyRefsBySpanRef.get(spanRef);
    const sidecarRow = this.spanSidecarMap?.[processId]?.[rowIndex] ?? null;
    const rowLocalDependencyRefs = includeLocalDependencyRefs
      ? direction === 'incoming'
        ? (sidecarRow?.incomingLocalDependencyRefs ?? sidecarRow?.incomingLocalDependencyRowIndexes)
        : (sidecarRow?.outgoingLocalDependencyRefs ?? sidecarRow?.outgoingLocalDependencyRowIndexes)
      : null;
    const rowCrossDependencyRefs =
      direction === 'incoming'
        ? sidecarRow?.incomingCrossDependencyRefs
        : sidecarRow?.outgoingCrossDependencyRefs;

    const rawLocalDependencyRefs = tableLocalDependencyRefs ?? rowLocalDependencyRefs ?? [];
    const localDependencyRefs = includeLocalDependencyRefs
      ? getBoundedDirectionalDependencyRefs({
          dependencyRefs: rawLocalDependencyRefs,
          limit: normalizedLimit,
          normalizeDependencyRef: dependencyRef =>
            normalizeDirectionalLocalDependencyRef(this, spanRef, dependencyRef)
        })
      : [];
    const fallbackLocalDependencyRefs =
      includeLocalDependencyRefs &&
      localDependencyRefs.length === 0 &&
      rawLocalDependencyRefs.length === 0
        ? getDirectionalLocalDependencyRefsFromTable(this, processId, spanRef, direction)
        : null;
    const resolvedLocalDependencyRefs =
      fallbackLocalDependencyRefs?.slice(0, normalizedLimit) ?? localDependencyRefs;
    const resolvedLocalDependencyRefCount =
      fallbackLocalDependencyRefs?.length ?? rawLocalDependencyRefs.length;
    const remainingDependencyRefLimit = Math.max(
      normalizedLimit - resolvedLocalDependencyRefs.length,
      0
    );
    const rawCrossDependencyRefs =
      sparseCrossDependencyRefs != null
        ? [...sparseCrossDependencyRefs]
        : (tableCrossDependencyRefs ?? rowCrossDependencyRefs ?? []);
    const crossDependencyRefs = getBoundedDirectionalDependencyRefs({
      dependencyRefs: rawCrossDependencyRefs,
      limit: includeLocalDependencyRefs ? remainingDependencyRefLimit : normalizedLimit,
      normalizeDependencyRef: dependencyRef =>
        normalizeDirectionalCrossDependencyRef(this, dependencyRef)
    });
    const totalCount =
      (includeLocalDependencyRefs ? resolvedLocalDependencyRefCount : 0) +
      rawCrossDependencyRefs.length;
    return {
      localDependencyRefs: resolvedLocalDependencyRefs,
      crossDependencyRefs,
      totalCount,
      truncated: totalCount > resolvedLocalDependencyRefs.length + crossDependencyRefs.length
    };
  }

  /** Materializes immediate dependency sources attached to one span in a single direction. */
  getSpanDirectionalDependencySources(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection
  ): readonly TraceDependencySource[] {
    if (this.hasActiveSpanFilter()) {
      const dependencySources: TraceDependencySource[] = [];
      const seenDependencyKeys = new Set<string>();
      for (const dependencyRef of this.getVisibleDependencyRefsForSpan(spanRef)) {
        const dependencySource = this.getVisibleDependencySourceByRef(dependencyRef);
        if (!dependencySource) {
          continue;
        }
        if (
          (direction === 'incoming' && dependencySource.endSpanRef === spanRef) ||
          (direction === 'outgoing' && dependencySource.startSpanRef === spanRef)
        ) {
          const dependencyKey = getTraceDependencySourceRuntimeKey(dependencySource);
          if (seenDependencyKeys.has(dependencyKey)) {
            continue;
          }
          seenDependencyKeys.add(dependencyKey);
          dependencySources.push(dependencySource);
        }
      }
      return dependencySources;
    }

    const dependencyRefs = this.getSpanDirectionalDependencyRefs(spanRef, direction);
    const dependencySources: TraceDependencySource[] = [];
    const seenDependencyKeys = new Set<string>();
    const addDependencySource = (dependencySource: TraceDependencySource | null) => {
      if (
        !dependencySource ||
        dependencySource.startSpanRef == null ||
        dependencySource.endSpanRef == null
      ) {
        return;
      }
      const dependencyKey = getTraceDependencySourceRuntimeKey(dependencySource);
      if (seenDependencyKeys.has(dependencyKey)) {
        return;
      }
      seenDependencyKeys.add(dependencyKey);
      dependencySources.push(dependencySource);
    };

    for (const dependencyRef of dependencyRefs.localDependencyRefs) {
      addDependencySource(this.getVisibleDependencySourceByRef(dependencyRef));
    }
    for (const dependencyRef of dependencyRefs.crossDependencyRefs) {
      addDependencySource(this.getVisibleDependencySourceByRef(dependencyRef));
    }
    return dependencySources;
  }

  /** Resolves the canonical source dependency ref behind one runtime dependency ref. */
  getDependencySourceRefByRef(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): LocalDependencyRef | CrossDependencyRef | null {
    return this.getVisibleDependencySourceRefByRef(dependencyRef);
  }

  /** Returns the canonical source start span ref before visible rewrites. */
  getDependencySourceStartSpan(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): SpanRef | null {
    return this.getDependencySourceSpan(dependencyRef, 'start');
  }

  /** Returns the canonical source end span ref before visible rewrites. */
  getDependencySourceEndSpan(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): SpanRef | null {
    return this.getDependencySourceSpan(dependencyRef, 'end');
  }

  /** Resolves the owning process ref for one exact local dependency ref. */
  getVisibleLocalDependencyProcessRefByRef(
    dependencyRef: LocalDependencyRef | VisibleLocalDependencyRef
  ): ProcessRef | null {
    const processId = this.getRawLocalDependencyProcessIdByRef(dependencyRef);
    return processId ? (this.runtimeEntityRefs.processRefById.get(processId) ?? null) : null;
  }

  /** Resolves one visible dependency id from a compact visible dependency ref. */
  getVisibleDependencyIdByRef(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceDependencyId | null {
    if (isLocalDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef)) {
      return this.getDependencyId(dependencyRef);
    }
    if (isVisibleLocalDependencyRef(dependencyRef)) {
      if (!this.hasActiveSpanFilter()) {
        const sourceRef = this.getUnfilteredVisibleLocalDependencySourceRefByRef(dependencyRef);
        return sourceRef ? this.getDependencyId(sourceRef) : null;
      }
      return (
        this.getVisibleIndex().visibleLocalDependencyIds[
          getVisibleLocalDependencyRefIndex(dependencyRef)
        ] ?? null
      );
    }
    if (isVisibleCrossDependencyRef(dependencyRef)) {
      if (!this.hasActiveSpanFilter()) {
        return this.getDependencyId(
          encodeCrossDependencyRef(getVisibleCrossDependencyRefIndex(dependencyRef))
        );
      }
      return (
        this.getVisibleIndex().visibleCrossDependencyIds[
          getVisibleCrossDependencyRefIndex(dependencyRef)
        ] ?? null
      );
    }
    return null;
  }

  /** Returns visible cross dependency refs in canonical visible order. */
  getVisibleCrossDependencyRefs(): readonly VisibleCrossDependencyRef[] {
    if (!this.hasActiveSpanFilter()) {
      const dependencyRefs: VisibleCrossDependencyRef[] = [];
      for (let rowIndex = 0; rowIndex < this.crossDependencyTable.numRows; rowIndex += 1) {
        dependencyRefs.push(encodeVisibleCrossDependencyRef(rowIndex));
      }
      return dependencyRefs;
    }

    return this.getVisibleIndex().visibleCrossDependencyIds.flatMap((_, dependencyIndex) => [
      encodeVisibleCrossDependencyRef(dependencyIndex)
    ]);
  }

  /** Returns the visible source block id for one dependency ref without materializing it. */
  getVisibleDependencyStartBlockId(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceSpanId | null {
    return getTraceGraphVisibleDependencyStartBlockId(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns the visible destination block id for one dependency ref without materializing it. */
  getVisibleDependencyEndBlockId(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceSpanId | null {
    return getTraceGraphVisibleDependencyEndBlockId(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns the visible source span ref for one dependency ref without materializing it. */
  getVisibleDependencyStartSpan(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): SpanRef | null {
    return getTraceGraphVisibleDependencyStartSpan(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns the visible destination span ref for one dependency ref without materializing it. */
  getVisibleDependencyEndSpan(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): SpanRef | null {
    return getTraceGraphVisibleDependencyEndSpan(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns the wait-mode field for one visible dependency ref without materializing it. */
  getVisibleDependencyWaitMode(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceDependency['waitMode'] | null {
    return getTraceGraphVisibleDependencyWaitMode(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns the bidirectional field for one visible dependency ref without materializing it. */
  getVisibleDependencyBidirectional(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): boolean | null {
    return getTraceGraphVisibleDependencyBidirectional(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns the wait duration for one visible dependency ref without materializing it. */
  getVisibleDependencyWaitTimeMs(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): number | null {
    return getTraceGraphVisibleDependencyWaitTimeMs(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns whether one visible dependency should route as a parent-child edge. */
  getVisibleDependencyIsParent(dependencyRef: TraceDependencyRef | VisibleDependencyRef): boolean {
    return getTraceGraphVisibleDependencyIsParent(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns keyword labels for one visible dependency ref without materializing it. */
  getVisibleDependencyKeywords(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): ReadonlySet<string> {
    return getTraceGraphVisibleDependencyKeywords(
      this,
      dependencyRef,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Returns whether one visible dependency has a keyword without materializing it. */
  getVisibleDependencyHasKeyword(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef,
    keyword: string
  ): boolean {
    return getTraceGraphVisibleDependencyHasKeyword(
      this,
      dependencyRef,
      keyword,
      this.getVisibleDependencySourceRefByRef,
      this.getVisibleDependencyOverrideSpec
    );
  }

  /** Resolves minimal selected local-dependency overlay sources from compact refs. */
  getVisibleSelectedLocalDependencySources(
    dependencyRefs: readonly VisibleLocalDependencyRef[],
    selectedDirection?: TraceSelectedDependencyDirection
  ): TraceGraphSelectedLocalDependencySource[] {
    return dependencyRefs.flatMap(dependencyRef => {
      const source = getVisibleSelectedLocalDependencySource({
        traceGraph: this,
        dependencyRef,
        selectedDirection
      });
      return source ? [source] : [];
    });
  }

  /** Resolves minimal selected cross-dependency overlay sources from compact refs. */
  getVisibleSelectedCrossDependencySources(
    dependencyRefs: readonly VisibleCrossDependencyRef[],
    selectedDirection?: TraceSelectedDependencyDirection
  ): TraceGraphSelectedCrossDependencySource[] {
    return dependencyRefs.flatMap(dependencyRef => {
      const source = getVisibleSelectedCrossDependencySource({
        traceGraph: this,
        dependencyRef,
        selectedDirection
      });
      return source ? [source] : [];
    });
  }

  /** Returns visible path spans and dependencies for the supplied path definitions. */
  getVisiblePathData(paths: readonly TracePath[]): {
    /** Visible path block sources resolved in the order requested by the path input. */
    pathBlockSources: TraceGraphPathBlockSource[];
    /** Visible path dependency sources resolved in the order requested by the path input. */
    pathDependencySources: TraceGraphPathDependencySource[];
  } {
    const pathBlockSources = paths.flatMap(path =>
      getVisiblePathBlockSources({
        path,
        traceGraph: this
      })
    );
    const pathDependencySources = paths.flatMap(path =>
      getVisiblePathDependencySources({
        path,
        traceGraph: this
      })
    );
    return {
      pathBlockSources,
      pathDependencySources
    };
  }

  /** Returns the owning process ref for one canonical thread ref when it exists. */
  getProcessRefByThreadRef(threadRef: ThreadRef): ProcessRef | null {
    return this.chunkRegistry.getProcessRefByRef(threadRef);
  }

  /** Returns canonical thread refs for one owning process ref in thread order. */
  getThreadRefsByProcessRef(processRef: ProcessRef): ReadonlyArray<ThreadRef> {
    return this.runtimeEntityRefs.threadRefsByProcessRef.get(processRef) ?? [];
  }

  /** Returns all graph-global event sources in canonical graph order. */
  getEventSources(): ReadonlyArray<TraceEventSource> {
    const entitySourceCache = this.getEntitySourceCache();
    if (!entitySourceCache.eventSources) {
      entitySourceCache.eventSources = this.runtimeEntityRefs.eventRefs.flatMap(eventRef => {
        const eventId = this.runtimeEntityRefs.eventIdByRef.get(eventRef) ?? null;
        const event = eventId ? this.eventMap[eventId] : null;
        return event
          ? [
              {
                type: 'trace-event',
                eventRef,
                eventId: event.eventId,
                name: event.name,
                atTimeMs: event.atTimeMs,
                userData: event.userData
              } satisfies TraceEventSource
            ]
          : [];
      });
    }
    return entitySourceCache.eventSources;
  }

  /** Returns all instant sources in canonical graph order. */
  getInstantSources(): ReadonlyArray<TraceInstantSource> {
    this.ensureInstantSources();
    return this.getEntitySourceCache().instantSources ?? [];
  }

  /** Returns all instant sources grouped under one canonical thread ref. */
  getInstantSourcesByThreadRef(threadRef: ThreadRef): ReadonlyArray<TraceInstantSource> {
    this.ensureInstantSources();
    return this.getEntitySourceCache().instantSourcesByThreadRef?.get(threadRef) ?? [];
  }

  /** Returns all counter sources in canonical graph order. */
  getCounterSources(): ReadonlyArray<TraceCounterSource> {
    this.ensureCounterSources();
    return this.getEntitySourceCache().counterSources ?? [];
  }

  /** Returns all counter sources grouped under one canonical thread ref. */
  getCounterSourcesByThreadRef(threadRef: ThreadRef): ReadonlyArray<TraceCounterSource> {
    this.ensureCounterSources();
    return this.getEntitySourceCache().counterSourcesByThreadRef?.get(threadRef) ?? [];
  }

  /** Returns the counter value extent for one canonical thread ref. */
  getCounterExtentByThreadRef(threadRef: ThreadRef): Readonly<{min: number; max: number}> {
    const entitySourceCache = this.getEntitySourceCache();
    if (!entitySourceCache.counterExtentByThreadRef) {
      const extents = new Map<ThreadRef, {min: number; max: number}>();
      for (const threadRefFromId of this.getThreadRefs()) {
        const counterSources = this.getCounterSourcesByThreadRef(threadRefFromId);
        if (counterSources.length === 0) {
          continue;
        }

        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const counterSource of counterSources) {
          min = Math.min(min, counterSource.totalValue);
          max = Math.max(max, counterSource.totalValue);
        }
        extents.set(threadRefFromId, {min, max});
      }
      entitySourceCache.counterExtentByThreadRef = extents;
    }
    return entitySourceCache.counterExtentByThreadRef.get(threadRef) ?? {min: 0, max: 0};
  }

  /** Returns cached filtered span counts grouped by canonical thread ref. */
  getFilteredSpanCountByThreadRef(): ReadonlyMap<ThreadRef, number> {
    if (!this.filteredSpanCountByThreadRefCache) {
      this.filteredSpanCountByThreadRefCache =
        this.hasActiveGraphSpanFilter() && !this.hasActiveTraceStoreSpanFilter()
          ? buildGraphFilteredSpanCountByThreadRef(this)
          : buildFilteredSpanCountByThreadRefBySpanScan(this);
    }
    return this.filteredSpanCountByThreadRefCache;
  }

  /** Returns cached search records for spans that remain visible after filtering. */
  getVisibleBlockSearchRecords(): ReadonlyArray<TraceGraphVisibleSpanSearchRecord> {
    if (!this.visibleBlockSearchRecordsCache) {
      const records: TraceGraphVisibleSpanSearchRecord[] = [];
      this.searchVisibleBlockRecords(
        () => true,
        record => {
          records.push(record);
        }
      );
      this.visibleBlockSearchRecordsCache = records;
    }

    return this.visibleBlockSearchRecordsCache;
  }

  /**
   * Scans all span names, including filtered spans, and visits matching search records.
   *
   * Filtered matches carry provenance without replacing the selected span.
   *
   * @returns Number of matching records visited before the callback, limit, or table scan stopped.
   */
  searchBlockRecords(
    matchesSearchText: (searchText: string) => boolean,
    visitRecord: (record: TraceGraphSpanSearchRecord) => boolean | void,
    limit = Number.POSITIVE_INFINITY
  ): number {
    if (this.spanRefs) {
      return searchLoadedChunkSpanRecords(this, {
        matchesSearchText,
        visitRecord,
        limit,
        getSearchText: displaySource => displaySource.name.toLowerCase()
      });
    }

    return searchTraceGraphBlockRecordsWithOptions(this, {
      processRefs: this.getProcessRefs(),
      getProcessIdByRef: processRef => this.getRawProcessIdByRef(processRef),
      matchesSearchText,
      visitRecord,
      limit,
      buildRecord: record => {
        const filterReason = this.spanFilterReason(record.spanRef);
        return {
          ...record,
          filterMask: filterReason.filterMask,
          filterReason
        };
      }
    });
  }

  /** Scans all loaded chunks or store rows and visits matching search records. */
  searchSpans(
    matchesSearchText: (searchText: string) => boolean,
    visitRecord: (record: TraceGraphSpanSearchRecord) => boolean | void,
    limit = Number.POSITIVE_INFINITY
  ): number {
    const resultLimit = Math.max(0, limit);
    if (resultLimit === 0) {
      return 0;
    }

    if (this.traceStore?.searchSpans) {
      const records = this.traceStore.searchSpans({
        traceGraph: this,
        matchesSearchText,
        limit: resultLimit
      });
      let visitedCount = 0;
      for (const record of records) {
        visitedCount += 1;
        if (visitRecord(record) === false || visitedCount >= resultLimit) {
          return visitedCount;
        }
      }
      return visitedCount;
    }

    return searchLoadedChunkSpanRecords(this, {
      matchesSearchText,
      visitRecord,
      limit: resultLimit
    });
  }

  /**
   * Scans visible span names and visits matching search records without caching all visible spans.
   *
   * The matcher receives lowercase block-name text before a rich search record is materialized, so
   * query paths can scan large traces without retaining one object per visible span.
   *
   * @returns Number of matching records visited before the callback, limit, or table scan stopped.
   */
  searchVisibleBlockRecords(
    matchesSearchText: (searchText: string) => boolean,
    visitRecord: (record: TraceGraphVisibleSpanSearchRecord) => boolean | void,
    limit = Number.POSITIVE_INFINITY
  ): number {
    const visibleIndex = this.hasActiveSpanFilter() ? this.getVisibleIndex() : null;
    return searchTraceGraphBlockRecordsWithOptions(this, {
      processRefs: this.getVisibleProcessRefs(),
      getProcessIdByRef: processRef => this.getRawProcessIdByRef(processRef),
      matchesSearchText,
      visitRecord,
      limit,
      getRowIndexes: (typedProcessId, spanTable) =>
        visibleIndex?.visibleBlockTablesByProcessId[typedProcessId]?.indexes ?? spanTable.numRows,
      buildRecord: record => record
    });
  }

  /** Returns cached visible dependency and endpoint projections. */
  getProjection(): TraceGraphProjection {
    if (!this.traceGraphProjectionCache) {
      const buildStartTime = performance.now();
      const hasActiveSpanFilter = this.hasActiveSpanFilter();
      log.probe(0, 'TraceGraph projection start', {
        name: this.name,
        hasActiveSpanFilter,
        spanCount: this.stats.spanCount,
        localDependencyCount: this.stats.localDependencyCount,
        crossDependencyCount: this.stats.crossDependencyCount,
        ...getHeapUsageProbeFields()
      })();
      this.traceGraphProjectionCache = buildTraceGraphProjection(this);
      log.probe(0, 'TraceGraph projection built', {
        name: this.name,
        hasActiveSpanFilter,
        spanCount: this.stats.spanCount,
        dependencyCount: this.stats.localDependencyCount + this.stats.crossDependencyCount,
        durationMs: performance.now() - buildStartTime,
        unfilteredCallerStack: !hasActiveSpanFilter
          ? new Error().stack?.split('\n').slice(2, 10)
          : undefined,
        ...getHeapUsageProbeFields()
      })();
    }
    return this.traceGraphProjectionCache;
  }

  /** Returns cached source-graph dependency and endpoint projections. */
  getSourceProjection(): TraceGraphProjection {
    if (!this.sourceTraceGraphProjectionCache) {
      const buildStartTime = performance.now();
      const hasActiveSpanFilter = this.hasActiveSpanFilter();
      log.probe(0, 'TraceGraph source projection start', {
        name: this.name,
        hasActiveSpanFilter,
        spanCount: this.stats.spanCount,
        localDependencyCount: this.stats.localDependencyCount,
        crossDependencyCount: this.stats.crossDependencyCount,
        ...getHeapUsageProbeFields()
      })();
      this.sourceTraceGraphProjectionCache = buildSourceTraceGraphProjection(this);
      log.probe(0, 'TraceGraph source projection built', {
        name: this.name,
        hasActiveSpanFilter,
        spanCount: this.stats.spanCount,
        dependencyCount: this.stats.localDependencyCount + this.stats.crossDependencyCount,
        durationMs: performance.now() - buildStartTime,
        unfilteredCallerStack: !hasActiveSpanFilter
          ? new Error().stack?.split('\n').slice(2, 10)
          : undefined,
        ...getHeapUsageProbeFields()
      })();
    }
    return this.sourceTraceGraphProjectionCache;
  }

  /** Returns cached compact visible indexes used by filtered selection and layout consumers. */
  getVisibleIndex(): TraceGraphVisibleIndex {
    if (!this.visibleIndexCache) {
      const visibleIndexStartTime = performance.now();
      log.probe(0, 'TraceGraph visible index start', {
        name: this.name,
        spanCount: this.stats.spanCount,
        crossDependencyCount: this.crossDependencyTable.numRows,
        hasActiveSpanFilter: this.hasActiveSpanFilter(),
        unfilteredCallerStack: !this.hasActiveSpanFilter()
          ? new Error().stack?.split('\n').slice(2, 10)
          : undefined
      })();
      this.visibleIndexCache = buildVisibleIndex(this);
      log.probe(0, 'TraceGraph visible index cached', {
        name: this.name,
        visibleSpanCount: this.visibleIndexCache.visibleSpanRefSet.size,
        visibleDependencyCount: this.visibleIndexCache.visibleDependencyIdSet.size,
        durationMs: performance.now() - visibleIndexStartTime
      })();
    }
    return this.visibleIndexCache;
  }

  /** Adds canonical process/thread refs to one visible dependency source when resolvable. */
  private withRuntimeDependencySourceRefs<T extends TraceDependencySource>(
    source: T | null
  ): T | null {
    if (!source) {
      return null;
    }

    const processId =
      source.processRef == null && source.dependencyRef != null
        ? this.getRawLocalDependencyProcessIdByRef(source.dependencyRef)
        : null;
    const processRef =
      source.processRef ??
      (processId ? this.runtimeEntityRefs.processRefById.get(processId) : undefined);
    const startThreadRef =
      source.startThreadRef ??
      (source.startSpanRef != null
        ? (this.getThreadRefBySpanRef(source.startSpanRef) ?? undefined)
        : undefined);
    const endThreadRef =
      source.endThreadRef ??
      (source.endSpanRef != null
        ? (this.getThreadRefBySpanRef(source.endSpanRef) ?? undefined)
        : undefined);
    if (processRef == null && startThreadRef == null && endThreadRef == null) {
      return source;
    }

    return {
      ...source,
      processRef,
      startThreadRef,
      endThreadRef
    } satisfies T;
  }

  /** Returns the owned visible runtime cache, creating the root container on first access. */
  private getVisibleRuntimeCache(): TraceGraphVisibleRuntimeCache {
    if (!this.visibleRuntimeCache) {
      this.visibleRuntimeCache = {
        processEntriesByRef: new Map(),
        dependencySourcesByRef: new Map()
      };
    }

    return this.visibleRuntimeCache;
  }

  /** Returns one process-scoped visible runtime cache entry when the process ref is valid. */
  private getVisibleProcessCacheEntry(
    processRef: ProcessRef
  ): TraceGraphVisibleProcessCacheEntry | null {
    const processId = this.getRawProcessIdByRef(processRef);
    if (!processId) {
      return null;
    }

    let visibleRuntimeCache = this.getVisibleRuntimeCache();
    const cachedEntry = visibleRuntimeCache.processEntriesByRef.get(processRef);
    if (cachedEntry) {
      if (this.canReuseVisibleProcessCacheEntry(cachedEntry, processId)) {
        return cachedEntry;
      }
      this.clearVisibleRuntimeMaterializationCaches();
      visibleRuntimeCache = this.getVisibleRuntimeCache();
    }

    const entry = this.createVisibleProcessCacheEntry(processId);
    visibleRuntimeCache.processEntriesByRef.set(processRef, entry);
    return entry;
  }

  /** Builds one empty process-scoped visible cache entry from current SpanRef source state. */
  private createVisibleProcessCacheEntry(
    processId: TraceProcessId
  ): TraceGraphVisibleProcessCacheEntry {
    const spanTable = this.processSpanTableMap[processId] ?? null;
    const activeSpanRefs = this.spanRefs ?? null;
    return {
      processId,
      spanTable,
      spanTableRowCount: spanTable?.numRows ?? 0,
      spanTableGeneration: spanTable?.generation ?? null,
      activeSpanRefs,
      activeSpanRefCount: activeSpanRefs?.length ?? 0,
      firstActiveSpanRef: activeSpanRefs?.[0] ?? null,
      lastActiveSpanRef: activeSpanRefs?.[activeSpanRefs.length - 1] ?? null
    };
  }

  /** Returns whether cached process materializations still match current SpanRef source state. */
  private canReuseVisibleProcessCacheEntry(
    processEntry: TraceGraphVisibleProcessCacheEntry,
    processId: TraceProcessId
  ): boolean {
    const spanTable = this.processSpanTableMap[processId] ?? null;
    const activeSpanRefs = this.spanRefs ?? null;
    return (
      processEntry.spanTable === spanTable &&
      processEntry.spanTableRowCount === (spanTable?.numRows ?? 0) &&
      processEntry.spanTableGeneration === (spanTable?.generation ?? null) &&
      processEntry.activeSpanRefs === activeSpanRefs &&
      processEntry.activeSpanRefCount === (activeSpanRefs?.length ?? 0) &&
      processEntry.firstActiveSpanRef === (activeSpanRefs?.[0] ?? null) &&
      processEntry.lastActiveSpanRef === (activeSpanRefs?.[activeSpanRefs.length - 1] ?? null)
    );
  }

  /** Clears visible/runtime materializations that retain process-local SpanRef-derived rows. */
  private clearVisibleRuntimeMaterializationCaches(): void {
    this.filteredSpanCountByThreadRefCache = undefined;
    this.sourceTraceGraphProjectionCache = undefined;
    this.traceGraphProjectionCache = undefined;
    this.visibleIndexCache = undefined;
    this.visibleRuntimeCache = undefined;
    this.visibleBlockSearchRecordsCache = undefined;
    this.entitySourceCache = undefined;
    this.unfilteredVisibleLaneLayoutInfoCache = undefined;
  }

  /** Returns active process refs in owner-ref order. */
  private getActiveSpanProcessRefs(): ReadonlyArray<ProcessRef> {
    const activeProcessRefs = new Set<ProcessRef>();
    for (const spanRef of this.spanRefs ?? []) {
      const processRef = this.chunkRegistry.getProcessRefByRef(spanRef);
      if (processRef != null) {
        activeProcessRefs.add(processRef);
      }
    }
    return this.getProcessRefs().filter(processRef => activeProcessRefs.has(processRef));
  }

  /** Resolves one exact span ref from a materialized block carrying owner context. */
  private resolveSpanRefForBlock(
    block: Readonly<Pick<TraceSpan, 'spanId' | 'threadId'>>
  ): SpanRef | null {
    return getSelectedCardSpanRef(this, block);
  }

  /** Returns the owned entity-source cache, creating process and thread maps on first access. */
  private getEntitySourceCache(): TraceGraphEntitySourceCache {
    if (!this.entitySourceCache) {
      const processSourcesByRef = new Map<ProcessRef, TraceProcessSource>();
      const threadSourcesByRef = new Map<ThreadRef, TraceThreadSource>();
      const threadSourcesByProcessRef = new Map<ProcessRef, readonly TraceThreadSource[]>();
      const processMetadataById = new Map(
        this.processes.map(process => [process.processId as TraceProcessId, process] as const)
      );

      for (const processRef of this.getProcessRefs()) {
        const processId = this.getRawProcessIdByRef(processRef);
        const process = processId ? (processMetadataById.get(processId) ?? null) : null;
        if (!processId || !process) {
          continue;
        }

        processSourcesByRef.set(processRef, {
          processRef,
          name: process.name,
          rankNum: process.rankNum,
          processOrder: process.processOrder,
          userData: process.userData
        } satisfies TraceProcessSource);

        const threadSources = this.getThreadRefsByProcessRef(processRef).flatMap(threadRef => {
          const rawThread = this.getRawThreadByRef(threadRef);
          if (!rawThread) {
            return [];
          }

          const threadSource = {
            threadRef,
            processRef,
            threadId: rawThread.threadId,
            name: rawThread.name,
            userData: rawThread.userData
          } satisfies TraceThreadSource;
          threadSourcesByRef.set(threadRef, threadSource);
          return [threadSource];
        });
        threadSourcesByProcessRef.set(processRef, threadSources);
      }

      this.entitySourceCache = {
        processSourcesByRef,
        threadSourcesByRef,
        threadSourcesByProcessRef
      };
    }

    return this.entitySourceCache;
  }

  /** Builds instant sources plus thread-grouped instant sources in one pass when needed. */
  private ensureInstantSources(): void {
    const entitySourceCache = this.getEntitySourceCache();
    if (entitySourceCache.instantSources && entitySourceCache.instantSourcesByThreadRef) {
      return;
    }

    const instantSources: TraceInstantSource[] = [];
    const instantSourcesByThreadRef = new Map<ThreadRef, TraceInstantSource[]>();
    for (const instantRef of this.runtimeEntityRefs.instantRefs) {
      const instantId = this.runtimeEntityRefs.instantIdByRef.get(instantRef) ?? null;
      const instant = instantId ? this.instantMap[instantId] : null;
      const threadRef = this.runtimeEntityRefs.threadRefByInstantRef.get(instantRef);
      const processRef = this.runtimeEntityRefs.processRefByInstantRef.get(instantRef);
      if (!instant || threadRef == null || processRef == null) {
        continue;
      }

      const instantSource = {
        instantRef,
        processRef,
        threadRef,
        instantId: instant.instantId,
        threadId: instant.threadId,
        name: instant.name,
        atTimeMs: instant.atTimeMs,
        scope: instant.scope,
        userData: instant.userData
      } satisfies TraceInstantSource;
      instantSources.push(instantSource);
      const threadInstants = instantSourcesByThreadRef.get(threadRef) ?? [];
      threadInstants.push(instantSource);
      instantSourcesByThreadRef.set(threadRef, threadInstants);
    }

    entitySourceCache.instantSources = instantSources;
    entitySourceCache.instantSourcesByThreadRef = instantSourcesByThreadRef;
  }

  /** Builds counter sources plus thread-grouped counter sources in one pass when needed. */
  private ensureCounterSources(): void {
    const entitySourceCache = this.getEntitySourceCache();
    if (entitySourceCache.counterSources && entitySourceCache.counterSourcesByThreadRef) {
      return;
    }

    const counterSources: TraceCounterSource[] = [];
    const counterSourcesByThreadRef = new Map<ThreadRef, TraceCounterSource[]>();
    for (const counterRef of this.runtimeEntityRefs.counterRefs) {
      const counterId = this.runtimeEntityRefs.counterIdByRef.get(counterRef) ?? null;
      const counter = counterId ? this.counterMap[counterId] : null;
      const threadRef = this.runtimeEntityRefs.threadRefByCounterRef.get(counterRef);
      const processRef = this.runtimeEntityRefs.processRefByCounterRef.get(counterRef);
      if (!counter || threadRef == null || processRef == null) {
        continue;
      }

      const counterSource = {
        counterRef,
        processRef,
        threadRef,
        counterId: counter.counterId,
        threadId: counter.threadId,
        name: counter.name,
        atTimeMs: counter.atTimeMs,
        totalValue: counter.totalValue,
        series: counter.series,
        userData: counter.userData
      } satisfies TraceCounterSource;
      counterSources.push(counterSource);
      const threadCounters = counterSourcesByThreadRef.get(threadRef) ?? [];
      threadCounters.push(counterSource);
      counterSourcesByThreadRef.set(threadRef, threadCounters);
    }

    entitySourceCache.counterSources = counterSources;
    entitySourceCache.counterSourcesByThreadRef = counterSourcesByThreadRef;
  }

  /** Returns one raw ingestion process id for a canonical runtime process ref. */
  private getRawProcessIdByRef(processRef: ProcessRef): TraceProcessId | null {
    return this.runtimeEntityRefs.processIdByRef.get(processRef) ?? null;
  }

  /** Returns one raw ingestion thread for a canonical runtime thread ref. */
  private getRawThreadByRef(threadRef: ThreadRef): TraceThread | null {
    const threadId = this.runtimeEntityRefs.threadIdByRef.get(threadRef) ?? null;
    const processRef = this.getProcessRefByThreadRef(threadRef);
    const processId = processRef == null ? null : this.getRawProcessIdByRef(processRef);
    const process = processId ? this.processes.find(entry => entry.processId === processId) : null;
    return threadId && process ? (process.threadMap[threadId] ?? null) : null;
  }

  /** Returns one raw owning process id for an exact visible local dependency ref. */
  private getRawVisibleLocalDependencyProcessIdByRef(
    dependencyRef: VisibleLocalDependencyRef
  ): TraceProcessId | null {
    return this.getVisibleIndex().visibleLocalDependencyProcessIdByRef.get(dependencyRef) ?? null;
  }

  /** Returns one raw owning process id for an exact local dependency ref. */
  private getRawLocalDependencyProcessIdByRef(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceProcessId | null {
    if (isLocalDependencyRef(dependencyRef)) {
      return this.processIdsByIndex[getLocalDependencyRefProcessIndex(dependencyRef)] ?? null;
    }
    if (!isVisibleLocalDependencyRef(dependencyRef)) {
      return null;
    }
    if (!this.hasActiveSpanFilter()) {
      const sourceDependencyRef =
        this.getUnfilteredVisibleLocalDependencySourceRefByRef(dependencyRef);
      return sourceDependencyRef == null
        ? null
        : (this.processIdsByIndex[getLocalDependencyRefProcessIndex(sourceDependencyRef)] ?? null);
    }
    return this.getRawVisibleLocalDependencyProcessIdByRef(dependencyRef);
  }

  /** Resolves the source Arrow dependency ref behind one visible dependency ref. */
  private getVisibleDependencySourceRefByRef(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): LocalDependencyRef | CrossDependencyRef | null {
    if (isLocalDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef)) {
      return dependencyRef;
    }
    if (!isLegacyVisibleDependencyRef(dependencyRef)) {
      return null;
    }
    if (!this.hasActiveSpanFilter() && isVisibleLocalDependencyRef(dependencyRef)) {
      return this.getUnfilteredVisibleLocalDependencySourceRefByRef(dependencyRef);
    }
    if (!this.hasActiveSpanFilter() && isVisibleCrossDependencyRef(dependencyRef)) {
      return encodeCrossDependencyRef(getVisibleCrossDependencyRefIndex(dependencyRef));
    }

    const visibleIndex = this.getVisibleIndex();
    if (isVisibleLocalDependencyRef(dependencyRef)) {
      return (
        visibleIndex.visibleLocalDependencySourceRefs[
          getVisibleLocalDependencyRefIndex(dependencyRef)
        ] ?? null
      );
    }
    if (isVisibleCrossDependencyRef(dependencyRef)) {
      return (
        visibleIndex.visibleCrossDependencySourceRefs[
          getVisibleCrossDependencyRefIndex(dependencyRef)
        ] ?? null
      );
    }
    return null;
  }

  /** Resolves one canonical visible dependency ref from a source or visible dependency ref. */
  private getVisibleDependencyRefByRef(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): VisibleDependencyRef | null {
    if (isVisibleLocalDependencyRef(dependencyRef) || isVisibleCrossDependencyRef(dependencyRef)) {
      return dependencyRef;
    }
    if (isLocalDependencyRef(dependencyRef)) {
      return this.getVisibleLocalDependencyRefBySourceRef(dependencyRef);
    }
    if (isCrossDependencyRef(dependencyRef)) {
      return this.getVisibleCrossDependencyRefBySourceRef(dependencyRef);
    }
    return null;
  }

  /** Resolves visible cross-rank numbers without decoding descriptive dependency fields. */
  private getVisibleCrossDependencyRankNums(
    dependencyRef: VisibleCrossDependencyRef
  ): Pick<TraceCrossDependencyRenderSource, 'startRankNum' | 'endRankNum'> | null {
    const override = this.getVisibleDependencyOverrideSpec(dependencyRef);
    if (override?.kind === 'cross-parent') {
      return {
        startRankNum: override.startRankNum,
        endRankNum: override.endRankNum
      };
    }

    const sourceDependencyRef = this.getVisibleDependencySourceRefByRef(dependencyRef);
    if (sourceDependencyRef == null || !isCrossDependencyRef(sourceDependencyRef)) {
      return null;
    }
    const startRankNum = this.getCrossDependencyStartRankNum(sourceDependencyRef);
    const endRankNum = this.getCrossDependencyEndRankNum(sourceDependencyRef);
    return startRankNum == null || endRankNum == null ? null : {startRankNum, endRankNum};
  }

  /** Returns one original dependency endpoint span ref before visible rewrites. */
  private getDependencySourceSpan(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef,
    endpoint: 'start' | 'end'
  ): SpanRef | null {
    const override = this.getVisibleDependencyOverrideSpec(dependencyRef);
    if (override?.kind === 'cross-parent') {
      const sourceSpanRef =
        endpoint === 'start' ? override.sourceStartSpanRef : override.sourceEndSpanRef;
      if (sourceSpanRef != null) {
        return sourceSpanRef;
      }
    }

    const sourceDependencyRef = this.getVisibleDependencySourceRefByRef(dependencyRef);
    if (sourceDependencyRef != null) {
      return endpoint === 'start'
        ? this.getDependencyStartSpan(sourceDependencyRef)
        : this.getDependencyEndSpan(sourceDependencyRef);
    }

    return null;
  }

  /** Resolves the compact visible override attached to one visible dependency ref. */
  private getVisibleDependencyOverrideSpec(
    dependencyRef: TraceDependencyRef | VisibleDependencyRef
  ): TraceGraphVisibleDependencyOverride | null {
    if (!this.hasActiveSpanFilter() || !isLegacyVisibleDependencyRef(dependencyRef)) {
      return null;
    }

    return this.getVisibleIndex().dependencyOverrideSpecsByRef.get(dependencyRef) ?? null;
  }

  /** Ensures unfiltered visible local dependency process offsets are available. */
  private ensureUnfilteredVisibleLocalDependencyStartIndexes(): ReadonlyMap<
    TraceProcessId,
    number
  > {
    const visibleRuntimeCache = this.getVisibleRuntimeCache();
    if (visibleRuntimeCache.unfilteredLocalDependencyStartIndexByProcessId) {
      return visibleRuntimeCache.unfilteredLocalDependencyStartIndexByProcessId;
    }

    const startIndexByProcessId = new Map<TraceProcessId, number>();
    let nextStartIndex = 0;
    this.processes.forEach(process => {
      const processId = process.processId as TraceProcessId;
      const table = this.localDependencyTableMap[processId];
      startIndexByProcessId.set(processId, nextStartIndex);
      nextStartIndex += table?.numRows ?? 0;
    });

    visibleRuntimeCache.unfilteredLocalDependencyStartIndexByProcessId = startIndexByProcessId;
    return startIndexByProcessId;
  }

  /** Returns the first unfiltered visible local dependency index for one process id. */
  private getUnfilteredVisibleLocalDependencyStartIndex(processId: TraceProcessId): number | null {
    return this.ensureUnfilteredVisibleLocalDependencyStartIndexes().get(processId) ?? null;
  }

  /** Maps an unfiltered visible local dependency ref to its canonical Arrow source ref. */
  private getUnfilteredVisibleLocalDependencySourceRefByRef(
    dependencyRef: VisibleLocalDependencyRef
  ): LocalDependencyRef | null {
    return getTraceGraphUnfilteredVisibleLocalDependencySourceRefByRef(
      this,
      this.ensureUnfilteredVisibleLocalDependencyStartIndexes(),
      dependencyRef
    );
  }

  /** Builds one unfiltered local dependency source directly from its Arrow source ref. */
  private buildUnfilteredLocalDependencySourceByRef(
    dependencyRef: LocalDependencyRef
  ): TraceLocalDependencySource | null {
    return buildTraceGraphUnfilteredLocalDependencySourceByRef(this, dependencyRef);
  }
}

const EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REF_BUCKETS = {
  ...EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REFS,
  totalCount: 0,
  truncated: false
} satisfies TraceSpanDirectionalDependencyRefBuckets;

/** Caps normalized dependency refs while stopping before unneeded refs are expanded. */
function getBoundedDirectionalDependencyRefs<TDependencyRef>(params: {
  /** Raw dependency refs read from sidecar storage. */
  dependencyRefs: readonly number[];
  /** Maximum normalized refs to retain. */
  limit: number;
  /** Ref normalizer that may drop malformed raw refs. */
  normalizeDependencyRef: (dependencyRef: number) => readonly TDependencyRef[];
}): TDependencyRef[] {
  const dependencyRefs: TDependencyRef[] = [];
  for (const dependencyRef of params.dependencyRefs) {
    if (dependencyRefs.length >= params.limit) {
      break;
    }
    for (const normalizedDependencyRef of params.normalizeDependencyRef(dependencyRef)) {
      if (dependencyRefs.length >= params.limit) {
        break;
      }
      dependencyRefs.push(normalizedDependencyRef);
    }
  }
  return dependencyRefs;
}

/** Normalizes finite dependency caps while preserving explicit unbounded callers. */
function normalizeDependencyRefLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
}

/** Builds one collision-safe dedupe key for a runtime dependency source. */
function getTraceDependencySourceRuntimeKey(dependencySource: TraceDependencySource): string {
  if (dependencySource.dependencyRef == null) {
    throw new Error(`Expected ref-native dependency source for ${dependencySource.dependencyId}`);
  }
  return `${dependencySource.type}:ref:${String(dependencySource.dependencyRef)}`;
}

/**
 * Scans one process-local dependency table when row sidecars do not carry directional refs.
 */
function getDirectionalLocalDependencyRefsFromTable(
  traceGraph: Readonly<TraceGraph>,
  processId: TraceProcessId,
  spanRef: SpanRef,
  direction: TraceSpanDependencyDirection
): LocalDependencyRef[] {
  const processIndex = traceGraph.processIdsByIndex.indexOf(processId);
  const dependencyTable = traceGraph.localDependencyTableMap[processId];
  if (processIndex < 0 || !dependencyTable) {
    return [];
  }

  const dependencyRefs: LocalDependencyRef[] = [];
  for (let rowIndex = 0; rowIndex < dependencyTable.numRows; rowIndex += 1) {
    const dependencyRef = encodeLocalDependencyRef(encodeLocalSpanRef(processIndex, rowIndex));
    const dependencySpanRef =
      direction === 'incoming'
        ? traceGraph.getDependencyEndSpan(dependencyRef)
        : traceGraph.getDependencyStartSpan(dependencyRef);
    if (dependencySpanRef === spanRef) {
      dependencyRefs.push(dependencyRef);
    }
  }

  return dependencyRefs;
}
