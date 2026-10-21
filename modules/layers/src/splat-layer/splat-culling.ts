// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport, type Viewport} from '@deck.gl/core';

export type SplatProjection = {
  matrix: number[];
  center: number[];
  width: number;
  height: number;
};

/** Absolute Mercator positions and owner-local metre scales are independent of camera latitude. */
export function getSplatProjectionKey(viewport: Viewport): string {
  return [
    viewport.projectionMode,
    viewport.resolution,
    ...(viewport instanceof WebMercatorViewport ? [] : viewport.distanceScales.unitsPerMeter)
  ].join(',');
}

/** Metre conversion at the owner's geographic latitude, rather than the moving camera's centre. */
export function getSplatCommonUnits(common: number[], viewport: Viewport): number[] {
  return viewport instanceof WebMercatorViewport
    ? viewport.getDistanceScales(viewport.unprojectPosition(common)).unitsPerMeter
    : viewport.distanceScales.unitsPerMeter;
}

/** Six normalized planes, with optional XY padding in the projection viewport's pixel units. */
export function createSplatFrustum(projection: SplatProjection, pixelPadding = 0): Float64Array {
  const planes = new Float64Array(24);
  const m = projection.matrix;
  for (let axis = 0; axis < 3; axis++) {
    const expansion =
      axis < 2 ? 1 + (2 * pixelPadding) / (axis === 0 ? projection.width : projection.height) : 1;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const offset = (axis * 2 + side) * 4;
      const x = m[3] * expansion + sign * m[axis];
      const y = m[7] * expansion + sign * m[axis + 4];
      const z = m[11] * expansion + sign * m[axis + 8];
      const length = Math.hypot(x, y, z);
      // Keep degenerate planes conservative, including an infinite far plane.
      const inverse = length > 0 ? 1 / length : 1;
      planes[offset] = x * inverse;
      planes[offset + 1] = y * inverse;
      planes[offset + 2] = z * inverse;
      planes[offset + 3] =
        ((m[15] + projection.center[3]) * expansion +
          sign * (m[axis + 12] + projection.center[axis])) *
        inverse;
    }
  }
  return planes;
}

/** Allocation-free conservative sphere/frustum intersection in absolute common space. */
export function intersectsSplatFrustum(
  position: number[],
  radius: number,
  planes: Float64Array
): boolean {
  for (let offset = 0; offset < 24; offset += 4) {
    if (
      planes[offset] * position[0] +
        planes[offset + 1] * position[1] +
        planes[offset + 2] * position[2] +
        planes[offset + 3] <
      -radius
    )
      return false;
  }
  return true;
}

/** Largest singular value of the perspective projection Jacobian, in pixels per metre. */
export function getSplatPixelsPerMeter(
  position: number[],
  viewport: Viewport,
  units = getSplatCommonUnits(position, viewport)
): number {
  const m = viewport.viewProjectionMatrix;
  const x = m[0] * position[0] + m[4] * position[1] + m[8] * position[2] + m[12];
  const y = m[1] * position[0] + m[5] * position[1] + m[9] * position[2] + m[13];
  const w = m[3] * position[0] + m[7] * position[1] + m[11] * position[2] + m[15];
  if (w <= 1e-8) return Infinity;
  let a = 0,
    b = 0,
    c = 0;
  for (let axis = 0; axis < 3; axis++) {
    const factor = units[axis] / (2 * w * w);
    const u = (m[axis * 4] * w - x * m[3 + axis * 4]) * viewport.width * factor;
    const v = (m[1 + axis * 4] * w - y * m[3 + axis * 4]) * viewport.height * factor;
    a += u * u;
    b += u * v;
    c += v * v;
  }
  return Math.sqrt((a + c + Math.sqrt((a - c) ** 2 + 4 * b * b)) / 2);
}

/**
 * Conservatively bound projected detail across an owner's full sphere, while keeping near-plane
 * and behind-eye supports finite. Sampling only the center underestimates a crown that reaches
 * toward a steeply pitched camera, so the Jacobian uses the closest possible clip-space depth.
 */
export function getSplatBoundedPixelsPerMeter(
  position: number[],
  radius: number,
  viewport: Viewport,
  units = getSplatCommonUnits(position, viewport)
): number {
  const maximum =
    (2 * Math.max(viewport.width, viewport.height) * Math.max(...units)) / Math.max(radius, 1e-12);
  const m = viewport.viewProjectionMatrix;
  const x = m[0] * position[0] + m[4] * position[1] + m[8] * position[2] + m[12];
  const y = m[1] * position[0] + m[5] * position[1] + m[9] * position[2] + m[13];
  const w = m[3] * position[0] + m[7] * position[1] + m[11] * position[2] + m[15];
  const wRadius = radius * Math.hypot(m[3], m[7], m[11]);
  const minimumW = w - wRadius;
  if (!(minimumW > 1e-8)) return maximum;
  const maximumX = Math.abs(x) + radius * Math.hypot(m[0], m[4], m[8]);
  const maximumY = Math.abs(y) + radius * Math.hypot(m[1], m[5], m[9]);
  let uu = 0,
    uv = 0,
    vv = 0;
  for (let axis = 0; axis < 3; axis++) {
    const u =
      (viewport.width *
        units[axis] *
        (Math.abs(m[axis * 4]) / minimumW +
          (maximumX * Math.abs(m[3 + axis * 4])) / (minimumW * minimumW))) /
      2;
    const v =
      (viewport.height *
        units[axis] *
        (Math.abs(m[1 + axis * 4]) / minimumW +
          (maximumY * Math.abs(m[3 + axis * 4])) / (minimumW * minimumW))) /
      2;
    uu += u * u;
    uv += u * v;
    vv += v * v;
  }
  const upperBound = Math.sqrt((uu + vv + Math.sqrt((uu - vv) ** 2 + 4 * uv * uv)) / 2);
  return Math.min(maximum, Math.max(getSplatPixelsPerMeter(position, viewport, units), upperBound));
}

