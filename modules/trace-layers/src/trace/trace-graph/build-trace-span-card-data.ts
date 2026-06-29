import {
  buildTraceSpanDescendants,
  getProcessIdByRankNum,
  materializeTraceSpanBySpanRef
} from './trace-graph-selection-utils';
import {
  isCrossDependencyRef,
  isLocalDependencyRef,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from './trace-id-encoder';

import type {
  TraceCrossDependencySource,
  TraceDependencySource,
  TraceLocalDependencySource,
  TraceRenderSpan
} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {
  TraceGraphDescendantOptions,
  TraceGraphDescendantResult,
  TraceSpanFilterMask
} from './trace-graph-types';
import type {
  DependencyRef,
  ProcessRef,
  TraceDependencyRef,
  VisibleDependencyRef
} from './trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependency,
  TraceLocalDependency,
  TraceSpan,
  TraceSpanId,
  TraceThreadId
} from './trace-types';

const DEFAULT_TRACE_SPAN_CARD_DESCENDANT_LIMIT = 1000;
const PARENT_KEYWORD_SET = new Set(['PARENT']);
/** Hard cap applied independently to each dependency-derived span-card section. */
export const DEFAULT_TRACE_SPAN_CARD_DEPENDENCY_LIMIT = 100;
const EMPTY_TRACE_SPAN_CARD_ENDPOINT_DEPENDENCY_ENTRY_COLLECTION = {
  entries: [],
  totalCount: 0,
  truncated: false
} satisfies TraceSpanCardEndpointDependencyEntryCollection;

/** Dependency edge shape exposed by selected-card compatibility helpers. */
export type TraceCardDependency = TraceDependency;

/** Cross-process dependency edge shape exposed by selected-card compatibility helpers. */
export type TraceCardCrossDependency = TraceCrossProcessDependency;

/** Lightweight span row used by selected-card surfaces without exposing TraceSpan objects. */
export type TraceCardSpan = {
  /** Stable process-local span ref for runtime selection and geometry. */
  spanRef: SpanRef;
  /** Stable source span id kept as display and debug metadata. */
  spanId: TraceSpanId;
  /** Owning stream id. */
  threadId: TraceThreadId;
  /** Human-readable process label attached to the span. */
  processName: string;
  /** Span display name. */
  name: string;
  /** Optional keyword labels shown in cards, search, and filters. */
  keywords?: string[];
  /** Optional unresolved cross-rank endpoint id kept for color hooks. */
  crossProcessEndpointId: TraceCrossProcessEndpointId | null;
  /** Structured unresolved cross-rank endpoints kept for color hooks. */
  crossProcessDependencyEndpoints: TraceCrossProcessEndpoint[];
  /** Primary timing key selected for the span. */
  primaryTimingKey: string;
  /** Available timing projections keyed by source. */
  timings: Record<string, TraceSpan['timings'][string]>;
  /** Optional span user data shown by the card. */
  userData?: Record<string, unknown>;
  /** Bitmask describing which graph filters matched this span. */
  filterMask: TraceSpanFilterMask;
  /** Whether this span is removed from the rendered filtered view. */
  isFiltered: boolean;
};

/** Process-aware parent-chain row for the selected span card. */
export type TraceSpanCardParentChainEntry = {
  /** Stable process-local span ref for the parent row. */
  spanRef: SpanRef;
  /** Exact parent span data resolved from the span ref. */
  span: TraceCardSpan;
  /** One-based position of the row within the full raw parent chain. */
  chainIndex: number;
  /** Whether the parent row is removed from the rendered filtered view. */
  isFiltered: boolean;
};

/** Directional dependency row for the selected span card. */
export type TraceSpanCardDependencyEntry = {
  /** Dependency edge backing the selected-card row. */
  dependency: TraceDependency;
  /** Raw dependency ref when the dependency can be resolved without the visible projection. */
  dependencyRef: DependencyRef | null;
  /** Visible dependency ref when the dependency is present in the current filtered view. */
  visibleDependencyRef: VisibleDependencyRef | null;
  /** Stable process-local span ref for the dependency source span. */
  startSpanRef: SpanRef;
  /** Stable process-local span ref for the dependency destination span. */
  endSpanRef: SpanRef;
  /** Exact dependency source span data resolved from the span ref. */
  startSpan: TraceCardSpan;
  /** Exact dependency destination span data resolved from the span ref. */
  endSpan: TraceCardSpan;
};

