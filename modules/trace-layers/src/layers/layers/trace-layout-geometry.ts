import {
  fillTraceLayoutCrossProcessDependencyGeometry,
  fillTraceLayoutSameProcessDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutDependencyRenderSource,
  getTraceLayoutSpanVisibility
} from '../../trace';
import {
  isCrossProcessDependencyRef,
  isSameProcessDependencyRef
} from '../../trace/trace-graph/trace-id-encoder';

import type {
  CrossProcessDependencyRef,
  SameProcessDependencyRef,
  SpanBoundingBox,
  SpanRef,
  TraceDependencyId,
  TraceDependencyRef,
  TraceDependencyRenderSource,
  TraceDependencySource,
  TraceGraphPathDependencySource,
  TraceLayout,
  TraceLayoutGeometryDerivationContext,
  TraceLayoutSpanVisibility,
  TraceSameProcessDependencySource,
  TraceSpan
} from '../../trace';

const geometryScratch = {x1: 0, y1: 0, x2: 0, y2: 0};

/**
 * Resolves one exact block geometry from a canonical span ref.
 */
export function getTraceLayoutSpanGeometryBySpanRef(params: {
  /** Layout containing current span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible span ref for the block. */
  spanRef: SpanRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): SpanBoundingBox | undefined {
  if (
    !fillTraceLayoutSpanGeometry({
      traceLayout: params.traceLayout,
      spanRef: params.spanRef,
      target: geometryScratch,
      context: params.context
    })
  ) {
    return undefined;
  }
  return new Float32Array([
    geometryScratch.x1,
    geometryScratch.y1,
    geometryScratch.x2,
    geometryScratch.y2
  ]) as SpanBoundingBox;
}

/**
 * Resolves layout-specific visibility for one canonical span ref.
 */
export function getTraceLayoutSpanVisibilityBySpanRef(params: {
  /** Layout containing current lane visibility state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible span ref for the block. */
  spanRef: SpanRef;
  /** Optional batch-scoped lane lookup reused across visibility reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): TraceLayoutSpanVisibility | undefined {
  return getTraceLayoutSpanVisibility(params);
}

/**
 * Resolves one exact block geometry from a materialized visible block.
 */
export function getTraceLayoutBlockGeometry(params: {
  /** Layout containing current span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible block carrying the exact span ref used by the owning trace graph. */
  block: Readonly<Pick<TraceSpan, 'spanRef'>>;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): SpanBoundingBox | undefined {
  const spanRef = params.block.spanRef;
  return spanRef != null
    ? getTraceLayoutSpanGeometryBySpanRef({
        traceLayout: params.traceLayout,
        spanRef,
        context: params.context
      })
    : undefined;
}

/**
 * Resolves one exact visible dependency geometry from a canonical visible dependency ref.
 */
export function getTraceLayoutVisibleDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical dependency ref for the dependency. */
  dependencyRef: TraceDependencyRef | TraceDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  if (
    isSameProcessDependencyRef(params.dependencyRef) ||
    isSameProcessDependencyRef(params.dependencyRef)
  ) {
    return fillTraceLayoutSameProcessDependencyGeometry({
      traceLayout: params.traceLayout,
      dependencyRef: params.dependencyRef,
      target: geometryScratch,
      context: params.context
    })
      ? new Float32Array([
          geometryScratch.x1,
          geometryScratch.y1,
          geometryScratch.x2,
          geometryScratch.y2
        ])
      : undefined;
  }
  if (
    isCrossProcessDependencyRef(params.dependencyRef) ||
    isCrossProcessDependencyRef(params.dependencyRef)
  ) {
    return fillTraceLayoutCrossProcessDependencyGeometry({
      traceLayout: params.traceLayout,
      dependencyRef: params.dependencyRef,
      target: geometryScratch,
      context: params.context
    })
      ? new Float32Array([
          geometryScratch.x1,
          geometryScratch.y1,
          geometryScratch.x2,
          geometryScratch.y2
        ])
      : undefined;
  }
  return undefined;
}

/**
 * Resolves one exact visible same-process dependency geometry from a known same-process dependency ref.
 */
export function getTraceLayoutVisibleSameProcessDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical same-process dependency ref for the dependency. */
  dependencyRef: TraceDependencyRef | SameProcessDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  return fillTraceLayoutSameProcessDependencyGeometry({
    traceLayout: params.traceLayout,
    dependencyRef: params.dependencyRef,
    target: geometryScratch,
    context: params.context
  })
    ? new Float32Array([
        geometryScratch.x1,
        geometryScratch.y1,
        geometryScratch.x2,
        geometryScratch.y2
      ])
    : undefined;
}

/**
 * Resolves one exact visible cross-process dependency geometry from a known cross-process dependency ref.
 */
export function getTraceLayoutVisibleCrossProcessDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical cross-process dependency ref for the dependency. */
  dependencyRef: TraceDependencyRef | CrossProcessDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  return fillTraceLayoutCrossProcessDependencyGeometry({
    traceLayout: params.traceLayout,
    dependencyRef: params.dependencyRef,
    target: geometryScratch,
    context: params.context
  })
    ? new Float32Array([
        geometryScratch.x1,
        geometryScratch.y1,
        geometryScratch.x2,
        geometryScratch.y2
      ])
    : undefined;
}

/**
 * Resolves selected same-process-dependency geometry, deriving a path from endpoint spans when the
 * normal dependency row was skipped by the current base dependency visibility mode.
 */
export function getTraceLayoutSelectedSameProcessDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible same-process dependency ref for the selected dependency. */
  dependencyRef: TraceDependencyRef | SameProcessDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const geometry = getTraceLayoutVisibleSameProcessDependencyGeometry(params);
  if (geometry != null) {
    return geometry;
  }
  return getTraceLayoutSameProcessDependencyGeometryFromEndpointSpans(params);
}

