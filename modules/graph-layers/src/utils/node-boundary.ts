// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type GeometryNodeType =
  | 'circle'
  | 'rectangle'
  | 'rounded-rectangle'
  | 'path-rounded-rectangle'
  | 'marker';

export type NodeGeometry = {
  type?: GeometryNodeType;
  center: [number, number];
  radius?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
};

const EPSILON = 1e-6;

function normalizeDirection(
  center: [number, number],
  target: [number, number]
): {unit: [number, number]; distance: number} | null {
  const dx = target[0] - center[0];
  const dy = target[1] - center[1];
  const length = Math.hypot(dx, dy);

  if (length <= EPSILON) {
    return null;
  }

  return {unit: [dx / length, dy / length], distance: length};
}

function projectFromCenter(
  center: [number, number],
  unit: [number, number],
  distance: number
): [number, number] {
  return [center[0] + unit[0] * distance, center[1] + unit[1] * distance];
}

function projectToRectangle(
  center: [number, number],
  unit: [number, number],
  halfWidth: number,
  halfHeight: number
): [number, number] {
  const absUx = Math.abs(unit[0]);
  const absUy = Math.abs(unit[1]);

  let distance = Number.POSITIVE_INFINITY;
  if (halfWidth > 0 && absUx > EPSILON) {
    distance = Math.min(distance, halfWidth / absUx);
  }
  if (halfHeight > 0 && absUy > EPSILON) {
    distance = Math.min(distance, halfHeight / absUy);
  }

  if (!Number.isFinite(distance)) {
    return [...center] as [number, number];
  }

  return [center[0] + unit[0] * distance, center[1] + unit[1] * distance];
}

function resolveCornerRadius(
  rawCornerRadius: number | undefined,
  halfWidth: number,
  halfHeight: number
): number {
  if (!Number.isFinite(rawCornerRadius) || rawCornerRadius <= 0) {
    return 0;
  }

  let resolved = rawCornerRadius;
  if (resolved <= 1) {
    resolved *= Math.min(halfWidth, halfHeight);
  }

  return Math.min(resolved, halfWidth, halfHeight);
}

// eslint-disable-next-line max-params
function intersectsInnerFaces(
  absX: number,
  absY: number,
  innerHalfWidth: number,
  innerHalfHeight: number,
  halfWidth: number,
  halfHeight: number
) {
  const insideVerticalFace = absX <= innerHalfWidth + EPSILON && absY <= halfHeight + EPSILON;
  const insideHorizontalFace = absY <= innerHalfHeight + EPSILON && absX <= halfWidth + EPSILON;
  return insideVerticalFace || insideHorizontalFace;
}

// eslint-disable-next-line max-params
function projectToCornerArc(
  geometry: NodeGeometry,
  unit: [number, number],
  innerHalfWidth: number,
  innerHalfHeight: number,
  cornerRadius: number,
  rectanglePoint: [number, number]
) {
  const offsetX = rectanglePoint[0] - geometry.center[0];
  const offsetY = rectanglePoint[1] - geometry.center[1];

  const cornerCenter: [number, number] = [
    geometry.center[0] + Math.sign(offsetX || unit[0]) * innerHalfWidth,
    geometry.center[1] + Math.sign(offsetY || unit[1]) * innerHalfHeight
  ];
  const relativeCornerCenter: [number, number] = [
    cornerCenter[0] - geometry.center[0],
    cornerCenter[1] - geometry.center[1]
  ];

  const dot = unit[0] * relativeCornerCenter[0] + unit[1] * relativeCornerCenter[1];
  const centerDistanceSq =
    relativeCornerCenter[0] * relativeCornerCenter[0] +
    relativeCornerCenter[1] * relativeCornerCenter[1];
  const discriminant = dot * dot - (centerDistanceSq - cornerRadius * cornerRadius);

  if (discriminant < 0) {
    return rectanglePoint;
  }

  const distance = dot - Math.sqrt(Math.max(0, discriminant));
  return projectFromCenter(geometry.center, unit, distance);
}