/** Bounded dependency rows plus the uncapped directional count for one span-card section. */
export type TraceSpanCardDependencyEntryCollection = {
  /** Dependency rows retained under the section cap. */
  entries: TraceSpanCardDependencyEntry[];
  /** Total dependency row count before the section cap. */
  totalCount: number;
  /** Whether additional dependency rows were omitted by the section cap. */
  truncated: boolean;
};

/** Visible child-dependency row for the selected span card. */
export type TraceSpanCardChildDependency = {
  /** Dependency edge backing the child row. */
  dependency: TraceDependency;
  /** Stable process-local span ref for the child span. */
  childSpanRef: SpanRef;
  /** Exact child span data resolved from the span ref. */
  childSpan: TraceCardSpan;
};

/** Recursive descendant row reachable from the selected span card. */
export type TraceSpanCardDescendantEntry = {
  /** Dependency edge used to reach the descendant. */
  dependency: TraceDependency;
  /** Visible dependency ref when the descendant edge is visible in the filtered graph. */
  visibleDependencyRef: VisibleDependencyRef | null;
  /** Exact dependency source span data resolved from the dependency start ref. */
  startSpan: TraceCardSpan;
  /** Exact dependency destination span data resolved from the dependency end ref. */
  endSpan: TraceCardSpan;
  /** Stable process-local span ref for the descendant span. */
  childSpanRef: SpanRef;
  /** Exact descendant span data resolved from the span ref. */
  childSpan: TraceCardSpan;
  /** Stores the one-based tree depth of the descendant row. */
  depth: number;
  /** Stable source parent span id kept for compatibility/debug metadata. */
  parentSpanId: TraceSpanId;
};

/** Captures one bounded recursive descendant traversal result for span-card rendering. */
export type TraceSpanCardDescendantResult = Omit<TraceGraphDescendantResult, 'entries'> & {
  /** Descendant rows in traversal order, truncated to the requested limit. */
  entries: TraceSpanCardDescendantEntry[];
};

/** Cross-process endpoint row for the selected span card. */
export type TraceSpanCardEndpointDependencyEntry = {
  /** Endpoint metadata attached to the selected span. */
  endpoint: TraceCrossProcessEndpoint;
  /** Resolved dependency when the endpoint is backed by a loaded edge. */
  dependency: TraceCrossProcessDependency | null;
  /** Visible dependency ref when the dependency is present in the current filtered view. */
  visibleDependencyRef: VisibleDependencyRef | null;
  /** Resolved target span for direct navigation and labels, when loaded. */
  targetSpan: TraceCardSpan | null;
};

/** Bounded cross-rank endpoint rows plus the uncapped endpoint count for one span card. */
export type TraceSpanCardEndpointDependencyEntryCollection = {
  /** Cross-rank endpoint rows retained under the section cap. */
  entries: TraceSpanCardEndpointDependencyEntry[];
  /** Total cross-rank endpoint count before the section cap. */
  totalCount: number;
  /** Whether additional cross-rank endpoint rows were omitted by the section cap. */
  truncated: boolean;
};

