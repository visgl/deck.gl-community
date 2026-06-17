import {getPrimaryTiming} from '../../../../../trace/index';

import type {SpanRef, TraceGraph, TraceSpanId} from '../../../../../trace/index';

/**
 * Derived previous/next navigation state for a selected block within its stream.
 */
export type ThreadNavigation = {
  /** Exact span ref for the previous visible block in the selected stream. */
  previousSpanRef: SpanRef | null;
  /** Exact span ref for the next visible block in the selected stream. */
  nextSpanRef: SpanRef | null;
  /** Compatibility block id for the previous visible block in the selected stream. */
  previousSpanId: TraceSpanId | null;
  /** Compatibility block id for the next visible block in the selected stream. */
  nextSpanId: TraceSpanId | null;
  /** Human-readable selected stream name. */
  streamName: string | null;
  /** One-based selected position label within the visible stream spans. */
  positionLabel: string | null;
  /** Owning rank number for compatibility navigation call sites. */
  rankNum: number | null;
};

/** Derived previous/next navigation state for spans that share the selected span's exact name. */
export type SameNameNavigation = {
  /** Exact span ref for the previous exact-name match in trace search order. */
  previousSpanRef: SpanRef | null;
  /** Exact span ref for the next exact-name match in trace search order. */
  nextSpanRef: SpanRef | null;
  /** Exact selected span name used to build the match set. */
  spanName: string | null;
  /** One-based selected position label in exact-name trace search order. */
  positionLabel: string | null;
};

/**
 * Compute local stream navigation metadata for a block card.
 */
export function getThreadNavigation(
  spanRef: SpanRef,
  traceGraph: Readonly<TraceGraph>
): ThreadNavigation {
  const emptyNavigation: ThreadNavigation = {
    previousSpanRef: null,
    nextSpanRef: null,
    previousSpanId: null,
    nextSpanId: null,
    streamName: null,
    positionLabel: null,
    rankNum: null
  };

  const span = traceGraph.getTraceSpanCardModel(spanRef)?.span ?? null;
  if (!span) {
    return emptyNavigation;
  }

  const processRef = traceGraph.getProcessRefBySpanRef(spanRef);
  const rankNum = traceGraph.getRankNumBySpanRef(spanRef);
  if (processRef == null) {
    return emptyNavigation;
  }

  const streamBlocks = traceGraph
    .getVisibleProcessDisplaySources(processRef)
    .filter(candidate => candidate.threadId === span.threadId)
    .sort(
      (a, b) =>
        getPrimaryTiming(a).startTimeMs - getPrimaryTiming(b).startTimeMs ||
        getPrimaryTiming(a).endTimeMs - getPrimaryTiming(b).endTimeMs ||
        a.spanId.localeCompare(b.spanId)
    );

  const currentIndex = streamBlocks.findIndex(candidate => candidate.spanRef === spanRef);
  if (currentIndex === -1) {
    return emptyNavigation;
  }

  const streamName = traceGraph.getThreadSourceBySpanRef(spanRef)?.name ?? span.threadId;
  const previousSpanRef =
    currentIndex > 0 ? (streamBlocks[currentIndex - 1]?.spanRef ?? null) : null;
  const nextSpanRef =
    currentIndex + 1 < streamBlocks.length
      ? (streamBlocks[currentIndex + 1]?.spanRef ?? null)
      : null;
  const previousSpanId = currentIndex > 0 ? (streamBlocks[currentIndex - 1]?.spanId ?? null) : null;
  const nextSpanId =
    currentIndex + 1 < streamBlocks.length
      ? (streamBlocks[currentIndex + 1]?.spanId ?? null)
      : null;

  return {
    previousSpanRef,
    nextSpanRef,
    previousSpanId,
    nextSpanId,
    streamName,
    positionLabel: `${currentIndex + 1} / ${streamBlocks.length}`,
    rankNum
  };
}

/**
 * Compute trace-wide previous/next navigation for exact span-name matches, including hidden spans.
 */
export function getSameNameNavigation(
  spanRef: SpanRef,
  traceGraph: Readonly<TraceGraph>
): SameNameNavigation {
  const emptyNavigation: SameNameNavigation = {
    previousSpanRef: null,
    nextSpanRef: null,
    spanName: null,
    positionLabel: null
  };

  const span = traceGraph.getTraceSpanCardModel(spanRef)?.span ?? null;
  if (!span) {
    return emptyNavigation;
  }

  let previousSpanRef: SpanRef | null = null;
  let nextSpanRef: SpanRef | null = null;
  let selectedPosition = 0;
  let exactNameMatchCount = 0;
  let foundSelectedSpan = false;
  const normalizedSpanName = span.name.toLowerCase();
  traceGraph.searchBlockRecords(
    searchText => searchText === normalizedSpanName,
    record => {
      if (record.blockName !== span.name) {
        return;
      }

      exactNameMatchCount += 1;
      if (!foundSelectedSpan) {
        if (record.spanRef === spanRef) {
          foundSelectedSpan = true;
          selectedPosition = exactNameMatchCount;
          return;
        }

        previousSpanRef = record.spanRef;
        return;
      }

      nextSpanRef = record.spanRef;
      return false;
    }
  );

  if (!foundSelectedSpan) {
    return emptyNavigation;
  }

  return {
    previousSpanRef,
    nextSpanRef,
    spanName: span.name,
    positionLabel: String(selectedPosition)
  };
}
