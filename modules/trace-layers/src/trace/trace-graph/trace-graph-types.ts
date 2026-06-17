import * as arrow from 'apache-arrow';

import {IndexedArrowTable, MappedArrowTable} from '../../arrow-utils/index';
import {getPrimaryTiming} from './trace-types';

import type {
  ArrowTraceLocalDependencyTable,
  TraceProcessSpanRefTable
} from '../ingestion/arrow-trace';
import type {
  TraceCounterSource,
  TraceCrossDependencySource,
  TraceDependencySource,
  TraceEventSource,
  TraceInstantSource,
  TraceLocalDependencySource,
  TraceProcessSource,
  TraceRenderSpan,
  TraceSpanDisplaySource,
  TraceSpanGeometrySource,
  TraceSpanRenderSource,
  TraceThreadSource
} from '../trace-graph-accessors';
import type {TraceLayoutLaneDependencySource} from '../trace-layout/trace-geometry-layout-common';
import type {
  CrossDependencyRef,
  LocalDependencyRef,
  ProcessRef,
  ThreadRef,
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleDependencyRef,
  VisibleLocalDependencyRef
} from './trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependency,
  TraceDependencyId,
  TraceProcessId,
  TraceSpan,
  TraceSpanId
} from './trace-types';

/** No span filter matched this row. */
export const TRACE_SPAN_FILTER_MASK_NONE = 0x00;
/** Text, prefix, or regexp span filtering matched this row. */
export const TRACE_SPAN_FILTER_MASK_REGEXP = 0x01;
/** Topological span contraction matched this row. */
export const TRACE_SPAN_FILTER_MASK_TOPOLOGY = 0x02;
/** Source-column filename/source filtering matched this row. */
export const TRACE_SPAN_FILTER_MASK_SOURCE = 0x04;

/** Compact bitmask describing why one span is filtered from rendered geometry. */
export type TraceSpanFilterMask = number;

/** Current graph/store visibility state for one exact span ref. */
export type TraceGraphSpanFilterState =
  | 'visible'
  | 'filtered'
  | 'outside-window'
  | 'not-loaded'
  | 'unknown';

/** Graph-owned filtered state and provenance for one exact span ref. */
export type TraceGraphSpanFilterReason = {
  /** Whether the exact span ref is removed from the current rendered graph. */
  isFiltered: boolean;
  /** Bitmask describing which graph filters matched this span. */
  filterMask: TraceSpanFilterMask;
  /** Visibility reason for this span ref in the current materialized graph. */
  state: TraceGraphSpanFilterState;
};

/** Optional store-backed span text used to explain refs missing from the current graph. */
export type TraceGraphSpanFilterReasonInput = {
  /** Span name checked against active graph text filters. */
  readonly spanName: string;
};

/** Store-owned availability for a span ref missing from the current materialized graph. */
export type TraceGraphSpanStoreAvailability = 'outside-window' | 'not-loaded' | 'unknown';

/** Minimal active-graph facade passed to store-backed span search helpers. */
export type TraceGraphSpanSearchContext = {
  /** Returns graph-owned filtered state and provenance for one exact span ref. */
  spanFilterReason: (
    spanRef: SpanRef,
    missingSpanInput?: TraceGraphSpanFilterReasonInput
  ) => TraceGraphSpanFilterReason;
};

/** Inputs for store-backed span search over already loaded rows. */
export type TraceGraphSpanStoreSearchParams = {
  /** Active materialized graph used only for filter/window provenance. */
  readonly traceGraph: TraceGraphSpanSearchContext;
  /** Search predicate applied to normalized row text. */
  readonly matchesSearchText: (searchText: string) => boolean;
  /** Maximum number of matching records to return. */
  readonly limit: number;
};

/** Inputs for store-backed hidden-span navigation resolution. */
export type TraceGraphSpanStoreNavigationParams = {
  /** Active materialized graph used only to resolve visible targets. */
  readonly traceGraph: TraceGraphSpanSearchContext;
  /** Exact store-backed span ref whose visible relatives should be resolved. */
  readonly spanRef: SpanRef;
};

