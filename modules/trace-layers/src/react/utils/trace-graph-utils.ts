import type {SpanRef, TraceGraph} from '../../trace/index';

/**
 * Resolves the owning rank number for a span from filtered trace runtime state.
 */
export function getRankNumForSpanRef(
  traceGraph: TraceGraph | null,
  spanRef?: SpanRef | null
): number | null {
  if (spanRef == null || !traceGraph) {
    return null;
  }

  return traceGraph.getRankNumBySpanRef(spanRef);
}
