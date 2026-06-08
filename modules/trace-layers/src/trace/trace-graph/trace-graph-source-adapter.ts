import {
  getTraceGraphSpanDisplaySource,
  getTraceGraphSpanGeometrySource,
  getTraceGraphSpanRef,
  getTraceGraphSpanRefProcessId,
  iterateTraceGraphProcessSpanRefs,
  materializeTraceGraphSpan
} from '../trace-graph-accessors';

import type {ArrowTraceProcessMetadata, TraceGraphData} from '../ingestion/arrow-trace';
import type {TraceSpanDisplaySource, TraceSpanGeometrySource} from '../trace-graph-accessors';
import type {TraceGraphSpanFilterStore} from './trace-graph-types';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceDependency,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from './trace-types';

/**
 * Supported graph inputs for {@link createTraceGraphSourceAdapter} and `TraceGraph`.
 */
export type TraceGraphSourceInput = TraceGraphRuntimeSource;

/** Store-backed immutable graph snapshot consumed by runtime `TraceGraph` instances. */
export type TraceGraphRuntimeSource = {
  /** Immutable Arrow graph snapshot used by layout, cards, and render-state helpers. */
  readonly traceGraphData: TraceGraphData;
  /** Chunk store that owns loaded chunks, source filters, and store-backed span lookup. */
  readonly traceStore: TraceGraphSpanFilterStore;
};

/**
 * Source access contract used by `TraceGraph` to read Arrow-backed graphs.
 */
export type TraceGraphSourceAdapter = {
  /** Graph-local Arrow tables preserved for filtering and layout. */
  traceGraphTables: TraceGraphData;
  /** Resolve one packed span ref by block id. */
  getSpanRef: (spanId: TraceSpanId) => SpanRef | null;
  /** Iterate packed span refs in process row order. */
  iterateProcessSpanRefs: (processId: TraceProcessId | string) => ReadonlyArray<SpanRef>;
  /** Resolve one Arrow-native geometry source by span id or packed span ref. */
  getSpanGeometrySource: (span: TraceSpanId | SpanRef) => TraceSpanGeometrySource | null;
  /** Resolve one Arrow-native display source by span id or packed span ref. */
  getSpanDisplaySource: (span: TraceSpanId | SpanRef) => TraceSpanDisplaySource | null;
  /** Resolve one compatibility `TraceSpan` by id for external consumers. */
  getTraceSpan: (spanId: TraceSpanId) => TraceSpan | null;
  /** Resolve the owning thread for a stream id. */
  getThread: (threadId: TraceThreadId) => TraceThread | null;
  /** Resolve the owning process for a block id. */
  getProcess: (spanId: TraceSpanId) => ArrowTraceProcessMetadata | null;
  /** Resolve dependencies attached to a block id. */
  getSpanDependencies: (spanId: TraceSpanId) => ReadonlyArray<TraceDependency>;
  /** Resolve cross-process dependencies for the graph. */
  getCrossDependencies: () => ReadonlyArray<TraceCrossProcessDependency>;
};

/**
 * Build a `TraceGraph` source adapter for an Arrow-backed graph.
 */
export function createTraceGraphSourceAdapter(
  sourceGraph: TraceGraphSourceInput
): TraceGraphSourceAdapter {
  return createTraceGraphTablesSourceAdapter(sourceGraph.traceGraphData);
}

/**
 * Build a store-backed runtime graph source from an immutable graph snapshot and chunk store.
 */
export function createTraceGraphRuntimeSource(
  params: TraceGraphRuntimeSource
): TraceGraphRuntimeSource {
  return params;
}

/**
 * Builds a runtime source adapter around graph-owned Arrow tables.
 */
function createTraceGraphTablesSourceAdapter(
  traceGraphTables: TraceGraphData
): TraceGraphSourceAdapter {
  const processById = new Map(
    traceGraphTables.processes.map(process => [process.processId, process] as const)
  );

  return {
    traceGraphTables,
    getSpanRef: (spanId: TraceSpanId): SpanRef | null =>
      getTraceGraphSpanRef(traceGraphTables, spanId),
    iterateProcessSpanRefs: (processId: TraceProcessId | string): ReadonlyArray<SpanRef> =>
      Array.from(iterateTraceGraphProcessSpanRefs(traceGraphTables, processId)),
    getSpanGeometrySource: (span: TraceSpanId | SpanRef): TraceSpanGeometrySource | null =>
      getTraceGraphSpanGeometrySource(traceGraphTables, span),
    getSpanDisplaySource: (span: TraceSpanId | SpanRef): TraceSpanDisplaySource | null =>
      getTraceGraphSpanDisplaySource(traceGraphTables, span),
    getTraceSpan: (spanId: TraceSpanId): TraceSpan | null =>
      materializeTraceGraphSpan(traceGraphTables, spanId),
    getThread: (threadId: TraceThreadId): TraceThread | null =>
      traceGraphTables.threadMap[threadId] ?? null,
    getProcess: (spanId: TraceSpanId): ArrowTraceProcessMetadata | null => {
      const spanIndex = getTraceGraphSpanRef(traceGraphTables, spanId);
      const processId =
        spanIndex == null ? null : getTraceGraphSpanRefProcessId(traceGraphTables, spanIndex);
      return (processId ? processById.get(processId) : null) ?? null;
    },
    getSpanDependencies: (spanId: TraceSpanId): ReadonlyArray<TraceDependency> =>
      Object.values(traceGraphTables.dependencyMap).filter(
        dependency => dependency.startSpanId === spanId || dependency.endSpanId === spanId
      ),
    getCrossDependencies: (): ReadonlyArray<TraceCrossProcessDependency> =>
      traceGraphTables.crossDependencies
  };
}