/** Store-owned filtered state for exact store-backed span refs. */
export type TraceGraphSpanFilterStore = {
  /** Returns whether the exact store-backed span ref is removed by store-owned filters. */
  isFiltered: (spanRef: SpanRef) => boolean;
  /** Returns store-owned filtered state and provenance for one exact span ref. */
  getFilterReason: (spanRef: SpanRef) => TraceGraphSpanFilterReason;
  /** Returns whether the chunk store has active source-column filename filters. */
  hasActiveSourceSpanFilter: () => boolean;
  /** Monotonic revision incremented whenever store-owned source-column filters change. */
  getSourceSpanFilterRevision?: () => number;
  /** Searches already loaded store rows without triggering chunk loads. */
  searchSpans?: (params: TraceGraphSpanStoreSearchParams) => readonly TraceGraphSpanSearchRecord[];
  /** Resolves display data for a store-backed span missing from the materialized graph. */
  getSpanDisplaySource?: (spanRef: SpanRef) => TraceSpanDisplaySource | null;
  /** Resolves lightweight render data for a store-backed span missing from the materialized graph. */
  getSpanRenderSource?: (spanRef: SpanRef) => TraceSpanRenderSource | null;
  /** Resolves visible navigation targets for a store-backed span. */
  getSpanFilterNavigation?: (
    params: TraceGraphSpanStoreNavigationParams
  ) => TraceGraphSpanFilterNavigation | null;
};

/** Returns whether a mask includes a span-name text, prefix, or regexp filter match. */
export function hasTraceSpanNameFilter(mask: TraceSpanFilterMask): boolean {
  return (mask & TRACE_SPAN_FILTER_MASK_REGEXP) !== 0;
}

/** Returns whether a mask includes a source-column text, prefix, or regexp filter match. */
export function hasTraceSpanSourceFilter(mask: TraceSpanFilterMask): boolean {
  return (mask & TRACE_SPAN_FILTER_MASK_SOURCE) !== 0;
}

/** Returns whether a mask hides spans from default card relation lists. */
export function hasTraceSpanRegexpFilter(mask: TraceSpanFilterMask): boolean {
  return hasTraceSpanNameFilter(mask) || hasTraceSpanSourceFilter(mask);
}

/** Returns whether a mask marks spans removed by topology contraction. */
export function hasTraceSpanTopologyFilter(mask: TraceSpanFilterMask): boolean {
  return (mask & TRACE_SPAN_FILTER_MASK_TOPOLOGY) !== 0;
}

/** Extracts the Arrow type map used by process-local span ref index tables. */
export type TraceProcessSpanRefTableTypeMap =
  TraceProcessSpanRefTable extends arrow.Table<infer TTypeMap> ? TTypeMap : never;
/** Extracts the Arrow type map used by canonical local-dependency tables. */
export type ArrowTraceLocalDependencyTableTypeMap =
  ArrowTraceLocalDependencyTable extends arrow.Table<infer TTypeMap> ? TTypeMap : never;
/** Indexed span table view used for visible process rows. */
export type TraceGraphVisibleSpanTable = IndexedArrowTable<TraceProcessSpanRefTableTypeMap>;
/** Dependency-id keyed local-dependency table lookup. */
export type TraceGraphLocalDependencyLookup =
  MappedArrowTable<ArrowTraceLocalDependencyTableTypeMap>;

/** Configures which spans should be filtered from the visible graph. */
export type TraceGraphFilterOptions = {
  /** Matches span names or source strings that should be filtered. */
  spanFilters?: readonly string[];
  /** Filters short same-process child spans that overlap their only local parent span. */
  overlappingParentSpanFilter?: TraceGraphOverlappingParentSpanFilter;
  /** Filters same-process linear parent chains whose spans have similar durations. */
  similarDurationChainSpanFilter?: TraceGraphSimilarDurationChainSpanFilter;
  /** Optional precomputed filter state. */
  preparedState?: TraceGraphPreparedState;
};

/** Configures the overlapping-parent topology filter used by filtered TraceGraph views. */
export type TraceGraphOverlappingParentSpanFilter = {
  /** Maximum child-span duration eligible for topology filtering. */
  maxChildDurationMs: number;
};

/** Configures the similar-duration linear-chain topology filter for filtered TraceGraph views. */
export type TraceGraphSimilarDurationChainSpanFilter = {
  /** Maximum relative duration delta allowed against the store-backed terminal span. */
  maxRelativeDurationDelta: number;
};

