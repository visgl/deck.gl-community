// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport, type Viewport} from '@deck.gl/core';
import type {SplatShadowProjection} from './splat-shadow-pass';

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

/** Six normalized planes, extracted once per camera/light rather than once per sphere. */
export function createSplatFrustum(projection: SplatShadowProjection): Float64Array {
  const planes = new Float64Array(24);
  const m = projection.matrix;
  for (let axis = 0; axis < 3; axis++) {
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const offset = (axis * 2 + side) * 4;
      const x = m[3] + sign * m[axis];
      const y = m[7] + sign * m[axis + 4];
      const z = m[11] + sign * m[axis + 8];
      const length = Math.hypot(x, y, z);
      // Keep degenerate planes conservative, including an infinite far plane.
      const inverse = length > 0 ? 1 / length : 1;
      planes[offset] = x * inverse;
      planes[offset + 1] = y * inverse;
      planes[offset + 2] = z * inverse;
      planes[offset + 3] =
        (m[15] + projection.center[3] + sign * (m[axis + 12] + projection.center[axis])) * inverse;
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

/** Conservative sphere/light-volume intersection. It does not depend on screen visibility. */
export function intersectsSplatLightVolume(
  position: number[],
  radius: number,
  projection: SplatShadowProjection
): boolean {
  return intersectsSplatFrustum(position, radius, createSplatFrustum(projection));
}

/** Largest singular value of the perspective projection Jacobian, in pixels per metre. */
export function getSplatPixelsPerMeter(position: number[], viewport: Viewport): number {
  const m = viewport.viewProjectionMatrix;
  const x = m[0] * position[0] + m[4] * position[1] + m[8] * position[2] + m[12];
  const y = m[1] * position[0] + m[5] * position[1] + m[9] * position[2] + m[13];
  const w = m[3] * position[0] + m[7] * position[1] + m[11] * position[2] + m[15];
  if (w <= 1e-8) return Infinity;
  let a = 0,
    b = 0,
    c = 0;
  const units = getSplatCommonUnits(position, viewport);
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

/** Bound near-plane/behind-eye refinement by viewport coverage, while keeping intersecting owners. */
export function getSplatBoundedPixelsPerMeter(
  position: number[],
  radius: number,
  viewport: Viewport
): number {
  const units = Math.max(...getSplatCommonUnits(position, viewport));
  const maximum = (2 * Math.max(viewport.width, viewport.height) * units) / Math.max(radius, 1e-12);
  return Math.min(maximum, getSplatPixelsPerMeter(position, viewport));
}

/** Smooth per-owner priority from its projected crown center. It never affects visibility or light-space LOD. */
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
