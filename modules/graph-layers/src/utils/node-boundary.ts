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

function intersectRoundedRectangle(
  geometry: NodeGeometry,
  unit: [number, number],
  halfWidth: number,
  halfHeight: number
): [number, number] {
  const cornerRadius = resolveCornerRadius(geometry.cornerRadius, halfWidth, halfHeight);

  if (cornerRadius <= EPSILON) {
    return projectToRectangle(geometry.center, unit, halfWidth, halfHeight);
  }

  const innerHalfWidth = Math.max(halfWidth - cornerRadius, 0);
  const innerHalfHeight = Math.max(halfHeight - cornerRadius, 0);

  if (innerHalfWidth <= EPSILON || innerHalfHeight <= EPSILON) {
    const radius = Math.min(halfWidth, halfHeight);
    return [
      geometry.center[0] + unit[0] * radius,
      geometry.center[1] + unit[1] * radius
    ];
  }

  const rectanglePoint = projectToRectangle(geometry.center, unit, halfWidth, halfHeight);
  const offsetX = rectanglePoint[0] - geometry.center[0];
  const offsetY = rectanglePoint[1] - geometry.center[1];
  const absX = Math.abs(offsetX);
  const absY = Math.abs(offsetY);

  const insideVerticalFace = absX <= innerHalfWidth + EPSILON && absY <= halfHeight + EPSILON;
  const insideHorizontalFace = absY <= innerHalfHeight + EPSILON && absX <= halfWidth + EPSILON;

  if (absX <= innerHalfWidth + EPSILON || absY <= innerHalfHeight + EPSILON) {
    if (insideVerticalFace || insideHorizontalFace) {
      return rectanglePoint;
    }
  }

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
  return [
    geometry.center[0] + unit[0] * distance,
    geometry.center[1] + unit[1] * distance
  ];
}

export function getNodeBoundaryIntersection(
  geometry: NodeGeometry,
  targetCenter: [number, number]
): [number, number] {
  const direction = normalizeDirection(geometry.center, targetCenter);
  if (!direction) {
    return [...geometry.center];
  }

  const {unit} = direction;

  switch (geometry.type) {
    case 'circle':
    case 'marker': {
      const radius = geometry.radius ?? 0;
      return [geometry.center[0] + unit[0] * radius, geometry.center[1] + unit[1] * radius];
    }
    case 'rectangle': {
      const halfWidth = (geometry.width ?? 0) / 2;
      const halfHeight = (geometry.height ?? 0) / 2;
      if (halfWidth <= EPSILON || halfHeight <= EPSILON) {
        return [...geometry.center];
      }
      return projectToRectangle(geometry.center, unit, halfWidth, halfHeight);
    }
    case 'rounded-rectangle':
    case 'path-rounded-rectangle': {
      const halfWidth = (geometry.width ?? 0) / 2;
      const halfHeight = (geometry.height ?? 0) / 2;
      if (halfWidth <= EPSILON || halfHeight <= EPSILON) {
        const radius = geometry.radius ?? Math.min(halfWidth, halfHeight);
        return [
          geometry.center[0] + unit[0] * radius,
          geometry.center[1] + unit[1] * radius
        ];
      }
      return intersectRoundedRectangle(geometry, unit, halfWidth, halfHeight);
    }
    default: {
      if (geometry.radius && geometry.radius > EPSILON) {
        return [
          geometry.center[0] + unit[0] * geometry.radius,
          geometry.center[1] + unit[1] * geometry.radius
        ];
      }
      return [...geometry.center];
    }
  }
}