/** Counts filtered spans by the first active filter stage that removed them. */
export type TraceGraphFilteredSpanCountsByFilter = {
  /** Number of spans first removed by configured text, prefix, or regex span filters. */
  readonly spanFilterCount: number;
  /** Number of spans first removed by the overlapping-parent topology filter. */
  readonly overlappingParentSpanFilterCount: number;
  /** Number of spans first removed by the similar-duration parent-chain topology filter. */
  readonly similarDurationChainSpanFilterCount: number;
};

/** Precomputed filter state. */
export type TraceGraphPreparedState = {
  /** Span filters that were used when preparing this state. */
  spanFilters?: readonly string[];
  /** Overlapping-parent topology filter that was used when preparing this state. */
  overlappingParentSpanFilter?: TraceGraphOverlappingParentSpanFilter;
  /** Similar-duration chain topology filter that was used when preparing this state. */
  similarDurationChainSpanFilter?: TraceGraphSimilarDurationChainSpanFilter;
  /** Filtered span refs in the source graph. */
  filteredSpanRefs: ReadonlySet<SpanRef>;
  /** Process span-ref tables with graph filter masks applied to process-local rows. */
  processSpanTableMap?: Readonly<Record<TraceProcessId, TraceProcessSpanRefTable>>;
  /** Final filtered-span attribution counts grouped by the first filter stage that removed them. */
  filteredSpanCountsByFilter: TraceGraphFilteredSpanCountsByFilter;
};

/** Describes a visible child dependency reachable from a block after filtering. */
export type TraceGraphChildDependency = {
  /** Holds the stitched or direct dependency edge. */
  dependency: TraceDependency;
  /** Points at the visible child block reached by the dependency. */
  childBlock: TraceSpan;
};

/** Controls whether dependency lookups use the visible stitched graph or the raw source graph. */
export type TraceGraphDependencyLookupOptions = {
  /** When true, resolve dependencies from the unfiltered source graph. */
  includeHidden?: boolean;
};

/** Stores one span-ref dependency traversal keyed only by canonical visible refs. */
export type TraceSpanDependencySelection = {
  /** Origin span ref requested by the caller. */
  originSpanRef: SpanRef;
  /** Ordered visible parent span refs reached by walking incoming dependencies. */
  parentSpanRefs: SpanRef[];
  /** Ordered visible child span refs reached by walking outgoing dependencies. */
  childSpanRefs: SpanRef[];
  /** Ordered visible span refs reached by the traversal, including the origin span. */
  spanRefs: SpanRef[];
  /** Visible local dependency refs reached while walking incoming dependencies. */
  parentLocalDependencyRefs: VisibleLocalDependencyRef[];
  /** Visible cross-process dependency refs reached while walking incoming dependencies. */
  parentCrossDependencyRefs: VisibleCrossDependencyRef[];
  /** Visible local dependency refs reached while walking outgoing dependencies. */
  childLocalDependencyRefs: VisibleLocalDependencyRef[];
  /** Visible cross-process dependency refs reached while walking outgoing dependencies. */
  childCrossDependencyRefs: VisibleCrossDependencyRef[];
  /** Ordered visible local dependency refs reached by the full traversal. */
  visibleLocalDependencyRefs: VisibleLocalDependencyRef[];
  /** Ordered visible cross-process dependency refs reached by the full traversal. */
  visibleCrossDependencyRefs: VisibleCrossDependencyRef[];
};

/** Direction of a selected dependency relative to the selected origin span. */
export type TraceSelectedDependencyDirection = 'incoming' | 'outgoing';

/** Carries the minimal selected local-dependency fields needed by deck overlay rendering. */
export type TraceGraphSelectedLocalDependencySource = {
  /** Stable selected visible local dependency ref. */
  dependencyRef: VisibleLocalDependencyRef;
  /** Owning process ref used to group overlays by rank layer. */
  processRef: ProcessRef;
  /** Direction of this selected dependency relative to the selected origin span. */
  selectedDirection: TraceSelectedDependencyDirection;
  /** Wait duration used for selected-overlay coloring. */
  waitTimeMs: number;
  /** Whether the overlay should render arrowheads in both directions. */
  bidirectional: boolean;
};

