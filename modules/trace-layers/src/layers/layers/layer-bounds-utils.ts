import {
  assert,
  fillTraceLayoutLocalDependencyGeometry,
  isVisibleLocalDependencyRef
} from '../../trace/index';
import {
  getTraceLayoutBlockGeometry,
  getTraceLayoutCrossDependencyGeometry,
  getTraceLayoutLocalDependencyGeometry
} from './trace-layout-geometry';

import type {
  ProcessLayout,
  ThreadLayout,
  TraceCrossDependencySource,
  TraceDependencySource,
  TraceLayout,
  TraceLocalDependencySource,
  TraceSpan,
  VisibleLocalDependencyRef
} from '../../trace/index';

export type Bounds = [[number, number], [number, number]];

const DEFAULT_PADDING = 0.5;
const TEXT_LABEL_WIDTH_PER_CHARACTER = 0.6;
const TEXT_LABEL_LINE_HEIGHT_FACTOR = 1.2;

type Geometry = ArrayLike<number> | null | undefined;

type LocalDependencyWithRef = {
  /** Exact visible local dependency ref used to resolve geometry. */
  dependencyRef?: TraceLocalDependencySource['dependencyRef'];
};
type CrossDependencyWithRef = {
  /** Exact visible cross dependency ref used to resolve geometry. */
  dependencyRef?: TraceCrossDependencySource['dependencyRef'];
};

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function geometryToBounds(geometry: Geometry): Bounds | null {
  if (!geometry || geometry.length < 2) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < geometry.length; index += 2) {
    const x = geometry[index];
    const y = geometry[index + 1];
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return [
    [minX, minY],
    [maxX, maxY]
  ];
}

function mergeBounds(target: Bounds | null, source: Bounds | null): Bounds | null {
  if (!source) {
    return target;
  }
  if (!target) {
    return [
      [source[0][0], source[0][1]],
      [source[1][0], source[1][1]]
    ];
  }
  return [
    [Math.min(target[0][0], source[0][0]), Math.min(target[0][1], source[0][1])],
    [Math.max(target[1][0], source[1][0]), Math.max(target[1][1], source[1][1])]
  ];
}

function combineGeometryBounds(geometries: Iterable<Geometry>): Bounds | null {
  let combined: Bounds | null = null;
  for (const geometry of geometries) {
    combined = mergeBounds(combined, geometryToBounds(geometry));
  }
  return combined;
}

function toLineGeometry(
  start: readonly [number, number, number],
  end: readonly [number, number, number]
): Geometry {
  if (
    !isFiniteNumber(start?.[0]) ||
    !isFiniteNumber(start?.[1]) ||
    !isFiniteNumber(end?.[0]) ||
    !isFiniteNumber(end?.[1])
  ) {
    return null;
  }
  const bounds = new Float32Array(4);
  let index = 0;
  bounds[index++] = start[0]!;
  bounds[index++] = start[1]!;
  bounds[index++] = end[0]!;
  bounds[index++] = end[1]!;
  assert(index === bounds.length);
  return bounds;
}

export function expandBounds(
  bounds: Bounds | null,
  padding: number = DEFAULT_PADDING
): Bounds | null {
  if (!bounds) {
    return null;
  }
  if (padding <= 0) {
    return bounds;
  }

  const [[minX, minY], [maxX, maxY]] = bounds;
  return [
    [minX - padding, minY - padding],
    [maxX + padding, maxY + padding]
  ];
}

export function combineBounds(boundsList: Iterable<Bounds | null | undefined>): Bounds | null {
  let combined: Bounds | null = null;
  for (const bounds of boundsList) {
    combined = mergeBounds(combined, bounds ?? null);
  }
  return combined;
}

export function getSpanBounds(spans: Iterable<TraceSpan>, traceLayout: TraceLayout): Bounds | null {
  return combineGeometryBounds(
    Array.from(spans, block =>
      getTraceLayoutBlockGeometry({
        traceLayout,
        block
      })
    )
  );
}

export function getLocalDependencyBounds(
  dependencies: Iterable<LocalDependencyWithRef | VisibleLocalDependencyRef>,
  traceLayout: TraceLayout
): Bounds | null {
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  return combineGeometryBounds(
    Array.from(dependencies, dependency => {
      if (typeof dependency === 'number' && isVisibleLocalDependencyRef(dependency)) {
        return fillTraceLayoutLocalDependencyGeometry({
          traceLayout,
          dependencyRef: dependency,
          target: geometry
        })
          ? new Float32Array([geometry.x1, geometry.y1, geometry.x2, geometry.y2])
          : undefined;
      }
      return getTraceLayoutLocalDependencyGeometry({
        traceLayout,
        dependency
      });
    })
  );
}