/** Complete selected-span data bundle consumed by TraceSpanCard. */
export type TraceSpanCardModel = {
  /** Exact selected span data resolved from the card input ref. */
  span: TraceCardSpan;
  /** Earliest graph-relative time shared by timings and histogram tabs. */
  traceMinTimeMs: number;
  /** Human-readable process label for the selected span. */
  processName: string;
  /** Human-readable thread or stream label for the selected span. */
  streamLabel: string;
  /** Incoming dependency rows for visible parent/dependency rendering. */
  visibleIncomingDependencyEntries: TraceSpanCardDependencyEntry[];
  /** Total visible incoming dependency count before card row capping. */
  visibleIncomingDependencyEntryCount: number;
  /** Whether visible incoming dependency rows were capped. */
  visibleIncomingDependencyEntriesTruncated: boolean;
  /** Incoming dependency rows including hidden spans. */
  fullIncomingDependencyEntries: TraceSpanCardDependencyEntry[];
  /** Total incoming dependency count including hidden spans before card row capping. */
  fullIncomingDependencyEntryCount: number;
  /** Whether incoming dependency rows including hidden spans were capped. */
  fullIncomingDependencyEntriesTruncated: boolean;
  /** Outgoing dependency rows for visible dependent/dependency rendering. */
  visibleOutgoingDependencyEntries: TraceSpanCardDependencyEntry[];
  /** Total visible outgoing dependency count before card row capping. */
  visibleOutgoingDependencyEntryCount: number;
  /** Whether visible outgoing dependency rows were capped. */
  visibleOutgoingDependencyEntriesTruncated: boolean;
  /** Outgoing dependency rows including hidden spans. */
  fullOutgoingDependencyEntries: TraceSpanCardDependencyEntry[];
  /** Total outgoing dependency count including hidden spans before card row capping. */
  fullOutgoingDependencyEntryCount: number;
  /** Whether outgoing dependency rows including hidden spans were capped. */
  fullOutgoingDependencyEntriesTruncated: boolean;
  /** Full parent chain regardless of filtering. */
  fullParentChain: TraceSpanCardParentChainEntry[];
  /** Visible parent chain after filtering. */
  visibleParentChain: TraceSpanCardParentChainEntry[];
  /** Cross-process dependency endpoint rows for the compact cross-rank summary. */
  endpointsWithDeps: TraceSpanCardEndpointDependencyEntry[];
  /** Total cross-rank endpoint count before card row capping. */
  endpointDependencyEntryCount: number;
  /** Whether cross-rank endpoint rows were capped. */
  endpointsWithDepsTruncated: boolean;
};

/** Builds the lightweight span-card span row for one exact runtime span ref. */
export function buildTraceCardSpan(params: {
  /** Graph that owns the span ref. */
  traceGraph: Readonly<TraceGraph>;
  /** Exact runtime span ref to resolve. */
  spanRef: SpanRef;
  /** Optional pre-resolved block used to avoid duplicate materialization. */
  block?: Readonly<TraceSpan | TraceRenderSpan>;
}): TraceCardSpan | null {
  const block = params.block ?? params.traceGraph.getSpanRenderSource(params.spanRef);
  if (!block) {
    return null;
  }

  const filterReason = params.traceGraph.spanFilterReason(params.spanRef);
  return {
    spanRef: params.spanRef,
    spanId: block.spanId,
    threadId: block.threadId,
    processName: block.processName,
    name: block.name,
    keywords: block.keywords ? [...block.keywords] : undefined,
    crossProcessEndpointId: block.crossProcessEndpointId,
    crossProcessDependencyEndpoints: [...block.crossProcessDependencyEndpoints],
    primaryTimingKey: block.primaryTimingKey,
    timings: block.timings,
    userData: block.userData,
    filterMask: filterReason.filterMask,
    isFiltered: filterReason.isFiltered
  };
}

/** Returns the selected-card dependency edge without materializing block-id state. */
export function buildTraceCardDependency(params: {
  /** Dependency edge currently used as the projection source. */
  dependency: Readonly<TraceDependency>;
  /** Optional graph source kept for call sites that already carry it. */
  traceGraph?: unknown;
}): TraceCardDependency {
  return params.dependency;
}

/** Returns the selected-card cross-process dependency edge without materializing block-id state. */
export function buildTraceCardCrossDependency(params: {
  /** Cross-process dependency edge currently used as the projection source. */
  dependency: Readonly<TraceCrossProcessDependency>;
}): TraceCardCrossDependency {
  return params.dependency;
}

/** Builds process-aware parent-chain rows for the selected span card. */
export function getTraceSpanParentChainEntries(params: {
  /** Exact selected span ref. */
  spanRef: SpanRef;
  /** Graph that owns the selected span. */
  traceGraph: Readonly<TraceGraph>;
  /** Whether hidden parent rows should be included. */
  includeHidden: boolean;
}): TraceSpanCardParentChainEntry[] {
  const fullParentChain = params.traceGraph.getParentDependencyChainEntriesBySpanRef(
    params.spanRef
  );
  const parentChain = params.includeHidden
    ? fullParentChain
    : fullParentChain.filter(entry => !entry.isFiltered);
  return parentChain;
}

/** Builds process-aware incoming dependency rows for the selected span card. */
export function getTraceSpanIncomingDependencyEntries(params: {
  /** Exact selected span ref. */
  spanRef: SpanRef;
  /** Graph that owns the selected span. */
  traceGraph: Readonly<TraceGraph>;
  /** Whether hidden dependency rows should be included. */
  includeHidden: boolean;
  /** Maximum dependency rows to materialize. */
  limit?: number;
}): TraceSpanCardDependencyEntry[] {
  return getTraceSpanDirectionalDependencyEntryCollection({
    ...params,
    direction: 'incoming'
  }).entries;
}