/** Carries the minimal selected cross-dependency fields needed by deck overlay rendering. */
export type TraceGraphSelectedCrossDependencySource = {
  /** Stable selected visible cross dependency ref. */
  dependencyRef: VisibleCrossDependencyRef;
  /** Direction of this selected dependency relative to the selected origin span. */
  selectedDirection: TraceSelectedDependencyDirection;
  /** Wait duration used for selected-overlay coloring. */
  waitTimeMs: number;
  /** Whether the overlay should render arrowheads in both directions. */
  bidirectional: boolean;
};

/** Carries one visible path block plus its exact runtime span ref. */
export type TraceGraphPathBlockSource = {
  /** Stable visible span ref used for runtime geometry and traversal. */
  spanRef: SpanRef;
  /** Stable visible block id kept as compatibility metadata. */
  spanId: TraceSpanId;
  /** Exact visible span source resolved for the current filtered graph. */
  span: TraceSpanDisplaySource;
};

/** Carries one visible path local dependency plus its canonical runtime ref. */
export type TraceGraphPathLocalDependencySource = {
  /** Stable visible local dependency ref used for runtime geometry and traversal. */
  dependencyRef: VisibleLocalDependencyRef;
  /** Exact visible local dependency source resolved for the current filtered graph. */
  dependency: TraceLocalDependencySource;
};

/** Carries one visible path cross dependency plus its canonical runtime ref. */
export type TraceGraphPathCrossDependencySource = {
  /** Stable visible cross dependency ref used for runtime geometry and traversal. */
  dependencyRef: VisibleCrossDependencyRef;
  /** Exact visible cross dependency source resolved for the current filtered graph. */
  dependency: TraceCrossDependencySource;
};

/** Union describing any visible dependency used by a runtime path overlay. */
export type TraceGraphPathDependencySource =
  | TraceGraphPathLocalDependencySource
  | TraceGraphPathCrossDependencySource;

/** Describes one recursive descendant row reachable from a block. */
export type TraceGraphDescendantEntry = {
  /** Holds the stitched or direct dependency edge used to reach the descendant. */
  dependency: TraceDependency;
  /** Points at the descendant block reached by the dependency walk. */
  childBlock: TraceSpan;
  /** Stores the one-based tree depth of the descendant row. */
  depth: number;
  /** Points at the immediate parent block that produced this descendant entry. */
  parentSpanId: TraceSpanId;
};

/** Configures recursive descendant traversal from one block. */
export type TraceGraphDescendantOptions = TraceGraphDependencyLookupOptions & {
  /** Caps the number of descendant rows returned. */
  limit?: number;
  /** Restricts the traversal to dependencies carrying at least one of these keywords. */
  keywords?: ReadonlySet<string>;
  /**
   * When false, allow a bounded traversal for caller-specific responsiveness.
   *
   * The default is true, preserving exact truncation metadata.
   */
  computeExactTruncatedCount?: boolean;
  /**
   * Limits descendant nodes visited when computeExactTruncatedCount is false.
   *
   * The default is unbounded and this limit is ignored when exact truncation is enabled.
   */
  maxTraversalNodes?: number;
};

/** Captures one bounded recursive descendant traversal result. */
export type TraceGraphDescendantResult = {
  /** Descendant rows in traversal order, truncated to the requested limit. */
  entries: TraceGraphDescendantEntry[];
  /** Whether additional descendants were omitted after applying the cap. */
  isTruncated: boolean;
  /** Counts how many descendant rows were omitted by the cap. */
  truncatedCount: number;
  /** Indicates whether truncatedCount is an exact count or a bounded estimate. */
  truncationCountIsExact: boolean;
  /** Echoes the applied traversal cap. */
  limit: number;
};

/** Captures generic search metadata for a visible block. */
export type TraceGraphVisibleSpanSearchRecord = {
  /** Identifies the exact visible span included in search results. */
  spanRef: SpanRef;
  /** Identifies the visible block included in search results. */
  spanId: TraceSpanId;
  /** Stores the visible block name shown in search results. */
  blockName: string;
  /** Stores the resolved process name for the block. */
  processName: string;
  /** Stores the resolved thread name for the block. */
  threadName: string;
  /** Carries the primary timing used for duration and timestamp searches. */
  primaryTiming: ReturnType<typeof getPrimaryTiming>;
  /** Flattens block keywords for generic search consumers. */
  keywordsText: string;
  /** Provides normalized block-name search text for graph-owned search consumers. */
  searchText: string;
};

