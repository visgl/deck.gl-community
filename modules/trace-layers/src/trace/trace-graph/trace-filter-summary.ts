import type {TraceGraph} from './trace-graph';
import type {ProcessRef, ThreadRef} from './trace-id-encoder';
import type {SpanRef} from './trace-types';

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
  /** Number of same-process dependencies that remain visible after active span filtering. */
  readonly visibleSameProcessDependencyCount: number;
  /** Number of source same-process dependencies before active span filtering. */
  readonly totalSameProcessDependencyCount: number;
  /** Number of same-process dependencies removed from the visible graph by active span filtering. */
  readonly filteredSameProcessDependencyCount: number;
  /** Number of cross-process dependencies that remain visible after active span filtering. */
  readonly visibleCrossProcessDependencyCount: number;
  /** Number of source cross-process dependencies before active span filtering. */
  readonly totalCrossProcessDependencyCount: number;
  /** Number of cross-process dependencies removed from the visible graph by active span filtering. */
  readonly filteredCrossProcessDependencyCount: number;
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
  return traceGraphs.some(traceGraph => traceGraph.traceViewSnapshot.filteredSpanCount > 0);
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
  visibleSameProcessDependencyCount: 0,
  totalSameProcessDependencyCount: 0,
  filteredSameProcessDependencyCount: 0,
  visibleCrossProcessDependencyCount: 0,
  totalCrossProcessDependencyCount: 0,
  filteredCrossProcessDependencyCount: 0,
  hasFilteredItems: false
};

function buildSingleTraceFilterSummary(traceGraph: Readonly<TraceGraph>): TraceFilterSummary {
  const filteredSpanCount = traceGraph.traceViewSnapshot.filteredSpanCount;
  if (!traceGraph.hasActiveSpanFilter() || filteredSpanCount === 0) {
    return createTraceFilterSummary({
      visibleProcessCount: traceGraph.stats.processCount,
      totalProcessCount: traceGraph.stats.processCount,
      visibleThreadCount: traceGraph.stats.threadCount,
      totalThreadCount: traceGraph.stats.threadCount,
      visibleSpanCount: traceGraph.stats.spanCount,
      totalSpanCount: traceGraph.stats.spanCount,
      visibleSameProcessDependencyCount: traceGraph.stats.sameProcessDependencyCount,
      totalSameProcessDependencyCount: traceGraph.stats.sameProcessDependencyCount,
      visibleCrossProcessDependencyCount: traceGraph.stats.crossProcessDependencyCount,
      totalCrossProcessDependencyCount: traceGraph.stats.crossProcessDependencyCount
    });
  }

  const sourceProcessRefs = traceGraph.getProcessRefs();
  const visibleSpanSummary = buildVisibleSpanSummary(traceGraph, sourceProcessRefs);
  const visibleThreadRefs = visibleSpanSummary.visibleThreadRefs;
  let visibleSameProcessDependencyCount = 0;
  for (const processRef of sourceProcessRefs) {
    for (const _dependencyRef of traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(
      processRef
    )) {
      visibleSameProcessDependencyCount += 1;
    }
  }
  const filteredProcessCount = sourceProcessRefs.length - visibleSpanSummary.visibleProcessCount;
  const filteredThreadCount = sourceProcessRefs.reduce((count, processRef) => {
    return (
      count +
      traceGraph
        .getThreadSourcesByProcessRef(processRef)
        .filter(thread => !visibleThreadRefs.has(thread.threadRef)).length
    );
  }, 0);
  let visibleCrossProcessDependencyCount = 0;
  for (const _dependencyRef of traceGraph.iterateVisibleCrossProcessDependencyRefs()) {
    visibleCrossProcessDependencyCount += 1;
  }
  const filteredCrossProcessDependencyCount = clampFilteredCount(
    traceGraph.stats.crossProcessDependencyCount,
    visibleCrossProcessDependencyCount
  );

  return createTraceFilterSummary({
    visibleProcessCount: traceGraph.stats.processCount - filteredProcessCount,
    totalProcessCount: traceGraph.stats.processCount,
    visibleThreadCount: traceGraph.stats.threadCount - filteredThreadCount,
    totalThreadCount: traceGraph.stats.threadCount,
    visibleSpanCount: traceGraph.stats.spanCount - filteredSpanCount,
    totalSpanCount: traceGraph.stats.spanCount,
    visibleSameProcessDependencyCount,
    totalSameProcessDependencyCount: traceGraph.stats.sameProcessDependencyCount,
    visibleCrossProcessDependencyCount:
      traceGraph.stats.crossProcessDependencyCount - filteredCrossProcessDependencyCount,
    totalCrossProcessDependencyCount: traceGraph.stats.crossProcessDependencyCount
  });
}

