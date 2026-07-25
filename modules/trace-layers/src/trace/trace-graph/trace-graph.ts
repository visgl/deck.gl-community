import {buildTraceGraphMetadataMaps} from '../ingestion/arrow-trace';
import {getHeapUsageProbeFields, log} from '../log';
import {
  getArrowTraceSpanField,
  getTraceGraphSpanAttribute,
  getTraceGraphSpanDetailSource,
  getTraceGraphSpanExternalSpanId,
  getTraceGraphSpanGeometrySource,
  getTraceGraphSpanLaneSource,
  getTraceGraphSpanRefProcessId,
  getTraceGraphSpanUserData,
  getUniqueTraceGraphSpanRef,
  hasTraceGraphSpanAttribute,
  isTraceGraphSpanRefActive,
  iterateTraceGraphProcessSpanRefs
} from '../trace-graph-accessors';
import {buildTraceViewSnapshot, getTraceViewSpanFilterMask} from '../trace-view-snapshot';
import {buildTraceChunkRegistry} from './trace-chunk-registry';
import {getArrowTraceSpanLaneValue} from './trace-graph-arrow-fields';
import {
  buildTraceGraphUnfilteredSameProcessDependencySourceByRef,
  getTraceGraphCrossProcessDependencyEndpointId,
  getTraceGraphCrossProcessDependencyEndRankNum,
  getTraceGraphCrossProcessDependencyStartRankNum,
  getTraceGraphCrossProcessDependencyTopology,
  getTraceGraphCrossProcessDependencyWaiting,
  getTraceGraphCrossProcessDependencyWaitNotFinished,
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
  getTraceGraphDependencyWaitTimeMs
} from './trace-graph-dependency-accessors';
import {getDirectParentSpanRefMap, isValidSourceSpanRef} from './trace-graph-internal-helpers';
import {
  EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REFS,
  getTraceGraphProcessLaneAssignmentMode,
  normalizeArrowRefNumber,
  normalizeDirectionalSameProcessDependencyRef
} from './trace-graph-runtime-helpers';
import {
  getFirstVisibleSearchDescendantSpanRef,
  searchTraceGraphBlockRecordsWithOptions
} from './trace-graph-search-records';
import {
  getVisiblePathBlockSources,
  getVisiblePathDependencySources,
  isVisibleSpanRef
} from './trace-graph-selection-utils';
import {getTraceGraphSpanFilterReason} from './trace-graph-span-filter-reason';
import {buildCompiledTraceSpanFilterPlan} from './trace-graph-span-filters';
import {searchLoadedChunkSpanRecords} from './trace-graph-span-search';
import {TRACE_SPAN_FILTER_MASK_NONE} from './trace-graph-types';
import {
  decodeTraceRef,
  encodeCrossProcessDependencyRef,
  encodeLocalSpanRef,
  encodeSameProcessDependencyRef,
  getProcessRefIndex,
  getSameProcessDependencyRefProcessIndex,
  isCrossProcessDependencyRef,
  isSameProcessDependencyRef
} from './trace-id-encoder';
import {buildTraceRuntimeEntityRefs} from './trace-runtime-entity-refs';

import type {
  ArrowTraceChunk,
  ArrowTraceCrossProcessDependencyTable,
  ArrowTraceEventTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable,
  ArrowTraceSpanSidecarTableMap,
  TraceCrossProcessEndpointsBySpanRef,
  TraceProcessSpanRefTable
} from '../ingestion/arrow-trace';
import type {TraceDataset} from '../trace-dataset';
import type {
  TraceCounterSource,
  TraceCrossProcessDependencyRenderSource,
  TraceDependencySource,
  TraceEventSource,
  TraceInstantSource,
  TraceProcessSource,
  TraceRenderSpan,
  TraceSameProcessDependencySource,
  TraceSpanGeometrySource,
  TraceSpanLaneSource,
  TraceThreadSource
} from '../trace-graph-accessors';
import type {TraceLayoutLaneDependencySource} from '../trace-layout/trace-geometry-layout-common';
import type {TraceViewSnapshot} from '../trace-view-snapshot';
import type {
  TraceChunkBackedRef,
  TraceChunkRegistry,
  TraceProcessOwnedRef,
  TraceRuntimeChunk,
  TraceSpanOwnerRefs,
  TraceThreadOwnedRef
} from './trace-chunk-registry';
import type {TraceGraphRuntimeSource} from './trace-graph-runtime-source';
import type {CompiledTraceSpanFilterPlan} from './trace-graph-span-filters';
import type {TraceGraphStats} from './trace-graph-stats';
import type {
  TraceGraphEntitySourceCache,
  TraceGraphPathBlockSource,
  TraceGraphPathDependencySource,
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanFilterReason,
  TraceGraphSpanFilterReasonInput,
  TraceGraphSpanLookupStore,
  TraceGraphSpanSearchRecord,
  TraceGraphVisibleLaneLayoutInfo,
  TraceGraphVisibleSpanSearchRecord,
  TraceSpanFilterMask
} from './trace-graph-types';
import type {
  CrossProcessDependencyRef,
  DecodedTraceRef,
  DependencyRef,
  ProcessRef,
  SameProcessDependencyRef,
  ThreadRef,
  TraceDependencyRef
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
  TraceSpanAttributePath,
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
  TraceGraphPathBlockSource,
  TraceGraphPathCrossProcessDependencySource,
  TraceGraphPathDependencySource,
  TraceGraphPathSameProcessDependencySource,
  TraceGraphSelectedCrossProcessDependencySource,
  TraceGraphSelectedSameProcessDependencySource,
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanFilterReason,
  TraceGraphSpanFilterReasonInput,
  TraceGraphSpanFilterState,
  TraceGraphSpanLookupStore,
  TraceGraphSpanSearchRecord,
  TraceGraphSpanStoreAvailability,
  TraceSpanFilterMask,
  TraceGraphVisibleSpanSearchRecord,
  TraceGraphVisibleLaneLayoutInfo,
  TraceSelectedDependencyDirection
} from './trace-graph-types';
export {
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_SOURCE,
  hasTraceSpanNameFilter,
  hasTraceSpanRegexpFilter,
  hasTraceSpanSourceFilter
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
  TraceCardCrossProcessDependency
} from './build-trace-span-card-data';