/** Builds process-aware outgoing dependency rows for the selected span card. */
export function getTraceSpanOutgoingDependencyEntries(params: {
  /** Exact selected span ref. */
  spanRef: SpanRef;
  /** Graph that owns the selected span. */
  traceGraph: Readonly<TraceGraph>;
  /** Whether hidden dependency rows should be included. */
  includeHidden: boolean;
  /** Maximum dependency rows to materialize. */
  limit?: number;
}): TraceSpanCardDependencyEntry[] {
  return getTraceSpanDirectionalDependencyEntryCollection({
    ...params,
    direction: 'outgoing'
  }).entries;
}

/** Returns recursive descendant rows reachable from the selected span card. */
export function getTraceSpanDescendants(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef,
  options: TraceGraphDescendantOptions = {}
): TraceSpanCardDescendantResult {
  const block = materializeTraceSpanBySpanRef(traceGraph, spanRef);
  if (!block) {
    return {
      entries: [],
      isTruncated: false,
      truncatedCount: 0,
      truncationCountIsExact: true,
      limit: options.limit ?? DEFAULT_TRACE_SPAN_CARD_DESCENDANT_LIMIT
    };
  }

  const result = buildTraceSpanDescendants({
    block,
    traceGraph,
    includeHidden: options.includeHidden ?? false,
    keywords: options.keywords ?? PARENT_KEYWORD_SET,
    limit: options.limit ?? DEFAULT_TRACE_SPAN_CARD_DESCENDANT_LIMIT,
    computeExactTruncatedCount: options.computeExactTruncatedCount ?? true,
    maxTraversalNodes: options.maxTraversalNodes
  });
  return {
    ...result,
    entries: result.entries.flatMap(entry => {
      const processRef = traceGraph.getProcessRefBySpanRef(spanRef);
      const childSpanRef =
        entry.childBlock.spanRef ??
        (processRef == null
          ? null
          : traceGraph.getProcessScopedSpanRef(processRef, entry.childBlock.spanId));
      if (childSpanRef == null) {
        return [];
      }
      const childSpan = buildTraceCardSpan({
        traceGraph,
        spanRef: childSpanRef,
        block: entry.childBlock
      });
      const {startSpanRef, endSpanRef} = resolveDependencySpanRefs(
        traceGraph,
        childSpanRef,
        entry.dependency
      );
      const startSpan =
        startSpanRef != null ? buildTraceCardSpan({traceGraph, spanRef: startSpanRef}) : null;
      const endSpan =
        endSpanRef != null ? buildTraceCardSpan({traceGraph, spanRef: endSpanRef}) : null;
      if (!childSpan || !startSpan || !endSpan) {
        return [];
      }
      return [
        {
          dependency: entry.dependency,
          visibleDependencyRef: traceGraph.getVisibleDependencyRefForDependency(entry.dependency),
          startSpan,
          endSpan,
          childSpanRef,
          childSpan,
          depth: entry.depth,
          parentSpanId: entry.parentSpanId
        } satisfies TraceSpanCardDescendantEntry
      ];
    })
  };
}

/** Resolves one process ref from a rank number on the owning graph. */
function getProcessRefForRankNum(
  traceGraph: Readonly<TraceGraph>,
  rankNum: number
): ProcessRef | null {
  const processId = getProcessIdByRankNum(traceGraph).get(rankNum) ?? null;
  if (!processId) {
    return null;
  }

  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  return processIndex < 0 ? null : (traceGraph.getProcessRefs()[processIndex] ?? null);
}

