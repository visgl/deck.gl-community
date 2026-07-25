import {TRACE_SPAN_FILTER_MASK_NONE} from '../trace-graph/trace-graph-types';
import {
  isCrossProcessDependencyRef,
  isSameProcessDependencyRef
} from '../trace-graph/trace-id-encoder';
import {getTraceViewSpanFilterMask} from '../trace-view-snapshot';
import {
  fillCrossProcessDependencyPathFlat,
  fillSameProcessDependencyPathFlat,
  fillVisibleSpanBoundingBox,
  getTraceLayoutSpanVisibilityForSpan
} from './trace-geometry-layout-common';
import {buildTraceGeometryLayoutLookup, resolveGeometrySpan} from './trace-geometry-layout-helpers';

import type {
  TraceDependencyRenderSource,
  TraceSameProcessDependencySource
} from '../trace-graph-accessors';
import type {TraceDependencyRef} from '../trace-graph/trace-id-encoder';
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
      spanLaneColumnsByChunkIndex: traceLayout.spanLaneColumnsByChunkIndex,
      processLayoutMapByRef: traceLayout.processLayoutMapByRef,
      threadLayoutMapByRef: traceLayout.threadLayoutMapByRef
    }),
    maxTimeMs: traceLayout.traceGraph.maxTimeMs,
    minTimeMs: traceLayout.layoutConfiguration?.minTimeMs ?? traceLayout.traceGraph.minTimeMs,
    spanHeight: traceLayout.layoutConfiguration?.spanHeight ?? 0.3,
    timingKey: traceLayout.layoutConfiguration?.timingKey
  };
}

/** Projects one visible dependency into the scalar payload needed by layout and deck rendering. */
export function getTraceLayoutDependencyRenderSource(
  traceGraph: Readonly<TraceLayout['traceGraph']>,
  dependencyRef: TraceDependencyRef
): TraceDependencyRenderSource | null {
  if (!traceGraph.isDependencyVisible(dependencyRef)) {
    return null;
  }

  const waitMode = traceGraph.getDependencyWaitMode(dependencyRef);
  if (!waitMode) {
    return null;
  }
  const common = {
    startSpanRef: traceGraph.getDependencyStartSpan(dependencyRef),
    endSpanRef: traceGraph.getDependencyEndSpan(dependencyRef),
    waitMode,
    bidirectional: traceGraph.getDependencyBidirectional(dependencyRef) === true,
    waitTimeMs: traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0,
    isParent: traceGraph.getDependencyIsParent(dependencyRef)
  };

  if (isSameProcessDependencyRef(dependencyRef)) {
    const processRef = traceGraph.getSameProcessDependencyProcessRefByRef(dependencyRef);
    return processRef == null
      ? null
      : {
          ...common,
          type: 'trace-same-process-dependency',
          dependencyRef,
          processRef
        };
  }
  if (!isCrossProcessDependencyRef(dependencyRef)) {
    return null;
  }
  const startRankNum =
    common.startSpanRef == null ? null : traceGraph.getRankNumBySpanRef(common.startSpanRef);
  const endRankNum =
    common.endSpanRef == null ? null : traceGraph.getRankNumBySpanRef(common.endSpanRef);
  return startRankNum == null || endRankNum == null
    ? null
    : {
        ...common,
        type: 'trace-cross-process-dependency',
        dependencyRef,
        startRankNum,
        endRankNum
      };
}