/** Resolves filter provenance and visible navigation affordances for one exact span ref. */
export type TraceGraphSpanFilterNavigation = {
  /** Preserves the exact span's active filter provenance for UI presentation. */
  filterMask: TraceSpanFilterMask;
  /** Optional explicit user-facing reason when the span is hidden outside generic filters. */
  reasonLabel?: string;
  /** First visible descendant reachable through the source parent-child walk, when available. */
  visibleDescendantSpanRef: SpanRef | null;
  /** Nearest visible ancestor used by filtered-view rewiring, when available. */
  visibleAncestorSpanRef: SpanRef | null;
};

/** Captures search metadata for any matched span plus its filter provenance. */
export type TraceGraphSpanSearchRecord = TraceGraphVisibleSpanSearchRecord & {
  /** Preserves the matched span's active filter provenance for search-result rendering. */
  filterMask: TraceSpanFilterMask;
  /** Preserves the full matched span visibility reason for result copy and selection behavior. */
  filterReason: TraceGraphSpanFilterReason;
};

/** Visible dependency and endpoint projections by exact span ref. */
export type TraceGraphProjection = {
  /** Incoming visible dependencies by exact span ref. */
  inDependenciesBySpanRef: ReadonlyMap<SpanRef, ReadonlyArray<TraceDependency>>;
  /** Outgoing visible dependencies by exact span ref. */
  outDependenciesBySpanRef: ReadonlyMap<SpanRef, ReadonlyArray<TraceDependency>>;
  /** Visible endpoint rows with resolved dependencies by exact span ref. */
  endpointsWithDependenciesBySpanRef: ReadonlyMap<
    SpanRef,
    ReadonlyArray<[TraceCrossProcessEndpoint, TraceCrossProcessDependency | null]>
  >;
};

/** Compact visible indexes for the filtered graph without materializing a clone. */
export type TraceGraphVisibleIndex = {
  /** Process ids in canonical source order. */
  visibleProcessIds: readonly TraceProcessId[];
  /** Visible span refs by owning process. */
  visibleSpanRefsByProcessId: Readonly<Record<TraceProcessId, readonly SpanRef[]>>;
  /** Visible per-process indexed span-table views. */
  visibleBlockTablesByProcessId: Readonly<Record<TraceProcessId, TraceGraphVisibleSpanTable>>;
  /** Visible local dependency ids by owning process. */
  visibleLocalDependencyIdsByProcessId: Readonly<
    Record<TraceProcessId, readonly TraceDependencyId[]>
  >;
  /** Visible local dependency refs by owning process. */
  visibleLocalDependencyRefsByProcessId: Readonly<
    Record<TraceProcessId, readonly VisibleLocalDependencyRef[]>
  >;
  /** Visible local dependency ids in canonical visible-ref order. */
  visibleLocalDependencyIds: readonly TraceDependencyId[];
  /** Source local dependency refs aligned with visible local dependency ids. */
  visibleLocalDependencySourceRefs: readonly (LocalDependencyRef | null)[];
  /** Visible cross-process dependency ids in render order. */
  visibleCrossDependencyIds: readonly TraceDependencyId[];
  /** Source cross dependency refs aligned with visible cross dependency ids. */
  visibleCrossDependencySourceRefs: readonly (CrossDependencyRef | null)[];
  /** Process-global local dependency refs to canonical visible refs. */
  visibleLocalDependencyRefBySourceRef: ReadonlyMap<LocalDependencyRef, VisibleLocalDependencyRef>;
  /** Global cross dependency refs to canonical visible refs. */
  visibleCrossDependencyRefBySourceRef: ReadonlyMap<CrossDependencyRef, VisibleCrossDependencyRef>;
  /** Owning process ids for exact visible local dependency refs. */
  visibleLocalDependencyProcessIdByRef: ReadonlyMap<VisibleLocalDependencyRef, TraceProcessId>;
  /** Visible dependency refs by touched span ref. */
  visibleDependencyRefsBySpanRef: ReadonlyMap<
    SpanRef,
    readonly (VisibleLocalDependencyRef | VisibleCrossDependencyRef)[]
  >;
  /** Span refs visible after filtering. */
  visibleSpanRefSet: ReadonlySet<SpanRef>;
  /** Dependency ids visible after filtering. */
  visibleDependencyIdSet: ReadonlySet<TraceDependencyId>;
  /** Compact override specs for exact changed visible dependency refs. */
  dependencyOverrideSpecsByRef: ReadonlyMap<
    VisibleLocalDependencyRef | VisibleCrossDependencyRef,
    TraceGraphVisibleDependencyOverride
  >;
  /** Visible local dependency refs attached to a span. */
  visibleLocalDependencyRefsBySpanRef: ReadonlyMap<SpanRef, readonly VisibleLocalDependencyRef[]>;
  /** Visible cross endpoints attached to a span. */
  endpointsBySpanRef: ReadonlyMap<SpanRef, readonly TraceCrossProcessEndpoint[]>;
  /** Primary visible cross endpoint id attached to a span, when any. */
  primaryEndpointIdBySpanRef: ReadonlyMap<SpanRef, TraceCrossProcessEndpointId | null>;
  /** Visible lane metadata inferred during the visible-process pass. */
  visibleLaneLayoutInfo: TraceGraphVisibleLaneLayoutInfo;
};

