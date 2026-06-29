import type {TraceGraph} from './trace-graph';
import type {TraceGraphFilteredSpanCountsByFilter} from './trace-graph-types';
import type {ProcessRef, ThreadRef} from './trace-id-encoder';
import type {SpanRef} from './trace-types';

/** Filter-popup span-attribution counts grouped by the first active filter stage that removed them. */
export type TraceFilterSummarySpanCountsByFilter = TraceGraphFilteredSpanCountsByFilter;

/** Visible, total, and filtered entity counts rendered in compact Tracevis filter diagnostics. */
export type TraceFilterSummary = {
  /** Number of processes that remain visible after active span filtering. */
  readonly visibleProcessCount: number;
  /** Number of source processes before active span filtering. */
  readonly totalProcessCount: number;
  /** Number of processes removed from the visible graph by active span filtering. */
  readonly filteredProcessCount: number;
  /** Number of threads that still own at least one visible span after active span filtering. */
  readonly visibleThreadCount: number;
  /** Number of source threads before active span filtering. */
  readonly totalThreadCount: number;
  /** Number of threads with no visible spans remaining after filtering. */
  readonly filteredThreadCount: number;
  /** Number of spans that remain visible after active span filtering. */
  readonly visibleSpanCount: number;
  /** Number of source spans before active span filtering. */
  readonly totalSpanCount: number;
  /** Number of spans removed from the visible graph by active span filtering. */
  readonly filteredSpanCount: number;
  /** Filtered-span attribution counts grouped by the first active filter stage that removed them. */
  readonly filteredSpanCountsByFilter: TraceFilterSummarySpanCountsByFilter;
  /** Number of local dependencies that remain visible after active span filtering. */
  readonly visibleLocalDependencyCount: number;
  /** Number of source local dependencies before active span filtering. */
  readonly totalLocalDependencyCount: number;
  /** Number of local dependencies removed from the visible graph by active span filtering. */
  readonly filteredLocalDependencyCount: number;
  /** Number of cross-process dependencies that remain visible after active span filtering. */
  readonly visibleCrossDependencyCount: number;
  /** Number of source cross-process dependencies before active span filtering. */
  readonly totalCrossDependencyCount: number;
  /** Number of cross-process dependencies removed from the visible graph by active span filtering. */
  readonly filteredCrossDependencyCount: number;
  /** Whether any filtered-out entity count is nonzero. */
  readonly hasFilteredItems: boolean;
};

/** Lazily builds one aggregated filter summary for the currently displayed trace graphs. */
export function buildTraceFilterSummary(
  traceGraphs: readonly Readonly<TraceGraph>[]
): TraceFilterSummary {
  return traceGraphs.reduce<TraceFilterSummary>(
    (summary, traceGraph) =>
      mergeTraceFilterSummaries(summary, buildSingleTraceFilterSummary(traceGraph)),
    EMPTY_TRACE_FILTER_SUMMARY
  );
}

/** Returns whether any displayed trace graph already knows that filtering removed at least one span. */
export function hasTraceFilteredItems(traceGraphs: readonly Readonly<TraceGraph>[]): boolean {
  return traceGraphs.some(traceGraph => traceGraph.filteredSpanRefs.size > 0);
}

const EMPTY_TRACE_FILTER_SUMMARY: TraceFilterSummary = {
  visibleProcessCount: 0,
  totalProcessCount: 0,
  filteredProcessCount: 0,
  visibleThreadCount: 0,
  totalThreadCount: 0,
  filteredThreadCount: 0,
  visibleSpanCount: 0,
  totalSpanCount: 0,
  filteredSpanCount: 0,
  filteredSpanCountsByFilter: {
    spanFilterCount: 0,
    overlappingParentSpanFilterCount: 0,
    similarDurationChainSpanFilterCount: 0
  },
  visibleLocalDependencyCount: 0,
  totalLocalDependencyCount: 0,
  filteredLocalDependencyCount: 0,
  visibleCrossDependencyCount: 0,
  totalCrossDependencyCount: 0,
  filteredCrossDependencyCount: 0,
  hasFilteredItems: false
};