function computeRectangleIntersection(
  geometry: NodeGeometry,
  unit: [number, number]
): [number, number] {
  const halfWidth = (geometry.width ?? 0) / 2;
  const halfHeight = (geometry.height ?? 0) / 2;
  if (halfWidth <= EPSILON || halfHeight <= EPSILON) {
    return [...geometry.center];
  }
  return projectToRectangle(geometry.center, unit, halfWidth, halfHeight);
}

// eslint-disable-next-line max-statements, complexity
function computeRoundedRectangleIntersection(
  geometry: NodeGeometry,
  unit: [number, number]
): [number, number] {
  const halfWidth = (geometry.width ?? 0) / 2;
  const halfHeight = (geometry.height ?? 0) / 2;

  if (halfWidth <= EPSILON || halfHeight <= EPSILON) {
    const radius = geometry.radius ?? Math.min(halfWidth, halfHeight);
    return projectFromCenter(geometry.center, unit, radius);
  }

  const cornerRadius = resolveCornerRadius(geometry.cornerRadius, halfWidth, halfHeight);

  if (cornerRadius <= EPSILON) {
    return projectToRectangle(geometry.center, unit, halfWidth, halfHeight);
  }

  const innerHalfWidth = Math.max(halfWidth - cornerRadius, 0);
  const innerHalfHeight = Math.max(halfHeight - cornerRadius, 0);

  if (innerHalfWidth <= EPSILON || innerHalfHeight <= EPSILON) {
    const radius = Math.min(halfWidth, halfHeight);
    return projectFromCenter(geometry.center, unit, radius);
  }

  const rectanglePoint = projectToRectangle(geometry.center, unit, halfWidth, halfHeight);
  const absX = Math.abs(rectanglePoint[0] - geometry.center[0]);
  const absY = Math.abs(rectanglePoint[1] - geometry.center[1]);

  const touchesInnerFace = absX <= innerHalfWidth + EPSILON || absY <= innerHalfHeight + EPSILON;

  if (
    touchesInnerFace &&
    intersectsInnerFaces(absX, absY, innerHalfWidth, innerHalfHeight, halfWidth, halfHeight)
  ) {
    return rectanglePoint;
  }

  return projectToCornerArc(
    geometry,
    unit,
    innerHalfWidth,
    innerHalfHeight,
    cornerRadius,
    rectanglePoint
  );
}

function computeCircleIntersection(
  geometry: NodeGeometry,
  unit: [number, number],
  radius?: number
) {
  const effectiveRadius = radius ?? geometry.radius ?? 0;
  return projectFromCenter(geometry.center, unit, Math.max(effectiveRadius, 0));
}

const BOUNDARY_COMPUTERS: Record<
  GeometryNodeType,
  (geometry: NodeGeometry, unit: [number, number]) => [number, number]
> = {
  circle: (geometry, unit) => computeCircleIntersection(geometry, unit),
  marker: (geometry, unit) => computeCircleIntersection(geometry, unit),
  rectangle: (geometry, unit) => computeRectangleIntersection(geometry, unit),
  'rounded-rectangle': (geometry, unit) => computeRoundedRectangleIntersection(geometry, unit),
  'path-rounded-rectangle': (geometry, unit) => computeRoundedRectangleIntersection(geometry, unit)
};

export function getNodeBoundaryIntersection(
  geometry: NodeGeometry,
  targetCenter: [number, number]
): [number, number] {
  const direction = normalizeDirection(geometry.center, targetCenter);
  if (!direction) {
    return [...geometry.center];
  }

  const handler = geometry.type ? BOUNDARY_COMPUTERS[geometry.type] : undefined;
  if (handler) {
    return handler(geometry, direction.unit);
  }

  if (geometry.radius && geometry.radius > EPSILON) {
    return projectFromCenter(geometry.center, direction.unit, geometry.radius);
  }

  return [...geometry.center];
}