/**
 * Resolves selected cross-process-dependency geometry, deriving a path from endpoint spans when the
 * normal dependency row is absent from current visible dependency refs.
 */
export function getTraceLayoutSelectedCrossProcessDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible cross-process dependency ref for the selected dependency. */
  dependencyRef: TraceDependencyRef | CrossProcessDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const geometry = getTraceLayoutVisibleCrossProcessDependencyGeometry(params);
  if (geometry != null) {
    return geometry;
  }
  return getTraceLayoutCrossProcessDependencyGeometryFromEndpointSpans(params);
}

/**
 * Resolves one exact visible same-process dependency geometry from a materialized dependency.
 */
export function getTraceLayoutSameProcessDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible same-process dependency whose canonical ref should drive geometry lookup. */
  dependency: Readonly<{
    dependencyRef?: TraceSameProcessDependencySource['dependencyRef'];
    dependencyId?: TraceSameProcessDependencySource['dependencyId'];
  }>;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const dependencyRef = resolveTraceLayoutTraceDependencyRef({
    ...params.dependency,
    type: 'trace-same-process-dependency'
  });
  return dependencyRef != null &&
    (isSameProcessDependencyRef(dependencyRef) || isSameProcessDependencyRef(dependencyRef))
    ? getTraceLayoutVisibleSameProcessDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef,
        context: params.context
      })
    : undefined;
}

/**
 * Resolves one exact visible cross-process dependency geometry from a materialized dependency.
 */
export function getTraceLayoutCrossProcessDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible cross-process dependency whose canonical ref should drive geometry lookup. */
  dependency: Readonly<{
    dependencyRef?: TraceDependencyRef | CrossProcessDependencyRef;
    dependencyId?: TraceDependencyId;
  }>;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const dependencyRef = resolveTraceLayoutTraceDependencyRef({
    ...params.dependency,
    type: 'trace-cross-process-dependency'
  });
  return dependencyRef != null &&
    (isCrossProcessDependencyRef(dependencyRef) || isCrossProcessDependencyRef(dependencyRef))
    ? getTraceLayoutVisibleCrossProcessDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef,
        context: params.context
      })
    : undefined;
}

/**
 * Resolves one exact visible path dependency geometry from a ref-bearing path source.
 */
export function getTraceLayoutPathDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible path dependency source carrying the canonical runtime dependency ref. */
  source: Readonly<TraceGraphPathDependencySource>;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const geometry = getTraceLayoutVisibleDependencyGeometry({
    traceLayout: params.traceLayout,
    dependencyRef: params.source.dependencyRef,
    context: params.context
  });
  if (geometry != null) {
    return geometry;
  }
  return params.source.dependency.type === 'trace-cross-process-dependency'
    ? getTraceLayoutCrossProcessDependencyGeometryFromEndpointSpans({
        traceLayout: params.traceLayout,
        dependencyRef: params.source.dependencyRef,
        context: params.context
      })
    : getTraceLayoutSameProcessDependencyGeometryFromEndpointSpans({
        traceLayout: params.traceLayout,
        dependencyRef: params.source.dependencyRef,
        context: params.context
      });
}

/**
 * Resolves the current visible dependency ref for one dependency in the active layout graph.
 */
