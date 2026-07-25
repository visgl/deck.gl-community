import {getTraceGraphSpanLayoutLaneSource} from '../trace-graph-accessors';

import type {
  TraceSpanGeometrySource,
  TraceSpanLaneSource,
  TraceSpanLayoutLaneSource
} from '../trace-graph-accessors';
import type {TraceGraph} from './trace-graph';
import type {ProcessRef} from './trace-id-encoder';

/** Builds visible geometry sources for one process from canonical visible span refs. */
export function getVisibleSpanGeometrySourcesByProcess(
  traceGraph: Readonly<TraceGraph>,
  processRef: ProcessRef
): readonly TraceSpanGeometrySource[] {
  const sources: TraceSpanGeometrySource[] = [];
  for (const spanRef of traceGraph.iterateVisibleSpanRefsByProcess(processRef)) {
    const source = traceGraph.getSpanGeometrySource(spanRef);
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

/** Builds visible lane sources for one process from canonical visible span refs. */
export function getVisibleSpanLaneSourcesByProcess(
  traceGraph: Readonly<TraceGraph>,
  processRef: ProcessRef
): readonly TraceSpanLaneSource[] {
  const sources: TraceSpanLaneSource[] = [];
  for (const spanRef of traceGraph.iterateVisibleSpanRefsByProcess(processRef)) {
    const source = traceGraph.getSpanLaneSource(spanRef);
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

/**
 * Builds narrow generated-layout lane sources for one process from canonical visible span refs.
 *
 * Generated auto-layout needs only owner refs, timings, and optional affinity. This fallback path
 * reads those fields directly from Arrow-backed graph storage without materializing display ids or
 * authored manual geometry. Filtered and richer cases retain exact ref-by-ref materialization here.
 */
export function getVisibleSpanLayoutLaneSourcesByProcess(
  traceGraph: Readonly<TraceGraph>,
  processRef: ProcessRef
): readonly TraceSpanLayoutLaneSource[] {
  const sources: TraceSpanLayoutLaneSource[] = [];
  for (const spanRef of traceGraph.iterateVisibleSpanRefsByProcess(processRef)) {
    const source = getTraceGraphSpanLayoutLaneSource(traceGraph, spanRef);
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}