function containsSplatProjectedPoint(
  x: number,
  y: number,
  xx: number,
  xy: number,
  yy: number,
  determinant: number,
  support: number
): boolean {
  return yy * x * x - 2 * xy * x * y + xx * y * y <= support * support * determinant;
}

/**
 * Fraction of a projected support that can contribute to the viewport's requested detail.
 * A support centered in, or large enough to span, the viewport remains at full detail.
 * Offscreen-centered supports taper continuously toward a true sliver. Near-eye supports stay
 * conservative because their projected footprint is nonlinear.
 */
export function getSplatViewportLodWeight(
  position: number[],
  radius: number,
  viewport: Viewport
): number {
  const m = viewport.viewProjectionMatrix;
  const x = m[0] * position[0] + m[4] * position[1] + m[8] * position[2] + m[12];
  const y = m[1] * position[0] + m[5] * position[1] + m[9] * position[2] + m[13];
  const w = m[3] * position[0] + m[7] * position[1] + m[11] * position[2] + m[15];
  if (!(radius > 1e-8) || !Number.isFinite(radius) || w <= 1e-8) return 1;
  // A sphere crossing the eye plane cannot use a linear projected support safely.
  if (w - radius * Math.hypot(m[3], m[7], m[11]) <= 1e-8) return 1;
  const centerX = ((x / w + 1) * viewport.width) / 2;
  const centerY = ((1 - y / w) * viewport.height) / 2;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return 1;
  const deltaX = centerX < 0 ? -centerX : centerX > viewport.width ? viewport.width - centerX : 0;
  const deltaY = centerY < 0 ? -centerY : centerY > viewport.height ? viewport.height - centerY : 0;
  const distance = Math.hypot(deltaX, deltaY);
  if (!(distance > 1e-8)) return 1;
  const directionX = deltaX / distance;
  const directionY = deltaY / distance;
  let xx = 0,
    xy = 0,
    yy = 0;
  for (let axis = 0; axis < 3; axis++) {
    const xDerivative = ((m[axis * 4] * w - x * m[3 + axis * 4]) * viewport.width) / (2 * w * w);
    const yDerivative =
      -((m[1 + axis * 4] * w - y * m[3 + axis * 4]) * viewport.height) / (2 * w * w);
    xx += xDerivative * xDerivative;
    xy += xDerivative * yDerivative;
    yy += yDerivative * yDerivative;
  }
  const determinant = xx * yy - xy * xy;
  if (
    determinant > 1e-12 &&
    Number.isFinite(determinant) &&
    containsSplatProjectedPoint(-centerX, -centerY, xx, xy, yy, determinant, radius) &&
    containsSplatProjectedPoint(
      viewport.width - centerX,
      -centerY,
      xx,
      xy,
      yy,
      determinant,
      radius
    ) &&
    containsSplatProjectedPoint(
      -centerX,
      viewport.height - centerY,
      xx,
      xy,
      yy,
      determinant,
      radius
    ) &&
    containsSplatProjectedPoint(
      viewport.width - centerX,
      viewport.height - centerY,
      xx,
      xy,
      yy,
      determinant,
      radius
    )
  )
    return 1;
  const radiusPixels =
    radius *
    Math.sqrt(
      directionX * directionX * xx + 2 * directionX * directionY * xy + directionY * directionY * yy
    );
  if (!(radiusPixels > 1e-8) || !Number.isFinite(radiusPixels)) return 1;
  const overlap = Math.max(0, Math.min(1, 1 - distance / radiusPixels));
  return overlap * overlap * (3 - 2 * overlap);
}

/** Smooth per-owner priority from its projected crown center. It never affects visibility. */
export function getSplatFocusWeight(
  position: number[],
  viewport: Viewport,
  strength: number
): number {
  if (!(strength > 0)) return 1;
  const m = viewport.viewProjectionMatrix;
  const w = m[3] * position[0] + m[7] * position[1] + m[11] * position[2] + m[15];
  if (w <= 1e-8) return 1 - Math.min(1, strength) * 0.85;
  const x = (m[0] * position[0] + m[4] * position[1] + m[8] * position[2] + m[12]) / w;
  const y = (m[1] * position[0] + m[5] * position[1] + m[9] * position[2] + m[13]) / w;
  const radius = Math.min(1, Math.hypot(x, y));
  return 1 - Math.min(1, strength) * 0.85 * radius ** 4;
}

export type SplatProjectedPosition = {common: number[]; units: number[]};
/** Reuse owner-local projections across streamed membership changes. The next map bounds residency. */
export function getSplatCachedPosition(
  position: ArrayLike<number>,
  viewport: Viewport,
  previous: Map<string, SplatProjectedPosition>,
  next: Map<string, SplatProjectedPosition>,
  project: (position: number[]) => number[]
): SplatProjectedPosition {
  const values = Array.from(position),
    key = values.join(',');
  let projected = next.get(key) ?? previous.get(key);
  if (!projected) {
    const common = project(values);
    projected = {common, units: getSplatCommonUnits(common, viewport)};
  }
  next.set(key, projected);
  return projected;
}