/** Resolves exact source span refs for one dependency entry without relying on global block ids. */
function resolveDependencySpanRefs(
  traceGraph: Readonly<TraceGraph>,
  endSpanRef: SpanRef,
  dependency: Readonly<TraceDependency>
): {
  /** Exact source span ref for the dependency start block. */
  startSpanRef: SpanRef | null;
  /** Exact source span ref for the dependency end block. */
  endSpanRef: SpanRef | null;
} {
  if (dependency.type === 'trace-local-dependency') {
    const processRef = traceGraph.getProcessRefBySpanRef(endSpanRef);
    if (processRef == null) {
      return {
        startSpanRef: dependency.startSpanRef ?? null,
        endSpanRef: dependency.endSpanRef ?? null
      };
    }

    return {
      startSpanRef: traceGraph.getProcessScopedSpanRef(processRef, dependency.startSpanId),
      endSpanRef: traceGraph.getProcessScopedSpanRef(processRef, dependency.endSpanId)
    };
  }

  const startProcessRef = getProcessRefForRankNum(traceGraph, dependency.startRankNum);
  const endProcessRef = getProcessRefForRankNum(traceGraph, dependency.endRankNum);
  return {
    startSpanRef: startProcessRef
      ? traceGraph.getProcessScopedSpanRef(startProcessRef, dependency.startSpanId)
      : (dependency.startSpanRef ?? null),
    endSpanRef: endProcessRef
      ? traceGraph.getProcessScopedSpanRef(endProcessRef, dependency.endSpanId)
      : (dependency.endSpanRef ?? null)
  };
}