export function getCrossDependencyBounds(
  dependencies: Iterable<CrossDependencyWithRef>,
  traceLayout: TraceLayout
): Bounds | null {
  return combineGeometryBounds(
    Array.from(dependencies, dependency =>
      getTraceLayoutCrossDependencyGeometry({
        traceLayout,
        dependency
      })
    )
  );
}

export function getAnyDependencyBounds(
  dependencies: Iterable<TraceDependencySource>,
  traceLayout: TraceLayout
): Bounds | null {
  return combineGeometryBounds(
    Array.from(dependencies, dependency =>
      dependency.type === 'trace-local-dependency'
        ? getTraceLayoutLocalDependencyGeometry({
            traceLayout,
            dependency
          })
        : getTraceLayoutCrossDependencyGeometry({
            traceLayout,
            dependency
          })
    )
  );
}

export function getStreamLayoutBounds(threadLayouts: Iterable<ThreadLayout>): Bounds | null {
  const geometries: Geometry[] = [];

  for (const layout of threadLayouts) {
    if (!layout?.visible) {
      continue;
    }

    const lanePositions =
      (layout.lanes?.laneYPositions?.length ?? 0) > 0
        ? (layout.lanes?.laneYPositions ?? [])
        : [layout.yPosition];

    lanePositions.forEach(laneY => {
      geometries.push(
        toLineGeometry(
          [layout.startPosition[0], laneY, layout.startPosition[2]],
          [layout.targetPosition[0], laneY, layout.targetPosition[2]]
        )
      );
    });
  }

  return combineGeometryBounds(geometries);
}

export function getProcessLayoutBounds(rankLayout?: ProcessLayout): Bounds | null {
  if (!rankLayout) {
    return null;
  }
  const geometry = toLineGeometry(
    [rankLayout.startPosition[0]!, rankLayout.yOffset, 0],
    [rankLayout.startPosition[0]!, rankLayout.yOffset + rankLayout.yHeight, 0]
  );
  return geometryToBounds(geometry);
}

export function getHeaderBounds(minTimeMs: number, maxTimeMs: number): Bounds | null {
  if (!isFiniteNumber(minTimeMs) || !isFiniteNumber(maxTimeMs)) {
    return null;
  }
  const span = Math.max(maxTimeMs - minTimeMs, 1);
  const minX = 0;
  const maxX = span;
  const minY = -150;
  const maxY = 150;
  return [
    [minX, minY],
    [maxX, maxY]
  ];
}

export function getTextLabelBounds(params: {
  x: number;
  y: number;
  text: string;
  textAnchor?: 'start' | 'middle' | 'end';
  size: number;
  maxWidth?: number;
  pixelOffset?: readonly [number, number];
  backgroundPadding?: readonly [number, number];
}): Bounds | null {
  const {x, y, text, size} = params;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(size) || size <= 0) {
    return null;
  }

  const paddingX = params.backgroundPadding?.[0] ?? 0;
  const paddingY = params.backgroundPadding?.[1] ?? 0;
  const offsetX = params.pixelOffset?.[0] ?? 0;
  const offsetY = params.pixelOffset?.[1] ?? 0;
  const estimatedWidth = Math.max(
    size,
    Math.min(
      params.maxWidth ?? Number.POSITIVE_INFINITY,
      Math.max(text.trim().length, 1) * size * TEXT_LABEL_WIDTH_PER_CHARACTER
    )
  );
  const estimatedHeight = size * TEXT_LABEL_LINE_HEIGHT_FACTOR;
  const anchoredX = x + offsetX;
  const anchoredY = y + offsetY;

  let minX = anchoredX;
  let maxX = anchoredX;
  switch (params.textAnchor) {
    case 'end':
      minX = anchoredX - estimatedWidth - paddingX * 2;
      maxX = anchoredX;
      break;
    case 'middle':
      minX = anchoredX - estimatedWidth / 2 - paddingX;
      maxX = anchoredX + estimatedWidth / 2 + paddingX;
      break;
    default:
      minX = anchoredX;
      maxX = anchoredX + estimatedWidth + paddingX * 2;
      break;
  }

  return [
    [minX, anchoredY - estimatedHeight / 2 - paddingY],
    [maxX, anchoredY + estimatedHeight / 2 + paddingY]
  ];
}
