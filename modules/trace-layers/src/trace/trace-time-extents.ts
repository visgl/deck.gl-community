import type {TraceSpanTiming} from './trace-graph/trace-types';

/**
 * Returns whether one span timing should contribute to graph-wide time extents.
 */
export function isTraceSpanTimingEligibleForTimeExtents(timing: {
  readonly status?: TraceSpanTiming['status'] | string | null;
  readonly startTimeMs?: number | null;
}): boolean {
  return (
    timing.status !== 'not-started' &&
    isTraceSpanTimingTimestampEligibleForTimeExtents(timing.startTimeMs)
  );
}

/**
 * Returns whether one span timestamp should contribute to graph-wide time extents.
 */
export function isTraceSpanTimingTimestampEligibleForTimeExtents(
  timeMs: number | null | undefined
): timeMs is number {
  return Number.isFinite(timeMs) && timeMs !== 0;
}
