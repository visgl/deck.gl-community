import type {TraceSpan, TraceSpanId} from '../../trace/index';

type TraceSpanLookup =
  | Record<string, TraceSpan>
  | null
  | undefined
  | ((spanId: TraceSpanId) => TraceSpan | null);

export function filterValidSpanIds(
  spanIds: ReadonlySet<TraceSpanId> | null | undefined,
  blockLookup: TraceSpanLookup
): Set<TraceSpanId> | undefined {
  if (!spanIds || spanIds.size === 0) {
    return undefined;
  }

  if (!blockLookup) {
    return new Set(spanIds);
  }

  const resolveBlock =
    typeof blockLookup === 'function'
      ? blockLookup
      : (spanId: TraceSpanId) => blockLookup[spanId] ?? null;
  const validIds = Array.from(spanIds).filter(spanId => Boolean(resolveBlock(spanId)));

  return validIds.length > 0 ? new Set(validIds) : undefined;
}