/** Returns visible cross-process endpoints paired with resolved dependencies for a span card. */
export function getTraceSpanEndpointsWithDependencies(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceSpanCardEndpointDependencyEntry[] {
  return getTraceSpanEndpointDependencyEntryCollection(
    traceGraph,
    spanRef,
    Number.POSITIVE_INFINITY
  ).entries;
}

/** Returns bounded visible cross-process endpoints paired with resolved dependencies. */
export function getTraceSpanEndpointDependencyEntryCollection(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef,
  limit = DEFAULT_TRACE_SPAN_CARD_DEPENDENCY_LIMIT
): TraceSpanCardEndpointDependencyEntryCollection {
  const normalizedLimit = normalizeTraceSpanCardDependencyLimit(limit);
  const span = buildTraceCardSpan({traceGraph, spanRef});
  if (!span) {
    return EMPTY_TRACE_SPAN_CARD_ENDPOINT_DEPENDENCY_ENTRY_COLLECTION;
  }

  if (!traceGraph.hasActiveSpanFilter()) {
    return getUnfilteredTraceSpanEndpointDependencyEntryCollection(
      traceGraph,
      spanRef,
      span,
      normalizedLimit
    );
  }

  const endpointsWithDependencies =
    traceGraph.getProjection().endpointsWithDependenciesBySpanRef.get(spanRef) ?? [];
  const entries = endpointsWithDependencies
    .slice(0, normalizedLimit)
    .map(([endpoint, dependency]) => {
      const targetSpanRef = dependency
        ? dependency.startSpanId === span.spanId
          ? (dependency.endSpanRef ?? null)
          : (dependency.startSpanRef ?? null)
        : null;
      const targetSpan =
        targetSpanRef != null ? buildTraceCardSpan({traceGraph, spanRef: targetSpanRef}) : null;
      return {
        endpoint,
        dependency,
        visibleDependencyRef: dependency
          ? traceGraph.getVisibleDependencyRefForDependency(dependency)
          : null,
        targetSpan
      } satisfies TraceSpanCardEndpointDependencyEntry;
    });
  return {
    entries,
    totalCount: endpointsWithDependencies.length,
    truncated: endpointsWithDependencies.length > entries.length
  };
}

/** Builds selected-card dependency rows for one direction and visibility mode. */
function getTraceSpanDirectionalDependencyEntryCollection(params: {
  spanRef: SpanRef;
  traceGraph: Readonly<TraceGraph>;
  includeHidden: boolean;
  direction: 'incoming' | 'outgoing';
  limit?: number;
}): TraceSpanCardDependencyEntryCollection {
  const limit = normalizeTraceSpanCardDependencyLimit(
    params.limit ?? DEFAULT_TRACE_SPAN_CARD_DEPENDENCY_LIMIT
  );
  const dependencyRefSlice = params.includeHidden
    ? params.traceGraph.getSpanDirectionalDependencyRefSlice(
        params.spanRef,
        params.direction,
        limit
      )
    : params.traceGraph.getVisibleDirectionalDependencyRefSlice(
        params.spanRef,
        params.direction,
        limit
      );
  const entries = dependencyRefSlice.dependencyRefs
    .flatMap(dependencyRef => params.traceGraph.getVisibleDependencySourceByRef(dependencyRef))
    .flatMap(dependencySource =>
      dependencySource
        ? buildTraceSpanCardDependencyEntryFromSource({
            traceGraph: params.traceGraph,
            selectedSpanRef: params.spanRef,
            direction: params.direction,
            dependencySource
          })
        : []
    )
    .filter(entry => {
      const dependencySpan = getTraceSpanCardDependencyPeerSpan(entry, params.direction);
      return params.includeHidden || !dependencySpan.isFiltered;
    })
    .sort((left, right) => right.dependency.waitTimeMs - left.dependency.waitTimeMs);
  return {
    entries,
    totalCount: dependencyRefSlice.totalCount,
    truncated: dependencyRefSlice.truncated
  };
}

/** Returns the peer span displayed in a directional dependency row. */
function getTraceSpanCardDependencyPeerSpan(
  entry: TraceSpanCardDependencyEntry,
  direction: 'incoming' | 'outgoing'
): TraceCardSpan {
  return direction === 'incoming' ? entry.startSpan : entry.endSpan;
}

function getUnfilteredTraceSpanEndpointDependencyEntryCollection(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef,
  span: TraceCardSpan,
  limit: number
): TraceSpanCardEndpointDependencyEntryCollection {
  const dependencyEntries = [
    ...traceGraph
      .getSpanDirectionalCrossDependencyRefSlice(spanRef, 'incoming', limit)
      .dependencyRefs.flatMap(dependencyRef =>
        traceGraph.getVisibleDependencySourceByRef(dependencyRef)
      ),
    ...traceGraph
      .getSpanDirectionalCrossDependencyRefSlice(spanRef, 'outgoing', limit)
      .dependencyRefs.flatMap(dependencyRef =>
        traceGraph.getVisibleDependencySourceByRef(dependencyRef)
      )
  ]
    .filter(
      (dependencySource): dependencySource is TraceCrossDependencySource =>
        dependencySource?.type === 'trace-cross-process-dependency'
    )
    .map(buildCrossProcessDependencyFromSource);
  const endpointDependenciesByKey = new Map<string, TraceCrossProcessDependency>();

  for (const dependency of dependencyEntries) {
    endpointDependenciesByKey.set(
      createEndpointDependencyLookupKey(dependency, spanRef),
      dependency
    );
  }

  const entries = span.crossProcessDependencyEndpoints.slice(0, limit).map(endpoint => {
    const dependency =
      endpointDependenciesByKey.get(createEndpointLookupKey(endpoint)) ??
      endpointDependenciesByKey.get(createReverseEndpointLookupKey(endpoint)) ??
      null;
    const targetSpanRef =
      dependency == null
        ? null
        : dependency.startSpanRef === spanRef
          ? (dependency.endSpanRef ?? null)
          : dependency.endSpanRef === spanRef
            ? (dependency.startSpanRef ?? null)
            : null;
    const targetSpan =
      targetSpanRef != null ? buildTraceCardSpan({traceGraph, spanRef: targetSpanRef}) : null;
    return {
      endpoint,
      dependency,
      visibleDependencyRef: dependency
        ? traceGraph.getVisibleDependencyRefForDependency(dependency)
        : null,
      targetSpan
    } satisfies TraceSpanCardEndpointDependencyEntry;
  });
  return {
    entries,
    totalCount: span.crossProcessDependencyEndpoints.length,
    truncated: span.crossProcessDependencyEndpoints.length > entries.length
  };
}

/** Normalizes finite dependency caps while preserving explicit unbounded card callers. */
function normalizeTraceSpanCardDependencyLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
}

function buildTraceSpanCardDependencyEntryFromSource(params: {
  traceGraph: Readonly<TraceGraph>;
  selectedSpanRef: SpanRef;
  direction: 'incoming' | 'outgoing';
  dependencySource: TraceDependencySource;
}): TraceSpanCardDependencyEntry[] {
  const dependency = buildDependencyFromSource(params.dependencySource);
  const startSpanRef = params.dependencySource.startSpanRef ?? null;
  const endSpanRef = params.dependencySource.endSpanRef ?? null;
  if (
    startSpanRef == null ||
    endSpanRef == null ||
    (params.direction === 'incoming' && endSpanRef !== params.selectedSpanRef) ||
    (params.direction === 'outgoing' && startSpanRef !== params.selectedSpanRef)
  ) {
    return [];
  }
  const startSpan = buildTraceCardSpan({
    traceGraph: params.traceGraph,
    spanRef: startSpanRef
  });
  const endSpan = buildTraceCardSpan({
    traceGraph: params.traceGraph,
    spanRef: endSpanRef
  });
  if (!startSpan || !endSpan) {
    return [];
  }

  return [
    {
      dependency,
      dependencyRef: getSourceDependencyRef(params.dependencySource.dependencyRef),
      visibleDependencyRef:
        getVisibleDependencyRef(params.dependencySource.dependencyRef) ??
        params.traceGraph.getVisibleDependencyRefForDependency(dependency),
      startSpanRef,
      endSpanRef,
      startSpan,
      endSpan
    } satisfies TraceSpanCardDependencyEntry
  ];
}