function buildSingleTraceFilterSummary(traceGraph: Readonly<TraceGraph>): TraceFilterSummary {
  if (!traceGraph.hasActiveSpanFilter() || traceGraph.filteredSpanRefs.size === 0) {
    return createTraceFilterSummary({
      visibleProcessCount: traceGraph.stats.processCount,
      totalProcessCount: traceGraph.stats.processCount,
      visibleThreadCount: traceGraph.stats.threadCount,
      totalThreadCount: traceGraph.stats.threadCount,
      visibleSpanCount: traceGraph.stats.spanCount,
      totalSpanCount: traceGraph.stats.spanCount,
      filteredSpanCountsByFilter: traceGraph.filteredSpanCountsByFilter,
      visibleLocalDependencyCount: traceGraph.stats.localDependencyCount,
      totalLocalDependencyCount: traceGraph.stats.localDependencyCount,
      visibleCrossDependencyCount: traceGraph.stats.crossDependencyCount,
      totalCrossDependencyCount: traceGraph.stats.crossDependencyCount
    });
  }

  const sourceProcessRefs = traceGraph.getProcessRefs();
  const visibleThreadRefs = buildVisibleThreadRefSet(traceGraph, sourceProcessRefs);
  const visibleLocalDependencyCount = sourceProcessRefs.reduce(
    (count, processRef) => count + traceGraph.getVisibleLocalDependencyRefs(processRef).length,
    0
  );
  const filteredProcessCount = sourceProcessRefs.filter(
    processRef => traceGraph.getVisibleProcessRenderSpanRefs(processRef).length === 0
  ).length;
  const filteredThreadCount = sourceProcessRefs.reduce((count, processRef) => {
    return (
      count +
      traceGraph
        .getThreadSourcesByProcessRef(processRef)
        .filter(thread => !visibleThreadRefs.has(thread.threadRef)).length
    );
  }, 0);
  const filteredSpanCount = traceGraph.filteredSpanRefs.size;
  const filteredCrossDependencyCount = clampFilteredCount(
    traceGraph.stats.crossDependencyCount,
    traceGraph.getVisibleCrossDependencySources().length
  );

  return createTraceFilterSummary({
    visibleProcessCount: traceGraph.stats.processCount - filteredProcessCount,
    totalProcessCount: traceGraph.stats.processCount,
    visibleThreadCount: traceGraph.stats.threadCount - filteredThreadCount,
    totalThreadCount: traceGraph.stats.threadCount,
    visibleSpanCount: traceGraph.stats.spanCount - filteredSpanCount,
    totalSpanCount: traceGraph.stats.spanCount,
    filteredSpanCountsByFilter: traceGraph.filteredSpanCountsByFilter,
    visibleLocalDependencyCount,
    totalLocalDependencyCount: traceGraph.stats.localDependencyCount,
    visibleCrossDependencyCount:
      traceGraph.stats.crossDependencyCount - filteredCrossDependencyCount,
    totalCrossDependencyCount: traceGraph.stats.crossDependencyCount
  });
}

function buildVisibleThreadRefSet(
  traceGraph: Readonly<TraceGraph>,
  sourceProcessRefs: readonly ProcessRef[]
): ReadonlySet<ThreadRef> {
  const visibleThreadRefs = new Set<ThreadRef>();
  for (const processRef of sourceProcessRefs) {
    for (const spanRef of traceGraph.getVisibleProcessRenderSpanRefs(processRef)) {
      addVisibleThreadRef(traceGraph, visibleThreadRefs, spanRef);
    }
  }
  return visibleThreadRefs;
}

function addVisibleThreadRef(
  traceGraph: Readonly<TraceGraph>,
  visibleThreadRefs: Set<ThreadRef>,
  spanRef: SpanRef
): void {
  const threadRef = traceGraph.getThreadRefBySpanRef(spanRef);
  if (threadRef != null) {
    visibleThreadRefs.add(threadRef);
  }
}