/** Direction of a single-span dependency-neighborhood read. */
export type TraceSpanDependencyDirection = 'incoming' | 'outgoing';

/** Ref-native dependency lists attached to one span in a single direction. */
export type TraceSpanDirectionalDependencyRefs = {
  /** Process-local source dependency refs in dependency-table row order. */
  readonly sameProcessDependencyRefs: readonly SameProcessDependencyRef[];
  /** Graph-global cross-process dependency refs in dependency-table row order. */
  readonly crossProcessDependencyRefs: readonly CrossProcessDependencyRef[];
};

/** Bounded dependency refs plus the uncapped count for one directional span relation. */
export type TraceDirectionalDependencyRefSlice<TDependencyRef extends TraceDependencyRef> = {
  /** Dependency refs retained under the requested cap. */
  readonly dependencyRefs: readonly TDependencyRef[];
  /** Total directional dependency ref count before the cap. */
  readonly totalCount: number;
  /** Whether the returned refs omit additional directional dependencies. */
  readonly truncated: boolean;
};

/** Optional bounded directional dependency ref slice behavior. */
export type TraceDirectionalDependencyRefSliceOptions = {
  /** Whether to retain and return the highest-wait refs before applying the cap. */
  readonly sortByWaitTime?: boolean;
};

type TraceSpanDirectionalDependencyRefBuckets = TraceSpanDirectionalDependencyRefs & {
  /** Total directional dependency ref count before the cap. */
  readonly totalCount: number;
  /** Whether the returned refs omit additional directional dependencies. */
  readonly truncated: boolean;
};

type TraceDirectionalDependencyRefCandidate<TDependencyRef extends TraceDependencyRef> = {
  /** Candidate dependency ref retained under the directional cap. */
  readonly dependencyRef: TDependencyRef;
  /** Lightweight wait duration used to rank the candidate. */
  readonly waitTimeMs: number;
  /** Stable encounter order used to preserve ties. */
  readonly ordinal: number;
};

/**
 * Runtime query facade over dataset-owned Arrow tables and one immutable visibility snapshot.
 */
export class TraceGraph {
  /** Human-friendly graph name. */
  readonly name: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  readonly spanLayout: TraceSpanLayoutMode;
  /** Metadata-only process records in graph order. */
  readonly processes: Readonly<ArrowTraceProcessMetadata[]>;
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
  readonly sameProcessDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
  >;
  /** Graph-global Arrow cross-process dependency table. */
  readonly crossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
  /** Optional row-aligned Arrow sidecar tables keyed by process id. */
  readonly spanSidecarTableMap?: ArrowTraceSpanSidecarTableMap;
  /** Optional sparse unresolved cross-rank endpoints keyed by exact span ref. */
  readonly crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
  /** Loaded row-backed storage chunks. */
  readonly chunks: readonly ArrowTraceChunk[];
  /** Active chunk span refs. */
  readonly spanRefs?: readonly SpanRef[];
  /** Canonical process ids indexed by packed process index. */
  readonly processIdsByIndex: ReadonlyArray<TraceProcessId>;
  /** Aggregated graph-wide counts for the runtime tables. */
  readonly stats: TraceGraphStats;
  /** Canonical dataset snapshot retained by this runtime graph. */
  readonly traceDataset: TraceDataset;
  /** Canonical immutable visibility snapshot retained by this runtime graph. */
  readonly traceViewSnapshot: TraceViewSnapshot;

  private readonly spanFilters: readonly string[];
  /** Compiled text filters. */
  private readonly spanFilterPlan: CompiledTraceSpanFilterPlan;
  /** Optional lookup surface for loaded and outside refs. */
  private readonly traceStore: TraceGraphSpanLookupStore | undefined;
  private readonly runtimeEntityRefs: TraceRuntimeEntityRefs;
  private readonly chunkRegistry: TraceChunkRegistry;
  private entitySourceCache?: TraceGraphEntitySourceCache;

  /**
   * Builds a runtime graph facade over one dataset and optional immutable visibility snapshot.
   *
   * When callers omit the snapshot, an unfiltered view is built from the same dataset. Live
   * filtered callers should build and retain the snapshot at their dataset boundary so graph,
   * layout, and render stages share one visibility owner.
   */
  constructor(traceGraph: TraceGraphRuntimeSource, traceViewSnapshot?: TraceViewSnapshot) {
    const constructorStartTime = performance.now();
    const traceDataset = traceGraph.traceDataset;
    const metadataMaps = buildTraceGraphMetadataMaps(traceDataset.processes, traceDataset.events);
    const traceStore = traceGraph.traceStore;
    const stateBuildStartTime = performance.now();
    const activeTraceViewSnapshot = traceViewSnapshot ?? buildTraceViewSnapshot(traceDataset);
    if (activeTraceViewSnapshot.dataset !== traceDataset) {
      throw new Error('TraceGraph visibility snapshot must retain the exact runtime dataset.');
    }
    const spanFilters = activeTraceViewSnapshot.spanFilters;
    const spanFilterPlan = buildCompiledTraceSpanFilterPlan(spanFilters);
    this.runtimeEntityRefs = buildTraceRuntimeEntityRefs(traceDataset);
    this.chunkRegistry = buildTraceChunkRegistry(traceDataset, this.runtimeEntityRefs);
    this.name = traceDataset.name;
    this.spanLayout = traceDataset.spanLayout === 'manual' ? 'manual' : 'auto';
    this.minTimeMs = traceDataset.timeExtents.minTimeMs;
    this.maxTimeMs = traceDataset.timeExtents.maxTimeMs;
    this.threadMap = metadataMaps.threadMap;
    this.threadInstantMap = metadataMaps.threadInstantMap;
    this.threadCounterMap = metadataMaps.threadCounterMap;
    this.instantMap = metadataMaps.instantMap;
    this.counterMap = metadataMaps.counterMap;
    this.counterExtents = metadataMaps.counterExtents;
    this.events = traceDataset.events;
    this.eventMap = metadataMaps.eventMap;
    this.processSpanTableMap = traceDataset.processSpanTableMap;
    this.sameProcessDependencyTableMap = traceDataset.sameProcessDependencyTableMap;
    this.crossProcessDependencyTable = traceDataset.crossProcessDependencyTable;
    this.spanSidecarTableMap = traceDataset.spanSidecarTableMap;
    this.crossProcessEndpointsBySpanRef = traceDataset.crossProcessEndpointsBySpanRef;
    this.chunks = this.chunkRegistry.chunks;
    this.spanRefs = traceDataset.spanRefs;
    this.processIdsByIndex = traceDataset.ownerRefSnapshot.processIdsByIndex;
    this.processes = traceDataset.processes;
    this.stats = traceDataset.stats;
    this.traceDataset = traceDataset;
    this.traceViewSnapshot = activeTraceViewSnapshot;
    this.spanFilters = spanFilters;
    this.spanFilterPlan = spanFilterPlan;
    this.traceStore = traceStore;
    const stateBuildDurationMs = performance.now() - stateBuildStartTime;
    log.probe(0, 'TraceGraph ready', {
      name: this.name,
      sourceType: 'trace-dataset',
      spanCount: this.stats.spanCount,
      filterCount: this.spanFilters.length,
      stateDurationMs: stateBuildDurationMs,
      usedProvidedTraceViewSnapshot: traceViewSnapshot != null,
      totalDurationMs: performance.now() - constructorStartTime,
      ...getHeapUsageProbeFields()
    })();
  }

