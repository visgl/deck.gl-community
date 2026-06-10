import {
  getTraceGraphProcessSpanOrdinal,
  getTraceGraphSpanRefProcessId
} from '../trace-graph-accessors';
import {isValidSourceSpanRef} from './trace-graph-internal-helpers';
import {getTraceSpanNameFilterMatchMask} from './trace-graph-span-filters';
import {TRACE_SPAN_FILTER_MASK_NONE} from './trace-graph-types';

import type {TraceGraph} from './trace-graph';
import type {CompiledTraceSpanFilterPlan} from './trace-graph-span-filters';
import type {
  TraceGraphSpanFilterReason,
  TraceGraphSpanFilterReasonInput,
  TraceGraphSpanFilterStore,
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
  /** Optional store used to resolve rows outside the active graph. */
  readonly traceStore: TraceGraphSpanFilterStore | null;
  /** Compiled text filter plan used for missing store-backed rows. */
  readonly filterPlan: CompiledTraceSpanFilterPlan;
  /** Optional row metadata used when the span is missing from the graph. */
  readonly missingSpanInput?: TraceGraphSpanFilterReasonInput;
};

/**
 * Returns graph-owned filtered state and provenance for one exact span ref.
 */
export function getTraceGraphSpanFilterReason(
  params: TraceGraphSpanFilterReasonParams
): TraceGraphSpanFilterReason {
  if (!isValidSourceSpanRef(params.traceGraph, params.spanRef)) {
    const storeFilterReason = params.traceStore?.getFilterReason(params.spanRef) ?? null;
    return {
      filterMask:
        getMissingSpanFilterMask(params.missingSpanInput, params.filterPlan) |
        (storeFilterReason?.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE),
      isFiltered: true,
      state: storeFilterReason?.state ?? 'unknown'
    };
  }

  const storeFilterReason = params.traceStore?.getFilterReason(params.spanRef) ?? null;
  const filterMask =
    getTraceGraphSpanRefFilterMask(
      params.traceGraph,
      params.spanRef,
      params.hasActiveGraphSpanFilter
    ) | (storeFilterReason?.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE);
  const isFiltered =
    filterMask !== TRACE_SPAN_FILTER_MASK_NONE || storeFilterReason?.isFiltered === true;
  return {
    filterMask,
    isFiltered,
    state: isFiltered ? 'filtered' : 'visible'
  };
}

/**
 * Returns the active per-span graph filter provenance mask for one exact source span ref.
 */
export function getTraceGraphSpanRefFilterMask(
  traceGraph: TraceGraph,
  spanRef: SpanRef,
  hasActiveGraphSpanFilter: boolean
): TraceSpanFilterMask {
  if (!hasActiveGraphSpanFilter) {
    return TRACE_SPAN_FILTER_MASK_NONE;
  }
  const processId = getTraceGraphSpanRefProcessId(traceGraph, spanRef);
  const spanTable = processId ? traceGraph.processSpanTableMap[processId] : undefined;
  if (!processId || !spanTable) {
    return TRACE_SPAN_FILTER_MASK_NONE;
  }

  const rowIndex = getTraceGraphProcessSpanOrdinal(traceGraph, processId, spanRef);
  const filterMask =
    rowIndex == null ? null : getFiniteNumber(spanTable.getChild('filter_mask')?.get(rowIndex));
  return filterMask == null ? TRACE_SPAN_FILTER_MASK_NONE : (filterMask as TraceSpanFilterMask);
}

/** Returns one finite numeric Arrow cell as a JavaScript number. */
function getFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function getMissingSpanFilterMask(
  missingSpanInput: TraceGraphSpanFilterReasonInput | undefined,
  filterPlan: CompiledTraceSpanFilterPlan
): TraceSpanFilterMask {
  return missingSpanInput
    ? getTraceSpanNameFilterMatchMask({
        spanName: missingSpanInput.spanName,
        filterPlan
      })
    : TRACE_SPAN_FILTER_MASK_NONE;
}
