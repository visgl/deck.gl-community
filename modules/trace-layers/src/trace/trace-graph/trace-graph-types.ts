import * as arrow from 'apache-arrow';

import {MappedArrowTable} from '../../arrow-utils';
import {getPrimaryTiming} from './trace-types';

import type {ArrowTraceSameProcessDependencyTable} from '../ingestion/arrow-trace';
import type {
  TraceCounterSource,
  TraceCrossProcessDependencyRenderSource,
  TraceEventSource,
  TraceInstantSource,
  TraceProcessSource,
  TraceSameProcessDependencySource,
  TraceSpanDetailSource,
  TraceThreadSource
} from '../trace-graph-accessors';
import type {
  CrossProcessDependencyRef,
  ProcessRef,
  SameProcessDependencyRef,
  ThreadRef
} from './trace-id-encoder';
import type {SpanRef, TraceDependency, TraceSpan, TraceSpanId} from './trace-types';

/** No span filter matched this row. */
export const TRACE_SPAN_FILTER_MASK_NONE = 0x00;
/** Text, prefix, or regexp span filtering matched this row. */
export const TRACE_SPAN_FILTER_MASK_REGEXP = 0x01;
/** Source-column filename/source filtering matched this row. */
export const TRACE_SPAN_FILTER_MASK_SOURCE = 0x02;

/** Compact bitmask describing why one span is filtered from rendered geometry. */
export type TraceSpanFilterMask = number;

/** Current graph/store visibility state for one exact span ref. */
export type TraceGraphSpanFilterState =
  | 'visible'
  | 'filtered'
  | 'outside-window'
  | 'not-loaded'
  | 'unknown';

/** View-owned filtered state and provenance for one exact span ref. */
export type TraceGraphSpanFilterReason = {
  /** Whether the exact span ref is removed from the current rendered graph. */
  isFiltered: boolean;
  /** Bitmask describing which graph filters matched this span. */
  filterMask: TraceSpanFilterMask;
  /** Visibility reason for this span ref in the current materialized graph. */
  state: TraceGraphSpanFilterState;
};

/** Optional loaded-row text used to explain refs missing from the current graph. */
export type TraceGraphSpanFilterReasonInput = {
  /** Span name checked against active graph text filters. */
  readonly spanName: string;
  /** Optional source text checked against active graph text filters. */
  readonly source?: string | null;
};

/** Store-owned availability for a span ref missing from the current materialized graph. */
export type TraceGraphSpanStoreAvailability = 'outside-window' | 'not-loaded' | 'unknown';

/** Minimal active-graph facade passed to store-backed span search helpers. */
export type TraceGraphSpanSearchContext = {
  /** Returns view-owned filtered state and provenance for one exact span ref. */
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

/** Optional lookup surface for loaded rows outside the active immutable dataset view. */
export type TraceGraphSpanLookupStore = {
  /** Returns availability for one span ref missing from the active dataset view. */
  getSpanRefAvailability?: (spanRef: SpanRef) => TraceGraphSpanStoreAvailability;
  /** Searches already loaded store rows without triggering chunk loads. */
  searchSpans?: (params: TraceGraphSpanStoreSearchParams) => readonly TraceGraphSpanSearchRecord[];
  /** Resolves lightweight render data for a store-backed span missing from the materialized graph. */
  getSpanDetailSource?: (spanRef: SpanRef) => TraceSpanDetailSource | null;
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

/** Extracts the Arrow type map used by canonical same-process-dependency tables. */
export type ArrowTraceSameProcessDependencyTableTypeMap =
  ArrowTraceSameProcessDependencyTable extends arrow.Table<infer TTypeMap> ? TTypeMap : never;
/** Dependency-id keyed same-process-dependency table lookup. */
export type TraceGraphSameProcessDependencyLookup =
  MappedArrowTable<ArrowTraceSameProcessDependencyTableTypeMap>;

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
  /** Visible same-process dependency refs reached while walking incoming dependencies. */
  parentSameProcessDependencyRefs: SameProcessDependencyRef[];
  /** Visible cross-process dependency refs reached while walking incoming dependencies. */
  parentCrossProcessDependencyRefs: CrossProcessDependencyRef[];
  /** Visible same-process dependency refs reached while walking outgoing dependencies. */
  childSameProcessDependencyRefs: SameProcessDependencyRef[];
  /** Visible cross-process dependency refs reached while walking outgoing dependencies. */
  childCrossProcessDependencyRefs: CrossProcessDependencyRef[];
  /** Ordered visible same-process dependency refs reached by the full traversal. */
  visibleSameProcessDependencyRefs: SameProcessDependencyRef[];
  /** Ordered visible cross-process dependency refs reached by the full traversal. */
  visibleCrossProcessDependencyRefs: CrossProcessDependencyRef[];
};

/** Direction of a selected dependency relative to the selected origin span. */
export type TraceSelectedDependencyDirection = 'incoming' | 'outgoing';

/** Carries the minimal selected same-process-dependency fields needed by deck overlay rendering. */
export type TraceGraphSelectedSameProcessDependencySource = {
  /** Stable selected visible same-process dependency ref. */
  dependencyRef: SameProcessDependencyRef;
  /** Owning process ref used to group overlays by rank layer. */
  processRef: ProcessRef;
  /** Direction of this selected dependency relative to the selected origin span. */
  selectedDirection: TraceSelectedDependencyDirection;
  /** Wait duration used for selected-overlay coloring. */
  waitTimeMs: number;
  /** Whether the overlay should render arrowheads in both directions. */
  bidirectional: boolean;
};

/** Carries the minimal selected cross-process-dependency fields needed by deck overlay rendering. */
export type TraceGraphSelectedCrossProcessDependencySource = {
  /** Stable selected visible cross-process dependency ref. */
  dependencyRef: CrossProcessDependencyRef;
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
  span: TraceSpanDetailSource;
};

/** Carries one visible path same-process dependency plus its canonical runtime ref. */
export type TraceGraphPathSameProcessDependencySource = {
  /** Stable visible same-process dependency ref used for runtime geometry and traversal. */
  dependencyRef: SameProcessDependencyRef;
  /** Exact visible same-process dependency source resolved for the current filtered graph. */
  dependency: TraceSameProcessDependencySource;
};

/** Carries one visible path cross-process dependency plus its canonical runtime ref. */
export type TraceGraphPathCrossProcessDependencySource = {
  /** Stable visible cross-process dependency ref used for runtime geometry and traversal. */
  dependencyRef: CrossProcessDependencyRef;
  /** Exact visible cross-process dependency source resolved for the current filtered graph. */
  dependency: TraceCrossProcessDependencyRenderSource;
};

/** Union describing any visible dependency used by a runtime path overlay. */
export type TraceGraphPathDependencySource =
  | TraceGraphPathSameProcessDependencySource
  | TraceGraphPathCrossProcessDependencySource;

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

/** Visible lane-count metadata inferred from explicit block lane values. */
export type TraceGraphVisibleLaneLayoutInfo = {
  /** Thread refs to visible lane counts. */
  threadLaneLayoutMapByRef?: ReadonlyMap<ThreadRef, {laneCount: number}>;
  /** Count of visible spans with an explicit non-negative lane. */
  explicitLaneValueCount: number;
  /** Count of visible threads with explicit lane data. */
  threadsWithLaneDataCount: number;
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
