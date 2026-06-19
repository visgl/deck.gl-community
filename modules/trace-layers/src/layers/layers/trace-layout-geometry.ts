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
  TraceDependencySource,
  TraceGraphPathDependencySource,
  TraceLayout,
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
  /** Layout containing canonical span-ref geometry indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible span ref for the block. */
  spanRef: SpanRef;
}): SpanBoundingBox | undefined {
  if (
    !fillTraceLayoutSpanGeometry({
      traceLayout: params.traceLayout,
      spanRef: params.spanRef,
      target: geometryScratch
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
  /** Layout containing canonical span-ref visibility indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible span ref for the block. */
  spanRef: SpanRef;
}): TraceLayoutSpanVisibility | undefined {
  return getTraceLayoutSpanVisibility(params);
}

/**
 * Resolves one exact block geometry from a materialized visible block.
 */
export function getTraceLayoutBlockGeometry(params: {
  /** Layout containing canonical span-ref geometry indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible block carrying the exact span ref used by the owning trace graph. */
  block: Readonly<Pick<TraceSpan, 'spanRef'>>;
}): SpanBoundingBox | undefined {
  const spanRef = params.block.spanRef;
  return spanRef != null
    ? getTraceLayoutSpanGeometryBySpanRef({
        traceLayout: params.traceLayout,
        spanRef
      })
    : undefined;
}

/**
 * Resolves one exact visible dependency geometry from a canonical visible dependency ref.
 */
export function getTraceLayoutVisibleDependencyGeometry(params: {
  /** Layout containing canonical visible dependency geometry indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical dependency ref for the dependency. */
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
}): Float32Array | undefined {
  if (
    isVisibleLocalDependencyRef(params.dependencyRef) ||
    isLocalDependencyRef(params.dependencyRef)
  ) {
    return fillTraceLayoutLocalDependencyGeometry({
      traceLayout: params.traceLayout,
      dependencyRef: params.dependencyRef,
      target: geometryScratch
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
      target: geometryScratch
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
  /** Layout containing canonical span and dependency geometry indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Canonical visible local dependency ref for the selected dependency. */
  dependencyRef: TraceDependencyRef | VisibleDependencyRef;
}): Float32Array | undefined {
  const geometry = getTraceLayoutVisibleDependencyGeometry(params);
  if (geometry != null) {
    return geometry;
  }
  return getTraceLayoutLocalDependencyGeometryFromEndpointSpans(params);
}

/**
 * Resolves one exact visible local dependency geometry from a materialized dependency.
 */
export function getTraceLayoutLocalDependencyGeometry(params: {
  /** Layout containing canonical visible dependency geometry indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible local dependency whose canonical ref should drive geometry lookup. */
  dependency: Readonly<{
    dependencyRef?: TraceLocalDependencySource['dependencyRef'];
    dependencyId?: TraceLocalDependencySource['dependencyId'];
  }>;
}): Float32Array | undefined {
  const dependencyRef = resolveTraceLayoutVisibleDependencyRef(params.traceLayout, {
    ...params.dependency,
    type: 'trace-local-dependency'
  });
  return dependencyRef != null &&
    (isVisibleLocalDependencyRef(dependencyRef) || isLocalDependencyRef(dependencyRef))
    ? getTraceLayoutVisibleDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef
      })
    : undefined;
}

/**
 * Resolves one exact visible cross dependency geometry from a materialized dependency.
 */
export function getTraceLayoutCrossDependencyGeometry(params: {
  /** Layout containing canonical visible dependency geometry indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible cross dependency whose canonical ref should drive geometry lookup. */
  dependency: Readonly<{
    dependencyRef?: TraceCrossDependencySource['dependencyRef'];
    dependencyId?: TraceCrossDependencySource['dependencyId'];
  }>;
}): Float32Array | undefined {
  const dependencyRef = resolveTraceLayoutVisibleDependencyRef(params.traceLayout, {
    ...params.dependency,
    type: 'trace-cross-process-dependency'
  });
  return dependencyRef != null &&
    (isVisibleCrossDependencyRef(dependencyRef) || isCrossDependencyRef(dependencyRef))
    ? getTraceLayoutVisibleDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef
      })
    : undefined;
}