/** Streams visible span refs once to count live processes and collect live thread refs. */
function buildVisibleSpanSummary(
  traceGraph: Readonly<TraceGraph>,
  sourceProcessRefs: readonly ProcessRef[]
): {
  /** Number of source processes with at least one visible span. */
  readonly visibleProcessCount: number;
  /** Thread refs owning at least one visible span. */
  readonly visibleThreadRefs: ReadonlySet<ThreadRef>;
} {
  const visibleThreadRefs = new Set<ThreadRef>();
  let visibleProcessCount = 0;
  for (const processRef of sourceProcessRefs) {
    let processHasVisibleSpan = false;
    for (const spanRef of traceGraph.iterateVisibleSpanRefsByProcess(processRef)) {
      processHasVisibleSpan = true;
      addVisibleThreadRef(traceGraph, visibleThreadRefs, spanRef);
    }
    if (processHasVisibleSpan) {
      visibleProcessCount += 1;
    }
  }
  return {visibleProcessCount, visibleThreadRefs};
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
    visibleSameProcessDependencyCount:
      left.visibleSameProcessDependencyCount + right.visibleSameProcessDependencyCount,
    totalSameProcessDependencyCount:
      left.totalSameProcessDependencyCount + right.totalSameProcessDependencyCount,
    visibleCrossProcessDependencyCount:
      left.visibleCrossProcessDependencyCount + right.visibleCrossProcessDependencyCount,
    totalCrossProcessDependencyCount:
      left.totalCrossProcessDependencyCount + right.totalCrossProcessDependencyCount
  });
}

function createTraceFilterSummary(params: {
  readonly visibleProcessCount: number;
  readonly totalProcessCount: number;
  readonly visibleThreadCount: number;
  readonly totalThreadCount: number;
  readonly visibleSpanCount: number;
  readonly totalSpanCount: number;
  readonly visibleSameProcessDependencyCount: number;
  readonly totalSameProcessDependencyCount: number;
  readonly visibleCrossProcessDependencyCount: number;
  readonly totalCrossProcessDependencyCount: number;
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
  const filteredSameProcessDependencyCount = clampFilteredCount(
    params.totalSameProcessDependencyCount,
    params.visibleSameProcessDependencyCount
  );
  const filteredCrossProcessDependencyCount = clampFilteredCount(
    params.totalCrossProcessDependencyCount,
    params.visibleCrossProcessDependencyCount
  );
  const hasFilteredItems =
    filteredProcessCount > 0 ||
    filteredThreadCount > 0 ||
    filteredSpanCount > 0 ||
    filteredSameProcessDependencyCount > 0 ||
    filteredCrossProcessDependencyCount > 0;
  return {
    ...params,
    filteredProcessCount,
    filteredThreadCount,
    filteredSpanCount,
    filteredSameProcessDependencyCount,
    filteredCrossProcessDependencyCount,
    hasFilteredItems
  };
}

function clampFilteredCount(totalCount: number, visibleCount: number): number {
  return Math.max(0, totalCount - visibleCount);
}
