export const TRACE_TIMING_DISPLAY_ORDER = [
  'envelope',
  'earliest_start',
  'earliest',
  'p50',
  'p90',
  'latest_start',
  'latest'
] as const;

export function compareTraceTimingKeys(left: string, right: string): number {
  const leftIndex = TRACE_TIMING_DISPLAY_ORDER.indexOf(
    left as (typeof TRACE_TIMING_DISPLAY_ORDER)[number]
  );
  const rightIndex = TRACE_TIMING_DISPLAY_ORDER.indexOf(
    right as (typeof TRACE_TIMING_DISPLAY_ORDER)[number]
  );
  const normalizedLeftIndex = leftIndex === -1 ? Number.POSITIVE_INFINITY : leftIndex;
  const normalizedRightIndex = rightIndex === -1 ? Number.POSITIVE_INFINITY : rightIndex;

  if (normalizedLeftIndex !== normalizedRightIndex) {
    return normalizedLeftIndex - normalizedRightIndex;
  }
  return left.localeCompare(right);
}

export function orderTraceTimingKeys(keys: Iterable<string>): string[] {
  return Array.from(keys).sort(compareTraceTimingKeys);
}