function resolveTraceLayoutTraceDependencyRef(dependency: {
  /** Current graph-native or visible dependency ref, when already resolved. */
  dependencyRef?: TraceDependencyRef | TraceDependencyRef | null;
  /** External dependency id retained for callers that have not resolved a ref. */
  dependencyId?: TraceDependencyId;
  /** Dependency kind retained for callers that have not resolved a ref. */
  type?: TraceDependencySource['type'];
}): TraceDependencyRef | TraceDependencyRef | undefined {
  const rawDependencyRef = dependency.dependencyRef;
  if (
    rawDependencyRef != null &&
    (isSameProcessDependencyRef(rawDependencyRef) ||
      isCrossProcessDependencyRef(rawDependencyRef) ||
      isSameProcessDependencyRef(rawDependencyRef) ||
      isCrossProcessDependencyRef(rawDependencyRef))
  ) {
    return rawDependencyRef;
  }

  return undefined;
}

/**
 * Builds a selected same-process-dependency line from endpoint span boxes when dependency geometry is not
 * present in the layout's dependency columns.
 */
function getTraceLayoutSameProcessDependencyGeometryFromEndpointSpans(params: {
  traceLayout: Readonly<TraceLayout>;
  dependencyRef: TraceDependencyRef | TraceDependencyRef;
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  return getTraceLayoutDependencyGeometryFromEndpointSpans({
    ...params,
    dependencyType: 'trace-same-process-dependency'
  });
}

/**
 * Builds a selected cross-process-dependency line from endpoint span boxes when dependency geometry is
 * not present in the layout's dependency columns.
 */
function getTraceLayoutCrossProcessDependencyGeometryFromEndpointSpans(params: {
  /** Active layout containing rendered endpoint span boxes. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible dependency ref whose endpoint geometry should be rebuilt. */
  dependencyRef: TraceDependencyRef | TraceDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  return getTraceLayoutDependencyGeometryFromEndpointSpans({
    ...params,
    dependencyType: 'trace-cross-process-dependency'
  });
}

/** Builds one dependency line from the exact rendered endpoint span boxes. */
function getTraceLayoutDependencyGeometryFromEndpointSpans(params: {
  /** Active layout containing rendered endpoint span boxes. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible dependency ref whose endpoint geometry should be rebuilt. */
  dependencyRef: TraceDependencyRef | TraceDependencyRef;
  /** Dependency kind required from the visible dependency source. */
  dependencyType: TraceDependencyRenderSource['type'];
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const dependency = getTraceLayoutDependencyRenderSource(
    params.traceLayout.traceGraph,
    params.dependencyRef
  );
  if (
    dependency?.type !== params.dependencyType ||
    dependency.startSpanRef == null ||
    dependency.endSpanRef == null
  ) {
    return undefined;
  }
  const startGeometry = getTraceLayoutSpanGeometryBySpanRef({
    traceLayout: params.traceLayout,
    spanRef: dependency.startSpanRef,
    context: params.context
  });
  const endGeometry = getTraceLayoutSpanGeometryBySpanRef({
    traceLayout: params.traceLayout,
    spanRef: dependency.endSpanRef,
    context: params.context
  });
  if (!startGeometry || !endGeometry) {
    return undefined;
  }
  const [startX, endX] = getTraceLayoutDependencyEndpointXs({
    startGeometry,
    endGeometry,
    waitMode: dependency.waitMode,
    isParentDependency: dependency.isParent
  });
  return new Float32Array([
    startX,
    getTraceLayoutGeometryCenterY(startGeometry),
    endX,
    getTraceLayoutGeometryCenterY(endGeometry)
  ]);
}

/** Resolves dependency endpoint X coordinates from the dependency wait mode. */
function getTraceLayoutDependencyEndpointXs(params: {
  startGeometry: SpanBoundingBox;
  endGeometry: SpanBoundingBox;
  /** Wait mode selecting the endpoint X coordinates. */
  waitMode: TraceDependencySource['waitMode'];
  /** Whether this dependency represents a parent-to-child span relationship. */
  isParentDependency?: boolean;
}): readonly [number, number] {
  if (params.isParentDependency === true) {
    return [params.startGeometry[0] ?? 0, params.endGeometry[0] ?? 0];
  }
  switch (params.waitMode) {
    case 'end-to-end':
      return [params.startGeometry[2] ?? 0, params.endGeometry[2] ?? 0];
    case 'start-to-start':
      return [params.startGeometry[0] ?? 0, params.endGeometry[0] ?? 0];
    case 'end-to-start':
    default:
      return [params.startGeometry[2] ?? 0, params.endGeometry[0] ?? 0];
  }
}

/** Returns the vertical center for one span geometry tuple. */
function getTraceLayoutGeometryCenterY(geometry: SpanBoundingBox): number {
  return ((geometry[1] ?? 0) + (geometry[3] ?? 0)) / 2;
}