function mergeTraceFilterSummaries(
  left: TraceFilterSummary,
  right: TraceFilterSummary
): TraceFilterSummary {
  return createTraceFilterSummary({
    visibleProcessCount: left.visibleProcessCount + right.visibleProcessCount,
    totalProcessCount: left.totalProcessCount + right.totalProcessCount,
    visibleThreadCount: left.visibleThreadCount + right.visibleThreadCount,
    totalThreadCount: left.totalThreadCount + right.totalThreadCount,
    visibleSpanCount: left.visibleSpanCount + right.visibleSpanCount,
    totalSpanCount: left.totalSpanCount + right.totalSpanCount,
    filteredSpanCountsByFilter: mergeTraceFilteredSpanCountsByFilter(
      left.filteredSpanCountsByFilter,
      right.filteredSpanCountsByFilter
    ),
    visibleLocalDependencyCount:
      left.visibleLocalDependencyCount + right.visibleLocalDependencyCount,
    totalLocalDependencyCount: left.totalLocalDependencyCount + right.totalLocalDependencyCount,
    visibleCrossDependencyCount:
      left.visibleCrossDependencyCount + right.visibleCrossDependencyCount,
    totalCrossDependencyCount: left.totalCrossDependencyCount + right.totalCrossDependencyCount
  });
}

function createTraceFilterSummary(params: {
  readonly visibleProcessCount: number;
  readonly totalProcessCount: number;
  readonly visibleThreadCount: number;
  readonly totalThreadCount: number;
  readonly visibleSpanCount: number;
  readonly totalSpanCount: number;
  readonly filteredSpanCountsByFilter: TraceFilterSummarySpanCountsByFilter;
  readonly visibleLocalDependencyCount: number;
  readonly totalLocalDependencyCount: number;
  readonly visibleCrossDependencyCount: number;
  readonly totalCrossDependencyCount: number;
}): TraceFilterSummary {
  const filteredProcessCount = clampFilteredCount(
    params.totalProcessCount,
    params.visibleProcessCount
  );
  const filteredThreadCount = clampFilteredCount(
    params.totalThreadCount,
    params.visibleThreadCount
  );
  const filteredSpanCount = clampFilteredCount(params.totalSpanCount, params.visibleSpanCount);
  const filteredLocalDependencyCount = clampFilteredCount(
    params.totalLocalDependencyCount,
    params.visibleLocalDependencyCount
  );
  const filteredCrossDependencyCount = clampFilteredCount(
    params.totalCrossDependencyCount,
    params.visibleCrossDependencyCount
  );
  const hasFilteredItems =
    filteredProcessCount > 0 ||
    filteredThreadCount > 0 ||
    filteredSpanCount > 0 ||
    filteredLocalDependencyCount > 0 ||
    filteredCrossDependencyCount > 0;
  return {
    ...params,
    filteredProcessCount,
    filteredThreadCount,
    filteredSpanCount,
    filteredLocalDependencyCount,
    filteredCrossDependencyCount,
    hasFilteredItems
  };
}

function mergeTraceFilteredSpanCountsByFilter(
  left: TraceFilterSummarySpanCountsByFilter,
  right: TraceFilterSummarySpanCountsByFilter
): TraceFilterSummarySpanCountsByFilter {
  return {
    spanFilterCount: left.spanFilterCount + right.spanFilterCount,
    overlappingParentSpanFilterCount:
      left.overlappingParentSpanFilterCount + right.overlappingParentSpanFilterCount,
    similarDurationChainSpanFilterCount:
      left.similarDurationChainSpanFilterCount + right.similarDurationChainSpanFilterCount
  };
}

function clampFilteredCount(totalCount: number, visibleCount: number): number {
  return Math.max(0, totalCount - visibleCount);
}
