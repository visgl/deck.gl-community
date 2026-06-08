import {
  hasTraceSpanNameFilter,
  hasTraceSpanSourceFilter,
  hasTraceSpanTopologyFilter
} from '../../trace/index';

import type {TraceGraphSpanFilterState, TraceSpanFilterMask} from '../../trace/index';

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
  if (hasTraceSpanTopologyFilter(filterMask)) {
    reasonParts.push('topological filter');
  }
  return reasonParts;
}

/** Returns a badge tooltip that preserves the usual label while explaining filtered badges. */
export function getTraceSpanBadgeTooltipText(
  spanName: string,
  fallbackTooltip: string,
  filterMask: TraceSpanFilterMask | null | undefined,
  filtered: boolean,
  filteredVariant: 'regexp' | 'topology' | undefined,
  filterState?: TraceGraphSpanFilterState
): string {
  if (!filtered) {
    return fallbackTooltip;
  }

  const reasonLabel =
    getTraceSpanFilterStateReasonLabel(filterState) ??
    getTraceSpanFilterReasonLabel(filterMask) ??
    (filteredVariant === 'topology'
      ? 'Hidden by: topological filter'
      : 'Hidden by span or file filter');
  return `${spanName} (${reasonLabel})`;
}

/** Returns user-facing copy for non-mask graph/store visibility states. */
function getTraceSpanFilterStateReasonLabel(
  filterState: TraceGraphSpanFilterState | undefined
): string | null {
  if (filterState === 'outside-window') {
    return 'Hidden because this span is outside the current trace window';
  }
  if (filterState === 'not-loaded') {
    return 'Hidden because this span has not loaded yet';
  }
  if (filterState === 'unknown') {
    return 'Hidden because this span is not in the current graph';
  }
  return null;
}