  /** Returns whether the exact span ref is filtered from the visible graph. */
  spanIsFiltered(spanRef: SpanRef): boolean {
    if (!isValidSourceSpanRef(this, spanRef)) {
      return true;
    }

    return this.getSpanRefFilterMask(spanRef) !== TRACE_SPAN_FILTER_MASK_NONE;
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
      traceStore: this.traceStore ?? null,
      filterPlan: this.spanFilterPlan,
      missingSpanInput
    });
  }

  /** Returns the graph filter mask. */
  private getSpanRefFilterMask(spanRef: SpanRef): TraceSpanFilterMask {
    return this.hasActiveGraphSpanFilter()
      ? getTraceViewSpanFilterMask(this.traceViewSnapshot, spanRef)
      : TRACE_SPAN_FILTER_MASK_NONE;
  }

  /** Returns whether any non-empty span filter is active on the graph. */
  hasActiveSpanFilter(): boolean {
    return this.hasActiveGraphSpanFilter();
  }

  /** Returns whether graph filters are active. */
  private hasActiveGraphSpanFilter(): boolean {
    return this.spanFilters.length > 0;
  }

  /** Returns whether the immutable view hides any loaded canonical span rows. */
  private hasFilteredSpanRows(): boolean {
    return this.traceViewSnapshot.filteredSpanCount > 0;
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

  /** Returns canonical process refs in graph order. */
  getProcessRefs(): ReadonlyArray<ProcessRef> {
    return this.runtimeEntityRefs.processRefs;
  }

  /** Process source. */
  getProcessSourceByRef(processRef: ProcessRef): TraceProcessSource | null {
    return this.getEntitySourceCache().processSourcesByRef.get(processRef) ?? null;
  }

  /** Returns canonical thread refs in graph order. */
  getThreadRefs(): ReadonlyArray<ThreadRef> {
    return this.runtimeEntityRefs.threadRefs;
  }

  /** Returns thread source. */
  getThreadSourceByRef(threadRef: ThreadRef): TraceThreadSource | null {
    return this.getEntitySourceCache().threadSourcesByRef.get(threadRef) ?? null;
  }

  /** Decodes one numeric runtime ref. */
  decodeRef(ref: number): DecodedTraceRef | null {
    return decodeTraceRef(ref);
  }

  /** Resolves the loaded storage chunk for a chunk-backed runtime ref. */
  getChunkByRef(ref: TraceChunkBackedRef): TraceRuntimeChunk | null {
    return this.chunkRegistry.getChunkByRef(ref);
  }

  /** Resolves the loaded storage chunk for a span ref without generic ref-kind dispatch. */
  getSpanChunkByRef(spanRef: SpanRef): TraceRuntimeChunk | null {
    return this.chunkRegistry.getSpanChunkByRef(spanRef);
  }

  /** Returns the stable block id for one span ref without materializing a TraceSpan. */
  getSpanId(spanRef: SpanRef): TraceSpanId | null {
    return getArrowTraceSpanField(this, spanRef, 'spanId') as TraceSpanId | null;
  }

  /** Resolves a span ref from an external block id only when that id is unique in the graph. */
  getSpanRefById(spanId: TraceSpanId): SpanRef | null {
    return getUniqueTraceGraphSpanRef(this, spanId);
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

  /** Returns the optional external source id for one span ref. */
  getSpanExternalSpanId(spanRef: SpanRef): string | null {
    return getTraceGraphSpanExternalSpanId(this, spanRef);
  }

  /** Returns decoded user data for one span ref without materializing a TraceSpan. */
  getSpanUserData(spanRef: SpanRef): Record<string, unknown> | undefined {
    return getTraceGraphSpanUserData(this, spanRef);
  }

  /** Returns one declared row-aligned span attribute without decoding full user data. */
  getSpanAttribute(spanRef: SpanRef, path: TraceSpanAttributePath): unknown {
    return getTraceGraphSpanAttribute(this, spanRef, path);
  }

  /** Returns whether every loaded span table declares one optional attribute path. */
  hasSpanAttribute(path: TraceSpanAttributePath): boolean {
    return hasTraceGraphSpanAttribute(this, path);
  }

  /** Returns the detail source for one span ref without expanding dependency ids. */
  getSpanDetailSource(spanRef: SpanRef): TraceRenderSpan | null {
    return (
      getTraceGraphSpanDetailSource(this, spanRef) ??
      this.traceStore?.getSpanDetailSource?.(spanRef) ??
      null
    );
  }

  /** Returns the lane-assignment source for one span ref. */
  getSpanLaneSource(spanRef: SpanRef): TraceSpanLaneSource | null {
    return getTraceGraphSpanLaneSource(this, spanRef);
  }

  /**
   * Returns the geometry source for one span ref.
   * Pass `null` or the primary timing key when only scalar primary timing is needed.
   */
  getSpanGeometrySource(
    spanRef: SpanRef,
    timingKey?: string | null
  ): TraceSpanGeometrySource | null {
    return getTraceGraphSpanGeometrySource(this, spanRef, timingKey);
  }

  /** Iterates packed refs for every graph-global cross-process dependency row in table order. */
  *iterateCrossProcessDependencyRefs(): Iterable<CrossProcessDependencyRef> {
    for (let rowIndex = 0; rowIndex < this.crossProcessDependencyTable.numRows; rowIndex += 1) {
      yield encodeCrossProcessDependencyRef(rowIndex);
    }
  }

  /** Returns the source span ref for one dependency ref without materializing it. */
  getDependencyStartSpan(dependencyRef: TraceDependencyRef): SpanRef | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyStartSpan(this, dependencyRef)
      : null;
  }

  /** Returns the destination span ref for one dependency ref without materializing it. */
  getDependencyEndSpan(dependencyRef: TraceDependencyRef): SpanRef | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyEndSpan(this, dependencyRef)
      : null;
  }

  /** Returns the stable dependency id for one dependency ref. */
  getDependencyId(dependencyRef: TraceDependencyRef): TraceDependencyId | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyId(this, dependencyRef)
      : null;
  }

  /** Returns the visible source block id for one dependency ref. */
  getDependencyStartBlockId(dependencyRef: TraceDependencyRef): TraceSpanId | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyStartBlockId(this, dependencyRef)
      : null;
  }

  /** Returns the visible destination block id for one dependency ref. */
  getDependencyEndBlockId(dependencyRef: TraceDependencyRef): TraceSpanId | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyEndBlockId(this, dependencyRef)
      : null;
  }

  /** Returns the wait-mode field for one dependency ref. */
  getDependencyWaitMode(dependencyRef: TraceDependencyRef): TraceDependency['waitMode'] | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyWaitMode(this, dependencyRef)
      : null;
  }

  /** Returns the bidirectional flag for one dependency ref. */
  getDependencyBidirectional(dependencyRef: TraceDependencyRef): boolean | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyBidirectional(this, dependencyRef)
      : null;
  }

  /** Returns the wait duration in milliseconds for one dependency ref. */
  getDependencyWaitTimeMs(dependencyRef: TraceDependencyRef): number | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyWaitTimeMs(this, dependencyRef)
      : null;
  }

  /** Returns whether one dependency should route as a parent-child edge. */
  getDependencyIsParent(dependencyRef: TraceDependencyRef): boolean {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyIsParent(this, dependencyRef)
      : false;
  }

  /** Returns dependency keywords for one dependency ref. */
  getDependencyKeywords(dependencyRef: TraceDependencyRef): ReadonlySet<string> | null {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyKeywords(this, dependencyRef)
      : null;
  }

  /** Returns optional app-specific user data attached to one dependency. */
  getDependencyUserData(dependencyRef: TraceDependencyRef): Record<string, unknown> | undefined {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyUserData(this, dependencyRef)
      : undefined;
  }

  /** Returns whether one dependency row has a keyword without building a Set. */
  getDependencyHasKeyword(dependencyRef: TraceDependencyRef, keyword: string): boolean {
    return isSourceTraceDependencyRef(dependencyRef)
      ? getTraceGraphDependencyHasKeyword(this, dependencyRef, keyword)
      : false;
  }

  /** Returns the endpoint id for one cross-process dependency ref without materializing an object. */
  getCrossProcessDependencyEndpointId(
    dependencyRef: CrossProcessDependencyRef
  ): TraceCrossProcessDependency['endpointId'] | null {
    return getTraceGraphCrossProcessDependencyEndpointId(this, dependencyRef);
  }

  /** Returns the source rank number for one cross-process dependency ref. */
  getCrossProcessDependencyStartRankNum(dependencyRef: CrossProcessDependencyRef): number | null {
    return getTraceGraphCrossProcessDependencyStartRankNum(this, dependencyRef);
  }

  /** Returns the destination rank number for one cross-process dependency ref. */
  getCrossProcessDependencyEndRankNum(dependencyRef: CrossProcessDependencyRef): number | null {
    return getTraceGraphCrossProcessDependencyEndRankNum(this, dependencyRef);
  }

  /** Returns the topology label for one cross-process dependency ref. */
  getCrossProcessDependencyTopology(dependencyRef: CrossProcessDependencyRef): string | null {
    return getTraceGraphCrossProcessDependencyTopology(this, dependencyRef);
  }

  /** Returns whether one cross-process dependency is still waiting. */
  getCrossProcessDependencyWaiting(dependencyRef: CrossProcessDependencyRef): boolean | null {
    return getTraceGraphCrossProcessDependencyWaiting(this, dependencyRef);
  }

  /** Returns whether one cross-process dependency is still unfinished. */
  getCrossProcessDependencyWaitNotFinished(
    dependencyRef: CrossProcessDependencyRef
  ): boolean | null {
    return getTraceGraphCrossProcessDependencyWaitNotFinished(this, dependencyRef);
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
    if (!isTraceGraphSpanRefActive(this, spanRef)) {
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
    if (!isTraceGraphSpanRefActive(this, spanRef)) {
      return null;
    }
    return this.chunkRegistry.getProcessRefByRef(spanRef);
  }

  /** Returns both owner refs stored on a span row, or null when the span is not in this graph. */
  getSpanOwnerRefs(spanRef: SpanRef): TraceSpanOwnerRefs | null {
    if (!isTraceGraphSpanRefActive(this, spanRef)) {
      return null;
    }
    return this.chunkRegistry.getSpanOwnerRefs(spanRef);
  }

  /** Resolves a process-scoped span ref. */
  getProcessScopedSpanRef(processRef: ProcessRef, spanId: TraceSpanId): SpanRef | null {
    const processId = this.getRawProcessIdByRef(processRef);
    if (!processId) {
      return null;
    }
    for (const spanRef of iterateTraceGraphProcessSpanRefs(this, processId)) {
      if (this.getSpanId(spanRef) === spanId) {
        return spanRef;
      }
    }
    return null;
  }

  /** Returns visible processes. */
  getVisibleProcessRefs(): ReadonlyArray<ProcessRef> {
    return this.spanRefs ? this.getActiveSpanProcessRefs() : this.getActiveChunkProcessRefs();
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

  /**
   * Streams visible process-local span refs from dataset-owned ref sources and snapshot masks.
   *
   * This is the canonical process-local visibility surface; it never allocates a compatibility
   * ref array for filtered views.
   */
  *iterateVisibleSpanRefsByProcess(processRef: ProcessRef): IterableIterator<SpanRef> {
    if (!this.getRawProcessIdByRef(processRef)) {
      return;
    }

    const spanRefs =
      this.traceDataset.spanRefSourcesByProcessIndex[getProcessRefIndex(processRef)] ?? null;
    if (!spanRefs) {
      return;
    }
    if (!this.hasFilteredSpanRows()) {
      yield* spanRefs;
      return;
    }

    for (const spanRef of spanRefs) {
      if (
        getTraceViewSpanFilterMask(this.traceViewSnapshot, spanRef) === TRACE_SPAN_FILTER_MASK_NONE
      ) {
        yield spanRef;
      }
    }
  }

  /** Returns whether one active span ref remains visible in the filtered graph. */
  isSpanVisible(spanRef: SpanRef): boolean {
    return isVisibleSpanRef(this, spanRef);
  }

  /** Returns lightweight visible same-process dependency sources for Arrow-native layout. */
  getVisibleSameProcessDependencyLayoutSources(
    processRef: ProcessRef
  ): ReadonlyArray<TraceLayoutLaneDependencySource> {
    if (!this.getRawProcessIdByRef(processRef)) {
      return [];
    }
    if (
      getTraceGraphProcessLaneAssignmentMode(this.getProcessSourceByRef(processRef)?.userData) ===
      'none'
    ) {
      return [];
    }

    const dependencySources: TraceLayoutLaneDependencySource[] = [];
    for (const dependencyRef of this.iterateVisibleSameProcessDependencyRefsByProcess(processRef)) {
      const dependencyId = this.getDependencyId(dependencyRef);
      const startSpanRef = this.getDependencyStartSpan(dependencyRef);
      const endSpanRef = this.getDependencyEndSpan(dependencyRef);
      if (dependencyId == null || startSpanRef == null || endSpanRef == null) {
        continue;
      }
      dependencySources.push({
        dependencyId,
        startSpanRef,
        endSpanRef,
        hasParentKeyword: this.getDependencyIsParent(dependencyRef)
      });
    }
    return dependencySources;
  }

  /** Streams visible same-process dependency refs in canonical process-local table order. */
  *iterateVisibleSameProcessDependencyRefsByProcess(
    processRef: ProcessRef
  ): IterableIterator<SameProcessDependencyRef> {
    if (!this.getRawProcessIdByRef(processRef)) {
      return;
    }
    const dependencyRefs =
      this.traceDataset.sameProcessDependencyRefSourcesByProcessIndex[
        getProcessRefIndex(processRef)
      ] ?? null;
    if (!dependencyRefs) {
      return;
    }
    if (!this.hasFilteredSpanRows()) {
      yield* dependencyRefs;
      return;
    }
    for (const dependencyRef of dependencyRefs) {
      if (this.isRenderableVisibleDependencyRef(dependencyRef)) {
        yield dependencyRef;
      }
    }
  }

  /** Returns source same-process dependency refs for one process in table order. */
  getSameProcessDependencyRefs(processRef: ProcessRef): readonly SameProcessDependencyRef[] {
    const processId = this.getRawProcessIdByRef(processRef);
    if (!processId) {
      return [];
    }

    const table = this.sameProcessDependencyTableMap[processId];
    if (!table) {
      return [];
    }

    const processIndex = this.processIdsByIndex.indexOf(processId);
    if (processIndex < 0) {
      return [];
    }

    const dependencyRefs: SameProcessDependencyRef[] = [];
    for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
      dependencyRefs.push(
        encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))
      );
    }
    return dependencyRefs;
  }

  /**
   * Builds one unfiltered visible cross-process-dependency render source directly from Arrow columns.
   *
   * Unfiltered cross-process-dependency layout can stream the cross table without constructing
   * same-process-dependency adjacency for every visible span.
   */
  private buildUnfilteredVisibleCrossProcessDependencyRenderSource(
    dependencyRef: CrossProcessDependencyRef
  ): TraceCrossProcessDependencyRenderSource | null {
    const startRankNum = this.getCrossProcessDependencyStartRankNum(dependencyRef);
    const endRankNum = this.getCrossProcessDependencyEndRankNum(dependencyRef);
    const waitMode = this.getDependencyWaitMode(dependencyRef);
    if (startRankNum == null || endRankNum == null || !waitMode) {
      return null;
    }

    return {
      type: 'trace-cross-process-dependency',
      dependencyRef,
      startSpanRef: this.getDependencyStartSpan(dependencyRef),
      endSpanRef: this.getDependencyEndSpan(dependencyRef),
      waitMode,
      bidirectional: this.getDependencyBidirectional(dependencyRef) ?? false,
      waitTimeMs: this.getDependencyWaitTimeMs(dependencyRef) ?? 0,
      startRankNum,
      endRankNum,
      isParent: this.getDependencyIsParent(dependencyRef)
    } satisfies TraceCrossProcessDependencyRenderSource;
  }

  /** Builds visible lane metadata inferred from explicit block lane values. */
  getVisibleLaneLayoutInfo(): TraceGraphVisibleLaneLayoutInfo {
    return this.buildVisibleLaneLayoutInfo();
  }

  /** Builds direct lane metadata from current snapshot-visible refs without retaining it. */
  private buildVisibleLaneLayoutInfo(): TraceGraphVisibleLaneLayoutInfo {
    if (
      this.processes.every(
        process => getTraceGraphProcessLaneAssignmentMode(process.userData) === 'none'
      )
    ) {
      return {
        explicitLaneValueCount: 0,
        threadsWithLaneDataCount: 0
      };
    }

    const hasSpanLaneUserDataColumn =
      this.chunks.some(
        chunk =>
          (
            chunk.spanTable as unknown as {
              getChild(name: string): unknown;
            }
          ).getChild('userDataJson') != null ||
          chunk.spanSidecarTable?.getChild('userDataJson') != null
      ) ||
      Object.values(this.spanSidecarTableMap ?? {}).some(
        sidecarTable => sidecarTable.getChild('userDataJson') != null
      );
    if (!hasSpanLaneUserDataColumn) {
      return {
        explicitLaneValueCount: 0,
        threadsWithLaneDataCount: 0
      };
    }

    const laneCountsByThreadRef = new Map<ThreadRef, number>();
    let explicitLaneValueCount = 0;
    for (const process of this.processes) {
      if (getTraceGraphProcessLaneAssignmentMode(process.userData) === 'none') {
        continue;
      }

      const processRef = this.runtimeEntityRefs.processRefById.get(
        process.processId as TraceProcessId
      );
      if (processRef == null) {
        continue;
      }
      for (const spanRef of this.iterateVisibleSpanRefsByProcess(processRef)) {
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

    return {
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
  }

  /** Resolves one ref-native dependency source from a canonical dependency ref. */
  getDependencySource(dependencyRef: TraceDependencyRef): TraceDependencySource | null {
    if (isSameProcessDependencyRef(dependencyRef)) {
      return this.withRuntimeDependencySourceRefs(
        this.buildUnfilteredSameProcessDependencySourceByRef(dependencyRef)
      );
    }
    if (isCrossProcessDependencyRef(dependencyRef)) {
      return this.buildUnfilteredVisibleCrossProcessDependencyRenderSource(dependencyRef);
    }
    return null;
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
      sameProcessDependencyRefs: dependencyRefs.sameProcessDependencyRefs,
      crossProcessDependencyRefs: dependencyRefs.crossProcessDependencyRefs
    };
  }

  /** Reads bounded immediate dependency refs attached to one span without materializing edges. */
  getSpanDirectionalDependencyRefSlice(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number,
    options: TraceDirectionalDependencyRefSliceOptions = {}
  ): TraceDirectionalDependencyRefSlice<TraceDependencyRef> {
    if (options.sortByWaitTime) {
      const dependencyRefs = this.getSpanDirectionalDependencyRefs(spanRef, direction);
      return getBoundedDirectionalDependencyRefSliceByWaitTime({
        dependencyRefs: iterateSpanDirectionalDependencyRefs(dependencyRefs),
        limit,
        getWaitTimeMs: dependencyRef => this.getDependencyWaitTimeMs(dependencyRef)
      });
    }

    const dependencyRefs = this.getSpanDirectionalDependencyRefBuckets(spanRef, direction, limit);
    return {
      dependencyRefs: [
        ...dependencyRefs.sameProcessDependencyRefs,
        ...dependencyRefs.crossProcessDependencyRefs
      ],
      totalCount: dependencyRefs.totalCount,
      truncated: dependencyRefs.truncated
    };
  }

  /** Reads bounded visible dependency refs touching one span in one rendered direction. */
  getVisibleDirectionalDependencyRefSlice(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number,
    options: TraceDirectionalDependencyRefSliceOptions = {}
  ): TraceDirectionalDependencyRefSlice<TraceDependencyRef> {
    const normalizedLimit = normalizeDependencyRefLimit(limit);
    if (!this.hasFilteredSpanRows()) {
      return this.getSpanDirectionalDependencyRefSlice(
        spanRef,
        direction,
        normalizedLimit,
        options
      );
    }

    const directionalRefs = this.getSpanDirectionalDependencyRefs(spanRef, direction);
    const visibleDependencyRefs = [
      ...directionalRefs.sameProcessDependencyRefs,
      ...directionalRefs.crossProcessDependencyRefs
    ].filter(dependencyRef => this.isRenderableVisibleDependencyRef(dependencyRef));
    if (options.sortByWaitTime) {
      return getBoundedDirectionalDependencyRefSliceByWaitTime({
        dependencyRefs: visibleDependencyRefs,
        limit: normalizedLimit,
        getWaitTimeMs: dependencyRef => this.getDependencyWaitTimeMs(dependencyRef)
      });
    }

    const dependencyRefs: TraceDependencyRef[] = [];
    for (const dependencyRef of visibleDependencyRefs) {
      if (dependencyRefs.length < normalizedLimit) {
        dependencyRefs.push(dependencyRef);
      }
    }
    return {
      dependencyRefs,
      totalCount: visibleDependencyRefs.length,
      truncated: visibleDependencyRefs.length > dependencyRefs.length
    };
  }

  /** Reads bounded cross-process dependency refs attached to one span without reading same-process refs. */
  getSpanDirectionalCrossProcessDependencyRefSlice(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number
  ): TraceDirectionalDependencyRefSlice<CrossProcessDependencyRef> {
    const dependencyRefs = this.getSpanDirectionalDependencyRefBuckets(
      spanRef,
      direction,
      limit,
      false
    );
    return {
      dependencyRefs: dependencyRefs.crossProcessDependencyRefs,
      totalCount: dependencyRefs.totalCount,
      truncated: dependencyRefs.truncated
    };
  }

  /** Resolves bounded directional source refs while preserving same-process and cross-process ref buckets. */
  private getSpanDirectionalDependencyRefBuckets(
    spanRef: SpanRef,
    direction: TraceSpanDependencyDirection,
    limit: number,
    includeSameProcessDependencyRefs = true
  ): TraceSpanDirectionalDependencyRefBuckets {
    const processId = getTraceGraphSpanRefProcessId(this, spanRef);
    if (!processId || !isTraceGraphSpanRefActive(this, spanRef)) {
      return EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REF_BUCKETS;
    }

    const normalizedLimit = normalizeDependencyRefLimit(limit);
    const endpointColumnName = direction === 'incoming' ? 'endSpanRef' : 'startSpanRef';
    const sameProcessDependencyRefs: SameProcessDependencyRef[] = [];
    let sameProcessDependencyCount = 0;
    if (includeSameProcessDependencyRefs) {
      const sameProcessDependencyTable = this.sameProcessDependencyTableMap[processId];
      const processIndex = this.processIdsByIndex.indexOf(processId);
      if (sameProcessDependencyTable && processIndex >= 0) {
        const endpointColumn = sameProcessDependencyTable.getChild(endpointColumnName);
        const seenRawDependencyRefs = new Set<number>();
        for (let rowIndex = 0; rowIndex < sameProcessDependencyTable.numRows; rowIndex += 1) {
          if (normalizeArrowRefNumber(endpointColumn?.get(rowIndex)) !== spanRef) {
            continue;
          }
          const rawDependencyRef = encodeSameProcessDependencyRef(
            encodeLocalSpanRef(processIndex, rowIndex)
          );
          if (seenRawDependencyRefs.has(rawDependencyRef)) {
            continue;
          }
          seenRawDependencyRefs.add(rawDependencyRef);
          sameProcessDependencyCount += 1;
          if (sameProcessDependencyRefs.length >= normalizedLimit) {
            continue;
          }
          for (const dependencyRef of normalizeDirectionalSameProcessDependencyRef(
            this,
            spanRef,
            rawDependencyRef
          )) {
            if (sameProcessDependencyRefs.length >= normalizedLimit) {
              break;
            }
            sameProcessDependencyRefs.push(dependencyRef);
          }
        }
      }
    }

    const remainingDependencyRefLimit = includeSameProcessDependencyRefs
      ? Math.max(normalizedLimit - sameProcessDependencyRefs.length, 0)
      : normalizedLimit;
    const crossProcessDependencyRefs: CrossProcessDependencyRef[] = [];
    let crossProcessDependencyCount = 0;
    const crossEndpointColumn = this.crossProcessDependencyTable.getChild(endpointColumnName);
    for (let rowIndex = 0; rowIndex < this.crossProcessDependencyTable.numRows; rowIndex += 1) {
      if (normalizeArrowRefNumber(crossEndpointColumn?.get(rowIndex)) !== spanRef) {
        continue;
      }
      crossProcessDependencyCount += 1;
      if (crossProcessDependencyRefs.length < remainingDependencyRefLimit) {
        crossProcessDependencyRefs.push(encodeCrossProcessDependencyRef(rowIndex));
      }
    }
    const totalCount = sameProcessDependencyCount + crossProcessDependencyCount;
    return {
      sameProcessDependencyRefs,
      crossProcessDependencyRefs,
      totalCount,
      truncated: totalCount > sameProcessDependencyRefs.length + crossProcessDependencyRefs.length
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
      for (const dependencyRef of this.getVisibleDirectionalDependencyRefSlice(
        spanRef,
        direction,
        Number.POSITIVE_INFINITY
      ).dependencyRefs) {
        const dependencySource = this.getDependencySource(dependencyRef);
        if (!dependencySource) {
          continue;
        }
        const dependencyKey = getTraceDependencySourceRuntimeKey(dependencySource);
        if (seenDependencyKeys.has(dependencyKey)) {
          continue;
        }
        seenDependencyKeys.add(dependencyKey);
        dependencySources.push(dependencySource);
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

    for (const dependencyRef of dependencyRefs.sameProcessDependencyRefs) {
      addDependencySource(this.buildUnfilteredSameProcessDependencySourceByRef(dependencyRef));
    }
    for (const dependencyRef of dependencyRefs.crossProcessDependencyRefs) {
      addDependencySource(
        this.buildUnfilteredVisibleCrossProcessDependencyRenderSource(dependencyRef)
      );
    }
    return dependencySources;
  }

  /** Resolves the owning process ref for one exact same-process dependency ref. */
  getSameProcessDependencyProcessRefByRef(
    dependencyRef: SameProcessDependencyRef
  ): ProcessRef | null {
    const processId = this.getRawSameProcessDependencyProcessIdByRef(dependencyRef);
    return processId ? (this.runtimeEntityRefs.processRefById.get(processId) ?? null) : null;
  }

  /** Streams visible cross-process dependency refs in canonical table order. */
  *iterateVisibleCrossProcessDependencyRefs(): IterableIterator<CrossProcessDependencyRef> {
    const hasFilteredSpanRows = this.hasFilteredSpanRows();
    for (let rowIndex = 0; rowIndex < this.crossProcessDependencyTable.numRows; rowIndex += 1) {
      const dependencyRef = encodeCrossProcessDependencyRef(rowIndex);
      if (!hasFilteredSpanRows || this.isRenderableVisibleDependencyRef(dependencyRef)) {
        yield dependencyRef;
      }
    }
  }

  /** Returns whether one dependency ref participates in the active visible graph. */
  isDependencyVisible(dependencyRef: TraceDependencyRef): boolean {
    if (!isSameProcessDependencyRef(dependencyRef) && !isCrossProcessDependencyRef(dependencyRef)) {
      return false;
    }
    if (!this.hasFilteredSpanRows()) {
      return true;
    }
    const startSpanRef = this.getDependencyStartSpan(dependencyRef);
    const endSpanRef = this.getDependencyEndSpan(dependencyRef);
    return (
      (startSpanRef == null || !this.spanIsFiltered(startSpanRef)) &&
      (endSpanRef == null || !this.spanIsFiltered(endSpanRef))
    );
  }

  /**
   * Returns whether one canonical dependency row belongs to the filtered renderable graph.
   *
   * The retired visible adjacency map applied these row-shape checks while it was built. Keep
   * that contract local to filtered reads so canonical dataset incidence can retain every raw
   * endpoint row for unfiltered source-navigation APIs.
   */
  private isRenderableVisibleDependencyRef(dependencyRef: TraceDependencyRef): boolean {
    const dependencyId = this.getDependencyId(dependencyRef);
    if (!dependencyId) {
      return false;
    }
    const startSpanRef = this.getDependencyStartSpan(dependencyRef);
    const endSpanRef = this.getDependencyEndSpan(dependencyRef);
    if (isSameProcessDependencyRef(dependencyRef)) {
      const startSpanId = this.getDependencyStartBlockId(dependencyRef);
      const endSpanId = this.getDependencyEndBlockId(dependencyRef);
      return (
        startSpanId != null &&
        endSpanId != null &&
        startSpanId !== endSpanId &&
        startSpanRef != null &&
        endSpanRef != null &&
        !this.spanIsFiltered(startSpanRef) &&
        !this.spanIsFiltered(endSpanRef)
      );
    }

    if (this.getDependencyIsParent(dependencyRef) && (startSpanRef == null || endSpanRef == null)) {
      return false;
    }
    const endpointId = this.getCrossProcessDependencyEndpointId(dependencyRef);
    const startRankNum = this.getCrossProcessDependencyStartRankNum(dependencyRef);
    const endRankNum = this.getCrossProcessDependencyEndRankNum(dependencyRef);
    return (
      endpointId != null &&
      startRankNum != null &&
      endRankNum != null &&
      (startSpanRef == null || !this.spanIsFiltered(startSpanRef)) &&
      (endSpanRef == null || !this.spanIsFiltered(endSpanRef))
    );
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
    return searchTraceGraphBlockRecordsWithOptions(this, {
      processRefs: this.getVisibleProcessRefs(),
      getProcessIdByRef: processRef => this.getRawProcessIdByRef(processRef),
      matchesSearchText,
      visitRecord,
      limit,
      isSpanVisible: spanRef => !this.spanIsFiltered(spanRef),
      buildRecord: record => record
    });
  }

  /** Adds canonical process/thread refs to one visible dependency source when resolvable. */
  private withRuntimeDependencySourceRefs<T extends TraceSameProcessDependencySource>(
    source: T | null
  ): T | null {
    if (!source) {
      return null;
    }

    const processId =
      source.processRef == null &&
      source.dependencyRef != null &&
      isSameProcessDependencyRef(source.dependencyRef)
        ? this.getRawSameProcessDependencyProcessIdByRef(source.dependencyRef)
        : null;
    let processRef = source.processRef;
    if (processRef == null && processId) {
      processRef = this.runtimeEntityRefs.processRefById.get(processId);
    }
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

  /** Returns active process refs in owner-ref order. */
  private getActiveSpanProcessRefs(): ReadonlyArray<ProcessRef> {
    return this.getProcessRefs().filter(processRef => {
      const processId = this.getRawProcessIdByRef(processRef);
      return processId != null && (this.processSpanTableMap[processId]?.numRows ?? 0) > 0;
    });
  }

  /** Returns dense chunk-backed process refs in owner-ref order. */
  private getActiveChunkProcessRefs(): ReadonlyArray<ProcessRef> {
    const activeProcessRefs = new Set<ProcessRef>();
    for (const chunk of this.chunks) {
      if (chunk.spanTable.numRows === 0) {
        continue;
      }
      for (const processRef of chunk.processRefs) {
        activeProcessRefs.add(processRef);
      }
    }
    return this.getProcessRefs().filter(processRef => activeProcessRefs.has(processRef));
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

  /** Returns one raw owning process id for an exact same-process dependency ref. */
  private getRawSameProcessDependencyProcessIdByRef(
    dependencyRef: SameProcessDependencyRef
  ): TraceProcessId | null {
    return this.processIdsByIndex[getSameProcessDependencyRefProcessIndex(dependencyRef)] ?? null;
  }

  /** Builds one unfiltered same-process dependency source directly from its Arrow source ref. */
  private buildUnfilteredSameProcessDependencySourceByRef(
    dependencyRef: SameProcessDependencyRef
  ): TraceSameProcessDependencySource | null {
    return buildTraceGraphUnfilteredSameProcessDependencySourceByRef(this, dependencyRef);
  }
}

/** Returns whether one runtime dependency ref addresses an Arrow-backed source row. */
function isSourceTraceDependencyRef(
  dependencyRef: TraceDependencyRef
): dependencyRef is SameProcessDependencyRef | CrossProcessDependencyRef {
  return isSameProcessDependencyRef(dependencyRef) || isCrossProcessDependencyRef(dependencyRef);
}

const EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REF_BUCKETS = {
  ...EMPTY_SPAN_DIRECTIONAL_DEPENDENCY_REFS,
  totalCount: 0,
  truncated: false
} satisfies TraceSpanDirectionalDependencyRefBuckets;

/** Iterates source dependency refs in the existing local-then-cross directional order. */
function* iterateSpanDirectionalDependencyRefs(
  dependencyRefs: TraceSpanDirectionalDependencyRefs
): IterableIterator<DependencyRef> {
  yield* dependencyRefs.sameProcessDependencyRefs;
  yield* dependencyRefs.crossProcessDependencyRefs;
}

/** Retains the highest-wait dependency refs while counting the uncapped iterable. */
function getBoundedDirectionalDependencyRefSliceByWaitTime<
  TDependencyRef extends TraceDependencyRef
>(params: {
  /** Directional dependency refs to rank without descriptive materialization. */
  dependencyRefs: Iterable<TDependencyRef>;
  /** Maximum dependency refs to retain. */
  limit: number;
  /** Reads one lightweight dependency wait duration. */
  getWaitTimeMs: (dependencyRef: TDependencyRef) => number | null;
}): TraceDirectionalDependencyRefSlice<TDependencyRef> {
  const normalizedLimit = normalizeDependencyRefLimit(params.limit);
  const candidates: TraceDirectionalDependencyRefCandidate<TDependencyRef>[] = [];
  let totalCount = 0;
  for (const dependencyRef of params.dependencyRefs) {
    if (normalizedLimit > 0) {
      const waitTimeMs = params.getWaitTimeMs(dependencyRef) ?? 0;
      const candidateIndex = candidates.findIndex(
        candidate =>
          candidate.waitTimeMs < waitTimeMs ||
          (candidate.waitTimeMs === waitTimeMs && candidate.ordinal > totalCount)
      );
      if (candidateIndex !== -1 || candidates.length < normalizedLimit) {
        const candidate = {
          dependencyRef,
          waitTimeMs,
          ordinal: totalCount
        } satisfies TraceDirectionalDependencyRefCandidate<TDependencyRef>;
        if (candidateIndex === -1) {
          candidates.push(candidate);
        } else {
          candidates.splice(candidateIndex, 0, candidate);
        }
        if (candidates.length > normalizedLimit) {
          candidates.pop();
        }
      }
    }
    totalCount += 1;
  }
  return {
    dependencyRefs: candidates.map(candidate => candidate.dependencyRef),
    totalCount,
    truncated: totalCount > candidates.length
  };
}

/** Normalizes finite dependency caps while preserving explicit unbounded callers. */
function normalizeDependencyRefLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
}

/** Builds one collision-safe dedupe key for a runtime dependency source. */
function getTraceDependencySourceRuntimeKey(dependencySource: TraceDependencySource): string {
  if (dependencySource.dependencyRef == null) {
    throw new Error(`Expected ref-native dependency source for ${dependencySource.type}`);
  }
  return `${dependencySource.type}:ref:${String(dependencySource.dependencyRef)}`;
}
