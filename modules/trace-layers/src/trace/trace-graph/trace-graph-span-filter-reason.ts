import {getTraceViewSpanFilterMask} from '../trace-view-snapshot';
import {isValidSourceSpanRef} from './trace-graph-internal-helpers';
import {
  getTraceSpanNameFilterMatchMask,
  getTraceSpanSourceFilterMatchMask
} from './trace-graph-span-filters';
import {TRACE_SPAN_FILTER_MASK_NONE} from './trace-graph-types';

import type {TraceGraph} from './trace-graph';
import type {CompiledTraceSpanFilterPlan} from './trace-graph-span-filters';
import type {
  TraceGraphSpanFilterReason,
  TraceGraphSpanFilterReasonInput,
  TraceGraphSpanLookupStore,
  TraceSpanFilterMask
} from './trace-graph-types';
import type {SpanRef} from './trace-types';

export type TraceGraphSpanFilterReasonParams = {
  /** Graph that owns the active materialized span rows. */
  readonly traceGraph: TraceGraph;
  /** Source span ref to inspect. */
  readonly spanRef: SpanRef;
  /** Whether this graph has active non-store span filters. */
  readonly hasActiveGraphSpanFilter: boolean;
  /** Optional lookup store used to resolve availability outside the active graph. */
  readonly traceStore: TraceGraphSpanLookupStore | null;
  /** Compiled text filter plan used for missing store-backed rows. */
  readonly filterPlan: CompiledTraceSpanFilterPlan;
  /** Optional row metadata used when the span is missing from the graph. */
  readonly missingSpanInput?: TraceGraphSpanFilterReasonInput;
};

/**
 * Returns view-owned filtered state and provenance for one exact span ref.
 */
export function getTraceGraphSpanFilterReason(
  params: TraceGraphSpanFilterReasonParams
): TraceGraphSpanFilterReason {
  if (!isValidSourceSpanRef(params.traceGraph, params.spanRef)) {
    const filterMask = getMissingSpanFilterMask(params.missingSpanInput, params.filterPlan);
    return {
      filterMask,
      isFiltered: true,
      state: params.traceStore?.getSpanRefAvailability?.(params.spanRef) ?? 'unknown'
    };
  }

  const filterMask = getUniqueTraceGraphSpanRefFilterMask(
    params.traceGraph,
    params.spanRef,
    params.hasActiveGraphSpanFilter
  );
  const isFiltered = filterMask !== TRACE_SPAN_FILTER_MASK_NONE;
  return {
    filterMask,
    isFiltered,
    state: isFiltered ? 'filtered' : 'visible'
  };
}

/**
 * Returns the active per-span graph filter provenance mask for one exact source span ref.
 */
export function getUniqueTraceGraphSpanRefFilterMask(
  traceGraph: TraceGraph,
  spanRef: SpanRef,
  hasActiveGraphSpanFilter: boolean
): TraceSpanFilterMask {
  return hasActiveGraphSpanFilter
    ? getTraceViewSpanFilterMask(traceGraph.traceViewSnapshot, spanRef)
    : TRACE_SPAN_FILTER_MASK_NONE;
}

function getMissingSpanFilterMask(
  missingSpanInput: TraceGraphSpanFilterReasonInput | undefined,
  filterPlan: CompiledTraceSpanFilterPlan
): TraceSpanFilterMask {
  if (!missingSpanInput) {
    return TRACE_SPAN_FILTER_MASK_NONE;
  }
  return (
    getTraceSpanNameFilterMatchMask({
      spanName: missingSpanInput.spanName,
      filterPlan
    }) |
    getTraceSpanSourceFilterMatchMask({
      source: missingSpanInput.source,
      filterPlan
    })
  );
}
