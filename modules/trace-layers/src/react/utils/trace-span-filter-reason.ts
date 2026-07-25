import {hasTraceSpanNameFilter, hasTraceSpanSourceFilter} from '../../trace';

import type {TraceSpanFilterMask} from '../../trace';

/** Returns user-facing copy for the graph filter provenance encoded in one span mask. */
export function getTraceSpanFilterReasonLabel(
  filterMask: TraceSpanFilterMask | null | undefined
): string | null {
  const reasonParts = getTraceSpanFilterReasonParts(filterMask);
  return reasonParts.length > 0 ? `Hidden by: ${reasonParts.join(', ')}` : null;
}

/** Returns ordered user-facing reason fragments for one graph filter provenance mask. */
export function getTraceSpanFilterReasonParts(
  filterMask: TraceSpanFilterMask | null | undefined
): readonly string[] {
  if (filterMask == null) {
    return [];
  }

  const reasonParts: string[] = [];
  if (hasTraceSpanNameFilter(filterMask)) {
    reasonParts.push('span-name filter');
  }
  if (hasTraceSpanSourceFilter(filterMask)) {
    reasonParts.push('filename filter');
  }
  return reasonParts;
}