/** Compact local dependency endpoint rewrite for the filtered visible view. */
export type TraceGraphVisibleLocalDependencyOverride = {
  /** Local dependency endpoint rewrite marker. */
  kind: 'local-rewrite';
  /** Rewritten visible start span ref. */
  startSpanRef: SpanRef;
  /** Rewritten visible end span ref. */
  endSpanRef: SpanRef;
};

/** Compact stitched local parent dependency for the filtered visible view. */
export type TraceGraphVisibleLocalParentOverride = {
  /** Stitched local parent dependency marker. */
  kind: 'local-parent';
  /** Stitched visible start span ref. */
  startSpanRef: SpanRef;
  /** Stitched visible end span ref. */
  endSpanRef: SpanRef;
  /** Dependency timing mode copied from the source row. */
  waitMode: TraceDependency['waitMode'];
  /** Whether the stitched dependency should render bidirectional arrows. */
  bidirectional: boolean;
  /** Wait duration copied from the source row. */
  waitTimeMs: number;
  /** Keyword labels copied from the source row. */
  keywords: readonly string[];
  /** Optional decoded source user data for card/debug boundaries. */
  userData?: Record<string, unknown>;
};

/** Compact stitched cross-process parent dependency for the filtered visible view. */
export type TraceGraphVisibleCrossParentOverride = {
  /** Stitched cross-process parent dependency marker. */
  kind: 'cross-parent';
  /** Endpoint id shown for the stitched visible edge. */
  endpointId: TraceCrossProcessEndpointId;
  /** Stitched start rank number. */
  startRankNum: number;
  /** Stitched end rank number. */
  endRankNum: number;
  /** Original source start span ref kept for filtered endpoint cards when available. */
  sourceStartSpanRef?: SpanRef | undefined;
  /** Original source end span ref kept for filtered endpoint cards when available. */
  sourceEndSpanRef?: SpanRef | undefined;
  /** Stitched visible start span ref. */
  startSpanRef: SpanRef;
  /** Stitched visible end span ref. */
  endSpanRef: SpanRef;
  /** Dependency timing mode copied from the source row. */
  waitMode: TraceDependency['waitMode'];
  /** Whether the stitched dependency should render bidirectional arrows. */
  bidirectional: boolean;
  /** Wait duration copied from the source row. */
  waitTimeMs: number;
  /** Keyword labels copied from the source row. */
  keywords: readonly string[];
  /** Optional decoded source user data for card/debug boundaries. */
  userData?: Record<string, unknown>;
  /** Stitched cross-process topology. */
  topology: string;
  /** Whether the stitched cross edge is still waiting. */
  waiting: boolean;
  /** Whether the stitched cross edge is still unfinished. */
  waitNotFinished: boolean;
};

/** Compact visible dependency override without eager dependency materialization. */
export type TraceGraphVisibleDependencyOverride =
  | TraceGraphVisibleLocalDependencyOverride
  | TraceGraphVisibleLocalParentOverride
  | TraceGraphVisibleCrossParentOverride;

/** Visible lane-count metadata inferred from explicit block lane values. */
export type TraceGraphVisibleLaneLayoutInfo = {
  /** Thread refs to visible lane counts. */
  threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, {laneCount: number}>;
  /** Count of visible spans with an explicit non-negative lane. */
  explicitLaneValueCount: number;
  /** Count of visible threads with explicit lane data. */
  threadsWithLaneDataCount: number;
};

