import {
  buildTraceCrossRankDependencyGeometry,
  getLocalDependencyPathFlat,
  getSpanBoundingBox,
  getTraceLayoutSpanVisibilityForSpan
} from './trace-geometry-layout-common';
import {buildTraceGeometryLayoutLookup, resolveGeometrySpan} from './trace-geometry-layout-helpers';

import type {TraceCrossDependencySource} from '../trace-graph-accessors';
import type {
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {SpanRef} from '../trace-graph/trace-types';
import type {
  TraceGeometryLayoutLookup,
  TraceSpanGeometrySource
} from './trace-geometry-layout-common';
import type {
  TraceLayout,
  TraceLayoutGeometryTuple,
  TraceLayoutSpanVisibility
} from './trace-layout';

/** Inputs required to derive current span and dependency geometry from lane layout. */
export type TraceLayoutGeometryDerivationContext = {
  /** Layout whose lane and row structure owns the derived coordinates. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Ref-native lane lookup used by span and dependency geometry builders. */
  readonly layoutLookup: TraceGeometryLayoutLookup;
  /** Timeline maximum used for unfinished-span geometry. */
  readonly maxTimeMs: number;
  /** Timeline origin subtracted from rendered X coordinates. */
  readonly minTimeMs: number;
  /** Rendered span height derived from layout density. */
  readonly spanHeight: number;
  /** Optional timing projection selected for rendered span timing. */
  readonly timingKey?: string | null;
};

/** Builds one ephemeral geometry derivation context from current lane layout state. */
export function buildTraceLayoutGeometryDerivationContext(
  traceLayout: Readonly<TraceLayout>
): TraceLayoutGeometryDerivationContext {
  return {
    traceLayout,
    layoutLookup: buildTraceGeometryLayoutLookup({
      traceGraph: traceLayout.traceGraph,
      processLayoutMapByRef: traceLayout.processLayoutMapByRef,
      threadLayoutMapByRef: traceLayout.threadLayoutMapByRef
    }),
    maxTimeMs: traceLayout.traceGraph.maxTimeMs,
    minTimeMs: traceLayout.layoutConfiguration?.minTimeMs ?? traceLayout.traceGraph.minTimeMs,
    spanHeight: traceLayout.layoutConfiguration?.spanHeight ?? 0.3,
    timingKey: traceLayout.layoutConfiguration?.timingKey
  };
}

/** Copies one current span rectangle into a caller-owned target. */
export function fillTraceLayoutSpanGeometry(params: {
  /** Layout whose lane state should derive the span rectangle. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Runtime span ref to resolve. */
  readonly spanRef: SpanRef;
  /** Mutable target object that receives geometry coordinates. */
  readonly target: TraceLayoutGeometryTuple;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): boolean {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const span = getTraceLayoutGeometrySpan(context, params.spanRef);
  if (!span) {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  if (
    !getTraceLayoutSpanVisibilityForSpan({
      span,
      layoutLookup: context.layoutLookup
    }).visible
  ) {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  return fillTraceLayoutGeometryTuple(
    getSpanBoundingBox(
      span,
      context.layoutLookup,
      context.maxTimeMs,
      context.minTimeMs,
      context.spanHeight
    ),
    params.target
  );
}

/** Copies one current local dependency segment into a caller-owned target. */
export function fillTraceLayoutLocalDependencyGeometry(params: {
  /** Layout whose lane state should derive the dependency segment. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Runtime local dependency ref to resolve. */
  readonly dependencyRef: TraceDependencyRef | VisibleLocalDependencyRef;
  /** Mutable target object that receives geometry coordinates. */
  readonly target: TraceLayoutGeometryTuple;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): boolean {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const dependency = context.traceLayout.traceGraph.getVisibleDependencySourceByRef(
    params.dependencyRef
  );
  if (!dependency || dependency.type !== 'trace-local-dependency') {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  const geometry = getTraceLayoutLocalDependencyGeometry({
    context,
    dependency
  });
  return fillTraceLayoutGeometryTuple(geometry, params.target);
}

/** Copies one current cross dependency segment into a caller-owned target. */
export function fillTraceLayoutCrossDependencyGeometry(params: {
  /** Layout whose lane state should derive the dependency segment. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Runtime cross dependency ref to resolve. */
  readonly dependencyRef: TraceDependencyRef | VisibleCrossDependencyRef;
  /** Mutable target object that receives geometry coordinates. */
  readonly target: TraceLayoutGeometryTuple;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): boolean {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const dependency = context.traceLayout.traceGraph.getVisibleDependencySourceByRef(
    params.dependencyRef
  );
  if (!dependency || dependency.type !== 'trace-cross-process-dependency') {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  const geometry = getTraceLayoutCrossDependencyGeometry({
    context,
    dependency
  });
  return fillTraceLayoutGeometryTuple(geometry, params.target);
}

/** Resolves layout-specific visibility for one span ref from current lane state. */
export function getTraceLayoutSpanVisibility(params: {
  /** Layout whose lane state should resolve the span visibility. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Exact visible span ref whose layout visibility should be read. */
  readonly spanRef: SpanRef;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): TraceLayoutSpanVisibility | undefined {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const span = getTraceLayoutGeometrySpan(context, params.spanRef);
  return span
    ? getTraceLayoutSpanVisibilityForSpan({
        span,
        layoutLookup: context.layoutLookup
      })
    : undefined;
}

function getTraceLayoutGeometrySpan(
  context: TraceLayoutGeometryDerivationContext,
  spanRef: SpanRef
): TraceSpanGeometrySource | null {
  const span =
    context.traceLayout.traceGraph.getVisibleDisplaySourceBySpanRef(spanRef) ??
    context.traceLayout.traceGraph.getDisplaySourceBySpanRef(spanRef);
  return span ? resolveGeometrySpan(span, context.timingKey) : null;
}

function getTraceLayoutLocalDependencyGeometry(params: {
  context: TraceLayoutGeometryDerivationContext;
  dependency: Extract<
    ReturnType<TraceLayout['traceGraph']['getVisibleDependencySourceByRef']>,
    {type: 'trace-local-dependency'}
  >;
}): Float32Array | undefined {
  const startSpan =
    params.dependency.startSpanRef == null
      ? null
      : getTraceLayoutGeometrySpan(params.context, params.dependency.startSpanRef);
  const endSpan =
    params.dependency.endSpanRef == null
      ? null
      : getTraceLayoutGeometrySpan(params.context, params.dependency.endSpanRef);
  if (!startSpan || !endSpan) {
    return undefined;
  }
  const geometry = getLocalDependencyPathFlat({
    startSpan,
    endSpan,
    layoutLookup: params.context.layoutLookup,
    waitMode: params.dependency.waitMode,
    bidirectional: params.dependency.bidirectional,
    isParentDependency: params.dependency.keywords.has('PARENT'),
    maxTimeMs: params.context.maxTimeMs,
    minTimeMs: params.context.minTimeMs
  });
  return geometry.length >= 4 ? geometry : undefined;
}

function getTraceLayoutCrossDependencyGeometry(params: {
  context: TraceLayoutGeometryDerivationContext;
  dependency: TraceCrossDependencySource;
}): Float32Array | undefined {
  const spanByRef = new Map<SpanRef, TraceSpanGeometrySource>();
  const startSpan =
    params.dependency.startSpanRef == null
      ? null
      : getTraceLayoutGeometrySpan(params.context, params.dependency.startSpanRef);
  const endSpan =
    params.dependency.endSpanRef == null
      ? null
      : getTraceLayoutGeometrySpan(params.context, params.dependency.endSpanRef);
  if (params.dependency.startSpanRef != null && startSpan) {
    spanByRef.set(params.dependency.startSpanRef, startSpan);
  }
  if (params.dependency.endSpanRef != null && endSpan) {
    spanByRef.set(params.dependency.endSpanRef, endSpan);
  }
  const geometry = buildTraceCrossRankDependencyGeometry({
    crossDependency: params.dependency,
    maxTimeMs: params.context.maxTimeMs,
    minTimeMs: params.context.minTimeMs,
    spanByRef,
    layoutLookup: params.context.layoutLookup
  }).geometry;
  return geometry && geometry.length >= 4 ? geometry : undefined;
}

function fillTraceLayoutGeometryTuple(
  geometry: ArrayLike<number> | undefined,
  target: TraceLayoutGeometryTuple
): boolean {
  target.x1 = geometry?.[0] ?? 0;
  target.y1 = geometry?.[1] ?? 0;
  target.x2 = geometry?.[2] ?? 0;
  target.y2 = geometry?.[3] ?? 0;
  return geometry != null && geometry.length >= 4;
}