/** Projects one visible same-process dependency into the scalar payload needed by legacy layout geometry. */
export function getTraceLayoutSameProcessDependencySource(
  traceGraph: Readonly<TraceLayout['traceGraph']>,
  dependencyRef: TraceDependencyRef
): TraceSameProcessDependencySource | null {
  if (
    !isSameProcessDependencyRef(dependencyRef) ||
    !traceGraph.isDependencyVisible(dependencyRef)
  ) {
    return null;
  }

  const dependencyId = traceGraph.getDependencyId(dependencyRef);
  const startSpanId = traceGraph.getDependencyStartBlockId(dependencyRef);
  const endSpanId = traceGraph.getDependencyEndBlockId(dependencyRef);
  const waitMode = traceGraph.getDependencyWaitMode(dependencyRef);
  const processRef = traceGraph.getSameProcessDependencyProcessRefByRef(dependencyRef);
  if (
    dependencyId == null ||
    startSpanId == null ||
    endSpanId == null ||
    waitMode == null ||
    processRef == null
  ) {
    return null;
  }

  return {
    type: 'trace-same-process-dependency',
    dependencyRef,
    processRef,
    dependencyId,
    startSpanId,
    endSpanId,
    startSpanRef: traceGraph.getDependencyStartSpan(dependencyRef) ?? undefined,
    endSpanRef: traceGraph.getDependencyEndSpan(dependencyRef) ?? undefined,
    waitMode,
    bidirectional: traceGraph.getDependencyBidirectional(dependencyRef) === true,
    waitTimeMs: traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0,
    keywords: traceGraph.getDependencyKeywords(dependencyRef) ?? new Set()
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
  return fillVisibleSpanBoundingBox(
    span,
    context.layoutLookup,
    context.maxTimeMs,
    context.minTimeMs,
    params.target,
    context.spanHeight
  );
}

/** Copies one current same-process dependency segment into a caller-owned target. */
export function fillTraceLayoutSameProcessDependencyGeometry(params: {
  /** Layout whose lane state should derive the dependency segment. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Runtime same-process dependency ref to resolve. */
  readonly dependencyRef: TraceDependencyRef;
  /** Mutable target object that receives geometry coordinates. */
  readonly target: TraceLayoutGeometryTuple;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): boolean {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const dependency = getTraceLayoutDependencyRenderSource(
    context.traceLayout.traceGraph,
    params.dependencyRef
  );
  if (!dependency || dependency.type !== 'trace-same-process-dependency') {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  return fillTraceLayoutSameProcessDependencyGeometryFromFields({
    traceLayout: params.traceLayout,
    context,
    startSpanRef: dependency.startSpanRef,
    endSpanRef: dependency.endSpanRef,
    waitMode: dependency.waitMode,
    bidirectional: dependency.bidirectional,
    isParentDependency: dependency.isParent,
    target: params.target
  });
}

/**
 * Copies one same-process dependency segment from already-resolved scalar fields.
 *
 * Callers that stream canonical Arrow dependency rows can use this path without constructing a
 * dependency render-source object or a transient geometry array for every row.
 */
export function fillTraceLayoutSameProcessDependencyGeometryFromFields(params: {
  /** Layout whose lane state should derive the dependency segment. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Runtime source span ref already resolved from one dependency row. */
  readonly startSpanRef: SpanRef | null;
  /** Runtime destination span ref already resolved from one dependency row. */
  readonly endSpanRef: SpanRef | null;
  /** Wait-mode discriminator used to choose endpoint timestamps. */
  readonly waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  /** Whether the dependency is bidirectional. */
  readonly bidirectional: boolean;
  /** Whether the dependency should use parent-child endpoint timing. */
  readonly isParentDependency?: boolean;
  /** Mutable target object that receives geometry coordinates. */
  readonly target: TraceLayoutGeometryTuple;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): boolean {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const startSpan =
    params.startSpanRef == null ? null : getTraceLayoutGeometrySpan(context, params.startSpanRef);
  const endSpan =
    params.endSpanRef == null ? null : getTraceLayoutGeometrySpan(context, params.endSpanRef);
  if (!startSpan || !endSpan) {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  return fillSameProcessDependencyPathFlat(
    {
      startSpan,
      endSpan,
      layoutLookup: context.layoutLookup,
      waitMode: params.waitMode,
      bidirectional: params.bidirectional,
      isParentDependency: params.isParentDependency,
      maxTimeMs: context.maxTimeMs,
      minTimeMs: context.minTimeMs
    },
    params.target
  );
}

/** Copies one current cross-process dependency segment into a caller-owned target. */
export function fillTraceLayoutCrossProcessDependencyGeometry(params: {
  /** Layout whose lane state should derive the dependency segment. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Runtime cross-process dependency ref to resolve. */
  readonly dependencyRef: TraceDependencyRef;
  /** Mutable target object that receives geometry coordinates. */
  readonly target: TraceLayoutGeometryTuple;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): boolean {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const traceGraph = context.traceLayout.traceGraph;
  if (
    !isCrossProcessDependencyRef(params.dependencyRef) ||
    !traceGraph.isDependencyVisible(params.dependencyRef)
  ) {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  const startSpanRef = traceGraph.getDependencyStartSpan(params.dependencyRef);
  const endSpanRef = traceGraph.getDependencyEndSpan(params.dependencyRef);
  const waitMode = traceGraph.getDependencyWaitMode(params.dependencyRef);
  if (
    startSpanRef == null ||
    endSpanRef == null ||
    waitMode == null ||
    traceGraph.getRankNumBySpanRef(startSpanRef) == null ||
    traceGraph.getRankNumBySpanRef(endSpanRef) == null
  ) {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  return fillTraceLayoutCrossProcessDependencyGeometryFromFields({
    traceLayout: params.traceLayout,
    startSpanRef,
    endSpanRef,
    waitMode,
    bidirectional: traceGraph.getDependencyBidirectional(params.dependencyRef) === true,
    isParentDependency: traceGraph.getDependencyIsParent(params.dependencyRef),
    target: params.target,
    context
  });
}

/**
 * Copies one cross-process dependency segment from already-resolved scalar fields.
 *
 * Ref-native binary writers use this seam after binding canonical dependency columns, avoiding a
 * transient render-source object, endpoint map, keyword Set, and Float32Array for every edge.
 */
export function fillTraceLayoutCrossProcessDependencyGeometryFromFields(params: {
  /** Layout whose lane state should derive the dependency segment. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Runtime source span ref already resolved from one dependency row. */
  readonly startSpanRef: SpanRef | null;
  /** Runtime destination span ref already resolved from one dependency row. */
  readonly endSpanRef: SpanRef | null;
  /** Wait-mode discriminator used to choose endpoint timestamps. */
  readonly waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  /** Whether the dependency is bidirectional. */
  readonly bidirectional: boolean;
  /** Whether this edge uses parent-child start-to-start timing. */
  readonly isParentDependency?: boolean;
  /** Mutable target object that receives geometry coordinates. */
  readonly target: TraceLayoutGeometryTuple;
  /** Optional shared derivation context for repeated geometry reads. */
  readonly context?: TraceLayoutGeometryDerivationContext;
}): boolean {
  const context = params.context ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const startSpan =
    params.startSpanRef == null ? null : getTraceLayoutGeometrySpan(context, params.startSpanRef);
  const endSpan =
    params.endSpanRef == null ? null : getTraceLayoutGeometrySpan(context, params.endSpanRef);
  if (!startSpan || !endSpan) {
    return fillTraceLayoutGeometryTuple(undefined, params.target);
  }
  return fillCrossProcessDependencyPathFlat(
    {
      startSpan,
      endSpan,
      layoutLookup: context.layoutLookup,
      waitMode: params.waitMode,
      bidirectional: params.bidirectional,
      isParentDependency: params.isParentDependency,
      maxTimeMs: context.maxTimeMs,
      minTimeMs: context.minTimeMs
    },
    params.target
  );
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
  const traceGraph = context.traceLayout.traceGraph;
  const isVisible =
    !traceGraph.hasActiveSpanFilter() ||
    getTraceViewSpanFilterMask(traceGraph.traceViewSnapshot, spanRef) ===
      TRACE_SPAN_FILTER_MASK_NONE;
  const span = isVisible
    ? traceGraph.getSpanGeometrySource(spanRef, context.timingKey ?? null)
    : null;
  return span ? resolveGeometrySpan(span, context.timingKey) : null;
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