/** Process-scoped visible runtime cache entry keyed by process ref. */
export type TraceGraphVisibleProcessCacheEntry = {
  /** Raw process id that owns the cached runtime artifacts. */
  processId: TraceProcessId;
  /** Process SpanRef table identity captured for cached process-local materializations. */
  spanTable: TraceProcessSpanRefTable | null;
  /** Process SpanRef row count captured for cached process-local materializations. */
  spanTableRowCount: number;
  /** Process SpanRef content generation captured for cached process-local materializations. */
  spanTableGeneration: number | null;
  /** Active graph SpanRef array identity captured for cached process-local materializations. */
  activeSpanRefs: readonly SpanRef[] | null;
  /** Active graph SpanRef count captured for cached process-local materializations. */
  activeSpanRefCount: number;
  /** First active graph SpanRef captured for cached process-local materializations. */
  firstActiveSpanRef: SpanRef | null;
  /** Last active graph SpanRef captured for cached process-local materializations. */
  lastActiveSpanRef: SpanRef | null;
  /** Visible geometry sources in canonical visible order. */
  geometrySources?: readonly TraceSpanGeometrySource[];
  /** Visible display sources in canonical visible order. */
  displaySources?: readonly TraceSpanDisplaySource[];
  /** Visible block ids to cached display-source indexes. */
  displaySourceIndexBySpanId?: ReadonlyMap<TraceSpanId, number>;
  /** Visible span refs to cached display-source indexes. */
  displaySourceIndexBySpanRef?: ReadonlyMap<SpanRef, number>;
  /** Visible render spans in canonical visible order. */
  renderSpans?: readonly TraceRenderSpan[];
  /** Visible span refs in canonical visible order for ref-native render paths. */
  renderSpanRefs?: readonly SpanRef[];
  /** Visible local dependency refs in canonical visible order for ref-native render paths. */
  localDependencyRefs?: readonly VisibleLocalDependencyRef[];
  /** Lightweight visible local dependency layout sources. */
  localDependencyLayoutSources?: readonly TraceLayoutLaneDependencySource[];
  /** Visible local dependency sources in canonical visible order. */
  localDependencySources?: readonly TraceLocalDependencySource[];
};

/** Visible runtime materializations layered on the compact visible index. */
export type TraceGraphVisibleRuntimeCache = {
  /** Process-scoped visible runtime materializations by process ref. */
  processEntriesByRef: Map<ProcessRef, TraceGraphVisibleProcessCacheEntry>;
  /** Visible dependency sources by exact runtime dependency ref. */
  dependencySourcesByRef: Map<
    TraceDependencyRef | VisibleDependencyRef,
    TraceDependencySource | null
  >;
  /** Starting unfiltered visible local dependency index for each process id. */
  unfilteredLocalDependencyStartIndexByProcessId?: ReadonlyMap<TraceProcessId, number>;
  /** Grouped visible cross dependency sources in render order. */
  crossDependencySources?: readonly TraceCrossDependencySource[];
};

/** Ref-native entity sources and grouped entity views for one runtime graph. */
export type TraceGraphEntitySourceCache = {
  /** Process sources by canonical process ref. */
  processSourcesByRef: ReadonlyMap<ProcessRef, TraceProcessSource>;
  /** Thread sources by canonical thread ref. */
  threadSourcesByRef: ReadonlyMap<ThreadRef, TraceThreadSource>;
  /** Thread sources grouped by owning canonical process ref. */
  threadSourcesByProcessRef: ReadonlyMap<ProcessRef, readonly TraceThreadSource[]>;
  /** Graph-global event sources in canonical event order. */
  eventSources?: readonly TraceEventSource[];
  /** Instant sources in canonical order. */
  instantSources?: readonly TraceInstantSource[];
  /** Instant sources grouped by canonical thread ref. */
  instantSourcesByThreadRef?: ReadonlyMap<ThreadRef, readonly TraceInstantSource[]>;
  /** Counter sources in canonical order. */
  counterSources?: readonly TraceCounterSource[];
  /** Counter sources grouped by canonical thread ref. */
  counterSourcesByThreadRef?: ReadonlyMap<ThreadRef, readonly TraceCounterSource[]>;
  /** Counter extents by canonical thread ref. */
  counterExtentByThreadRef?: ReadonlyMap<ThreadRef, {min: number; max: number}>;
};