/**
 * Resolves one exact visible path dependency geometry from a ref-bearing path source.
 */
export function getTraceLayoutPathDependencyGeometry(params: {
  /** Layout containing canonical visible dependency geometry indexes. */
  traceLayout: Readonly<TraceLayout>;
  /** Visible path dependency source carrying the canonical runtime dependency ref. */
  source: Readonly<TraceGraphPathDependencySource>;
}): Float32Array | undefined {
  return getTraceLayoutVisibleDependencyGeometry({
    traceLayout: params.traceLayout,
    dependencyRef: params.source.dependencyRef
  });
}

/**
 * Resolves the current visible dependency ref for one dependency in the active layout graph.
 */
function resolveTraceLayoutVisibleDependencyRef(
  traceLayout: Readonly<TraceLayout>,
  dependency: {
    dependencyRef?: TraceDependencySource['dependencyRef'] | null;
    dependencyId?: TraceDependencySource['dependencyId'];
    type?: TraceDependencySource['type'];
  }
): TraceDependencyRef | VisibleDependencyRef | undefined {
  const rawDependencyRef = dependency.dependencyRef;
  if (
    rawDependencyRef != null &&
    (isLocalDependencyRef(rawDependencyRef) || isCrossDependencyRef(rawDependencyRef))
  ) {
    return rawDependencyRef;
  }

  if (dependency.dependencyId != null && traceLayout.traceGraph != null) {
    const visibleDependencyRef =
      dependency.type === 'trace-cross-process-dependency'
        ? traceLayout.traceGraph.getVisibleCrossDependencyRefById?.(dependency.dependencyId)
        : traceLayout.traceGraph.getVisibleLocalDependencyRefById?.(dependency.dependencyId);
    if (visibleDependencyRef != null) {
      return visibleDependencyRef;
    }

    const legacyVisibleDependencyRef =
      'getVisibleDependencyRefForDependency' in traceLayout.traceGraph
        ? (
            traceLayout.traceGraph as TraceLayout['traceGraph'] & {
              getVisibleDependencyRefForDependency?: (dependency: {
                dependencyRef?: TraceDependencySource['dependencyRef'] | null;
                dependencyId?: TraceDependencySource['dependencyId'];
                type?: TraceDependencySource['type'];
              }) => VisibleDependencyRef | null;
            }
          ).getVisibleDependencyRefForDependency?.(dependency)
        : null;
    if (legacyVisibleDependencyRef != null) {
      return legacyVisibleDependencyRef;
    }
  }

  if (
    rawDependencyRef != null &&
    (isVisibleLocalDependencyRef(rawDependencyRef) || isVisibleCrossDependencyRef(rawDependencyRef))
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
}): Float32Array | undefined {
  const dependency = params.traceLayout.traceGraph?.getVisibleDependencySourceByRef?.(
    params.dependencyRef
  );
  if (
    dependency?.type !== 'trace-local-dependency' ||
    dependency.startSpanRef == null ||
    dependency.endSpanRef == null
  ) {
    return undefined;
  }
  const startGeometry = getTraceLayoutSpanGeometryBySpanRef({
    traceLayout: params.traceLayout,
    spanRef: dependency.startSpanRef
  });
  const endGeometry = getTraceLayoutSpanGeometryBySpanRef({
    traceLayout: params.traceLayout,
    spanRef: dependency.endSpanRef
  });
  if (!startGeometry || !endGeometry) {
    return undefined;
  }
  const [startX, endX] = getTraceLayoutDependencyEndpointXs({
    startGeometry,
    endGeometry,
    waitMode: dependency.waitMode
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
  waitMode: TraceLocalDependencySource['waitMode'];
}): readonly [number, number] {
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
