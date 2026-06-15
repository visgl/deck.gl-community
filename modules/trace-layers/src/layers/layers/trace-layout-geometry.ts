import {
  fillTraceLayoutCrossDependencyGeometry,
  fillTraceLayoutLocalDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanVisibility,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from '../../trace/index';
import {isCrossDependencyRef, isLocalDependencyRef} from '../../trace/trace-graph/trace-id-encoder';

import type {
  SpanBoundingBox,
  SpanRef,
  TraceCrossDependencySource,
  TraceDependencyRef,
  TraceDependencyRenderSource,
  TraceDependencySource,
  TraceGraphPathDependencySource,
  TraceLayout,
  TraceLayoutGeometryDerivationContext,
  TraceLayoutSpanVisibility,
  TraceLocalDependencySource,
  TraceSpan,
  VisibleDependencyRef
} from '../../trace/index';

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
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  if (
    isVisibleLocalDependencyRef(params.dependencyRef) ||
    isLocalDependencyRef(params.dependencyRef)
  ) {
    return fillTraceLayoutLocalDependencyGeometry({
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
    isVisibleCrossDependencyRef(params.dependencyRef) ||
    isCrossDependencyRef(params.dependencyRef)
  ) {
    return fillTraceLayoutCrossDependencyGeometry({
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
 * Resolves selected local-dependency geometry, deriving a path from endpoint spans when the
 * normal dependency row was skipped by the current base dependency visibility mode.
 */
export function getTraceLayoutSelectedLocalDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible local dependency ref for the selected dependency. */
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const geometry = getTraceLayoutVisibleDependencyGeometry(params);
  if (geometry != null) {
    return geometry;
  }
  return getTraceLayoutLocalDependencyGeometryFromEndpointSpans(params);
}

/**
 * Resolves selected cross-dependency geometry, deriving a path from endpoint spans when the
 * normal dependency row is absent from current visible dependency refs.
 */
export function getTraceLayoutSelectedCrossDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible cross dependency ref for the selected dependency. */
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const geometry = getTraceLayoutVisibleDependencyGeometry(params);
  if (geometry != null) {
    return geometry;
  }
  return getTraceLayoutCrossDependencyGeometryFromEndpointSpans(params);
}

/**
 * Resolves one exact visible local dependency geometry from a materialized dependency.
 */
export function getTraceLayoutLocalDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible local dependency whose canonical ref should drive geometry lookup. */
  dependency: Readonly<{
    dependencyRef?: TraceLocalDependencySource['dependencyRef'];
    dependencyId?: TraceLocalDependencySource['dependencyId'];
  }>;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const dependencyRef = resolveTraceLayoutVisibleDependencyRef({
    ...params.dependency,
    type: 'trace-local-dependency'
  });
  return dependencyRef != null &&
    (isVisibleLocalDependencyRef(dependencyRef) || isLocalDependencyRef(dependencyRef))
    ? getTraceLayoutVisibleDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef,
        context: params.context
      })
    : undefined;
}

/**
 * Resolves one exact visible cross dependency geometry from a materialized dependency.
 */
export function getTraceLayoutCrossDependencyGeometry(params: {
  /** Layout containing current endpoint span timing and lane assignment state. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible cross dependency whose canonical ref should drive geometry lookup. */
  dependency: Readonly<{
    dependencyRef?: TraceCrossDependencySource['dependencyRef'];
    dependencyId?: TraceCrossDependencySource['dependencyId'];
  }>;
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const dependencyRef = resolveTraceLayoutVisibleDependencyRef({
    ...params.dependency,
    type: 'trace-cross-process-dependency'
  });
  return dependencyRef != null &&
    (isVisibleCrossDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef))
    ? getTraceLayoutVisibleDependencyGeometry({
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
    ? getTraceLayoutCrossDependencyGeometryFromEndpointSpans({
        traceLayout: params.traceLayout,
        dependencyRef: params.source.dependencyRef,
        context: params.context
      })
    : getTraceLayoutLocalDependencyGeometryFromEndpointSpans({
        traceLayout: params.traceLayout,
        dependencyRef: params.source.dependencyRef,
        context: params.context
      });
}

/**
 * Resolves the current visible dependency ref for one dependency in the active layout graph.
 */
function resolveTraceLayoutVisibleDependencyRef(dependency: {
  /** Current graph-native or visible dependency ref, when already resolved. */
  dependencyRef?: TraceDependencySource['dependencyRef'] | null;
  /** External dependency id retained for callers that have not resolved a ref. */
  dependencyId?: TraceDependencySource['dependencyId'];
  /** Dependency kind retained for callers that have not resolved a ref. */
  type?: TraceDependencySource['type'];
}): TraceDependencyRef | VisibleDependencyRef | undefined {
  const rawDependencyRef = dependency.dependencyRef;
  if (
    rawDependencyRef != null &&
    (isLocalDependencyRef(rawDependencyRef) ||
      isCrossDependencyRef(rawDependencyRef) ||
      isVisibleLocalDependencyRef(rawDependencyRef) ||
      isVisibleCrossDependencyRef(rawDependencyRef))
  ) {
    return rawDependencyRef;
  }

  return undefined;
}

/**
 * Builds a selected local-dependency line from endpoint span boxes when dependency geometry is not
 * present in the layout's dependency columns.
 */
function getTraceLayoutLocalDependencyGeometryFromEndpointSpans(params: {
  traceLayout: Readonly<TraceLayout>;
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  return getTraceLayoutDependencyGeometryFromEndpointSpans({
    ...params,
    dependencyType: 'trace-local-dependency'
  });
}

/**
 * Builds a selected cross-dependency line from endpoint span boxes when dependency geometry is
 * not present in the layout's dependency columns.
 */
function getTraceLayoutCrossDependencyGeometryFromEndpointSpans(params: {
  /** Active layout containing rendered endpoint span boxes. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible dependency ref whose endpoint geometry should be rebuilt. */
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
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
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
  /** Dependency kind required from the visible dependency source. */
  dependencyType: TraceDependencyRenderSource['type'];
  /** Optional batch-scoped lane lookup reused across geometry reads. */
  context?: TraceLayoutGeometryDerivationContext;
}): Float32Array | undefined {
  const dependency = params.traceLayout.traceGraph?.getVisibleDependencyRenderSourceByRef?.(
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