/** Converts a ref-native dependency source into the card's dependency edge shape. */
function buildDependencyFromSource(dependencySource: TraceDependencySource): TraceDependency {
  return dependencySource.type === 'trace-local-dependency'
    ? buildLocalDependencyFromSource(dependencySource)
    : buildCrossProcessDependencyFromSource(dependencySource);
}

/** Converts a ref-native local dependency source into the card's dependency edge shape. */
function buildLocalDependencyFromSource(
  dependencySource: TraceLocalDependencySource
): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyRef: getLocalDependencyRef(dependencySource.dependencyRef) ?? undefined,
    dependencyId: dependencySource.dependencyId,
    startSpanId: dependencySource.startSpanId,
    endSpanId: dependencySource.endSpanId,
    startSpanRef: dependencySource.startSpanRef,
    endSpanRef: dependencySource.endSpanRef,
    waitMode: dependencySource.waitMode,
    bidirectional: dependencySource.bidirectional,
    waitTimeMs: dependencySource.waitTimeMs,
    keywords: new Set(dependencySource.keywords),
    userData: dependencySource.userData
  } satisfies TraceLocalDependency;
}

/** Converts a ref-native cross dependency source into the card's dependency edge shape. */
function buildCrossProcessDependencyFromSource(
  dependencySource: TraceCrossDependencySource
): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyRef: getCrossDependencyRef(dependencySource.dependencyRef) ?? undefined,
    dependencyId: dependencySource.dependencyId,
    startSpanId: dependencySource.startSpanId,
    endSpanId: dependencySource.endSpanId,
    startSpanRef: dependencySource.startSpanRef,
    endSpanRef: dependencySource.endSpanRef,
    waitMode: dependencySource.waitMode,
    bidirectional: dependencySource.bidirectional,
    waitTimeMs: dependencySource.waitTimeMs,
    keywords: new Set(dependencySource.keywords),
    userData: dependencySource.userData,
    endpointId: dependencySource.endpointId,
    startRankNum: dependencySource.startRankNum,
    endRankNum: dependencySource.endRankNum,
    topology: dependencySource.topology,
    waiting: dependencySource.waiting,
    waitNotFinished: dependencySource.waitNotFinished
  } satisfies TraceCrossProcessDependency;
}

/** Returns a dependency ref compatible with local dependency objects. */
function getLocalDependencyRef(
  dependencyRef: TraceDependencyRef | VisibleDependencyRef | null | undefined
): TraceLocalDependency['dependencyRef'] | null {
  return dependencyRef != null &&
    (isLocalDependencyRef(dependencyRef) || isVisibleLocalDependencyRef(dependencyRef))
    ? dependencyRef
    : null;
}

/** Returns a dependency ref compatible with cross dependency objects. */
function getCrossDependencyRef(
  dependencyRef: TraceDependencyRef | VisibleDependencyRef | null | undefined
): TraceCrossProcessDependency['dependencyRef'] | null {
  return dependencyRef != null &&
    (isCrossDependencyRef(dependencyRef) || isVisibleCrossDependencyRef(dependencyRef))
    ? dependencyRef
    : null;
}

/** Returns the raw dependency ref when a dependency source came from source storage. */
function getSourceDependencyRef(
  dependencyRef: TraceDependencyRef | VisibleDependencyRef | null | undefined
): DependencyRef | null {
  return dependencyRef != null &&
    (isLocalDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef))
    ? (dependencyRef as DependencyRef)
    : null;
}

/** Returns the visible dependency ref when a dependency source came from a visible projection. */
function getVisibleDependencyRef(
  dependencyRef: TraceDependencyRef | VisibleDependencyRef | null | undefined
): VisibleDependencyRef | null {
  return dependencyRef != null &&
    (isVisibleLocalDependencyRef(dependencyRef) || isVisibleCrossDependencyRef(dependencyRef))
    ? (dependencyRef as VisibleDependencyRef)
    : null;
}

function createEndpointLookupKey(endpoint: TraceCrossProcessEndpoint): string {
  return `${endpoint.endpointId}:${endpoint.startRankNum}:${endpoint.endRankNum}`;
}

function createReverseEndpointLookupKey(endpoint: TraceCrossProcessEndpoint): string {
  return `${endpoint.endpointId}:${endpoint.endRankNum}:${endpoint.startRankNum}`;
}

function createEndpointDependencyLookupKey(
  dependency: TraceCrossProcessDependency,
  spanRef: SpanRef
): string {
  return dependency.startSpanRef === spanRef
    ? `${dependency.endpointId}:${dependency.startRankNum}:${dependency.endRankNum}`
    : `${dependency.endpointId}:${dependency.endRankNum}:${dependency.startRankNum}`;
}

/** Returns all selected-card data for one exact span ref. */
export function getTraceSpanCardModel(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceSpanCardModel | null {
  const span = buildTraceCardSpan({traceGraph, spanRef});
  if (!span) {
    return null;
  }

  const stream = traceGraph.getThreadSourceBySpanRef(spanRef);
  const streamLabel = stream?.name?.trim() || span.threadId;
  const processName =
    traceGraph.getProcessSourceBySpanRef(spanRef)?.name?.trim() ||
    span.processName?.trim() ||
    'unknown';
  const visibleIncomingDependencies = getTraceSpanDirectionalDependencyEntryCollection({
    spanRef,
    traceGraph,
    includeHidden: false,
    direction: 'incoming'
  });
  const fullIncomingDependencies = getTraceSpanDirectionalDependencyEntryCollection({
    spanRef,
    traceGraph,
    includeHidden: true,
    direction: 'incoming'
  });
  const visibleOutgoingDependencies = getTraceSpanDirectionalDependencyEntryCollection({
    spanRef,
    traceGraph,
    includeHidden: false,
    direction: 'outgoing'
  });
  const fullOutgoingDependencies = getTraceSpanDirectionalDependencyEntryCollection({
    spanRef,
    traceGraph,
    includeHidden: true,
    direction: 'outgoing'
  });
  const endpointsWithDependencies = getTraceSpanEndpointDependencyEntryCollection(
    traceGraph,
    spanRef
  );

  return {
    span,
    traceMinTimeMs: traceGraph.getTimeBounds().minTimeMs,
    processName,
    streamLabel,
    visibleIncomingDependencyEntries: visibleIncomingDependencies.entries,
    visibleIncomingDependencyEntryCount: visibleIncomingDependencies.totalCount,
    visibleIncomingDependencyEntriesTruncated: visibleIncomingDependencies.truncated,
    fullIncomingDependencyEntries: fullIncomingDependencies.entries,
    fullIncomingDependencyEntryCount: fullIncomingDependencies.totalCount,
    fullIncomingDependencyEntriesTruncated: fullIncomingDependencies.truncated,
    visibleOutgoingDependencyEntries: visibleOutgoingDependencies.entries,
    visibleOutgoingDependencyEntryCount: visibleOutgoingDependencies.totalCount,
    visibleOutgoingDependencyEntriesTruncated: visibleOutgoingDependencies.truncated,
    fullOutgoingDependencyEntries: fullOutgoingDependencies.entries,
    fullOutgoingDependencyEntryCount: fullOutgoingDependencies.totalCount,
    fullOutgoingDependencyEntriesTruncated: fullOutgoingDependencies.truncated,
    fullParentChain: traceGraph.getTraceSpanParentChainEntries(spanRef, {includeHidden: true}),
    visibleParentChain: traceGraph.getTraceSpanParentChainEntries(spanRef),
    endpointsWithDeps: endpointsWithDependencies.entries.sort(
      (left, right) => -(left.endpoint.waitTimeMs - right.endpoint.waitTimeMs)
    ),
    endpointDependencyEntryCount: endpointsWithDependencies.totalCount,
    endpointsWithDepsTruncated: endpointsWithDependencies.truncated
  };
}
