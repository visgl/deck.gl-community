// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Matrix4} from '@math.gl/core';
import {WebMercatorViewport, type Viewport} from '@deck.gl/core';
import {describe, expect, it, vi} from 'vitest';
import {
  getSplatPixelsPerMeter,
  getSplatCommonUnits,
  getSplatCachedPosition,
  type SplatProjectedPosition,
  getSplatBoundedPixelsPerMeter,
  getSplatFocusWeight,
  intersectsSplatLightVolume
} from '../../src/splat-layer/splat-culling';
const matrix = new Matrix4().perspective({fovy: Math.PI / 2, aspect: 1, near: 0.1, far: 100});
const projection = {matrix, center: [0, 0, 0, 0], width: 100, height: 100};
describe('Gaussian projection refinement', () => {
  it('uses each geographic owner latitude for projected metre error', () => {
    const viewport = new WebMercatorViewport({width: 800, height: 600, latitude: 0, zoom: 1});
    const position = viewport.projectPosition([0, 60, 0]);
    const local = getSplatCommonUnits(position, viewport);
    const reference = {
      viewProjectionMatrix: viewport.viewProjectionMatrix,
      width: viewport.width,
      height: viewport.height,
      distanceScales: {unitsPerMeter: local}
    } as unknown as Viewport;
    expect(local[0] / viewport.distanceScales.unitsPerMeter[0]).toBeCloseTo(2);
    expect(getSplatPixelsPerMeter(position, viewport)).toBeCloseTo(
      getSplatPixelsPerMeter(position, reference)
    );
  });
  it('excludes spheres behind the eye and beyond the near plane while retaining intersecting bounds', () => {
    expect(intersectsSplatLightVolume([0, 0, 5], 0.5, projection)).toBe(false);
    expect(intersectsSplatLightVolume([0, 0, -0.05], 0.02, projection)).toBe(false);
    expect(intersectsSplatLightVolume([0, 0, -0.05], 0.1, projection)).toBe(true);
    expect(intersectsSplatLightVolume([0, 0, -5], 0.5, projection)).toBe(true);
    expect(intersectsSplatLightVolume([8, 0, -5], 0.5, projection)).toBe(false);
  });
  it('refines against perspective distance instead of nominal map zoom', () => {
    const viewport = {
      viewProjectionMatrix: matrix,
      width: 100,
      height: 100,
      distanceScales: {unitsPerMeter: [1, 1, 1]}
    } as unknown as Viewport;
    expect(getSplatPixelsPerMeter([0, 0, -5], viewport)).toBeCloseTo(10);
    expect(getSplatPixelsPerMeter([0, 0, -10], viewport)).toBeCloseTo(5);
    expect(getSplatPixelsPerMeter([0, 0, 5], viewport)).toBe(Infinity);
  });
});

import {
  createSplatSpatialIndex,
  querySplatSpatialIndex
} from '../../src/splat-layer/splat-spatial-index';
it('selects bounded owner groups without dropping a large crown crossing the viewport edge', () => {
  const entries = Array.from({length: 128}, (_, i) => ({
    center: [i - 64, 0, -5],
    radius: 0.1,
    value: i
  }));
  entries.push({center: [8, 0, -5], radius: 4, value: 1000});
  const index = createSplatSpatialIndex(entries);
  const visible = querySplatSpatialIndex(index, [projection]);
  expect(visible).toContain(64);
  expect(visible).toContain(1000);
  expect(visible).not.toContain(0);
  expect(visible.length).toBeLessThan(20);
  const shifted = {...projection, center: [-20, 0, 0, 0]};
  const second = querySplatSpatialIndex(index, [shifted]);
  const union = querySplatSpatialIndex(index, [projection, shifted]);
  expect(new Set(union)).toEqual(new Set([...visible, ...second]));
});

import {createSplatFrustum, intersectsSplatFrustum} from '../../src/splat-layer/splat-culling';
it('matches clip-space plane tests for translated perspective and orthographic light volumes', () => {
  for (const projection of [
    {matrix: Array.from(matrix), center: [0.4, -0.2, 0, 0], width: 100, height: 100},
    {
      matrix: Array.from(new Matrix4().scale([0.5, 0.2, 0.4])),
      center: [0.1, 0, -0.3, 0],
      width: 100,
      height: 100
    }
  ]) {
    const m = projection.matrix,
      planes = createSplatFrustum(projection);
    for (let i = 0; i < 200; i++) {
      const point = [Math.sin(i * 1.7) * 12, Math.cos(i * 0.3) * 10, Math.sin(i * 0.7) * 15];
      const radius = (i % 11) / 3;
      const clip = [0, 1, 2, 3].map(
        axis =>
          m[axis] * point[0] +
          m[axis + 4] * point[1] +
          m[axis + 8] * point[2] +
          m[axis + 12] +
          projection.center[axis]
      );
      const reference = [0, 1, 2].every(axis =>
        [-1, 1].every(
          sign =>
            clip[3] +
              sign * clip[axis] +
              radius *
                Math.hypot(
                  m[3] + sign * m[axis],
                  m[7] + sign * m[axis + 4],
                  m[11] + sign * m[axis + 8]
                ) >=
            0
        )
      );
      expect(intersectsSplatFrustum(point, radius, planes)).toBe(reference);
    }
  }
});

it('refines each crown around the screen center with a smooth bounded peripheral weight', () => {
  const viewport = {viewProjectionMatrix: matrix, width: 100, height: 100} as unknown as Viewport;
  expect(getSplatFocusWeight([0, 0, -5], viewport, 1)).toBe(1);
  const weights = [0, 1, 2, 3, 4, 5].map(x => getSplatFocusWeight([x, 0, -5], viewport, 1));
  for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
  expect(weights.at(-1)).toBeCloseTo(0.15);
  expect(getSplatFocusWeight([5, 0, -5], viewport, 0)).toBe(1);
});

it('keeps intersecting behind-eye crowns at bounded peripheral refinement priority', () => {
  const viewport = {
    viewProjectionMatrix: matrix,
    width: 100,
    height: 100,
    distanceScales: {unitsPerMeter: [1, 1, 1]}
  } as unknown as Viewport;
  expect(getSplatBoundedPixelsPerMeter([0, 0, 5], 10, viewport)).toBe(20);
  expect(getSplatBoundedPixelsPerMeter([0, 0, -5], 0.5, viewport)).toBeCloseTo(10);
  expect(getSplatFocusWeight([0, 0, 5], viewport, 1)).toBeCloseTo(0.15);
});

it('reuses unchanged geographic positions across source batches without retaining removed entries', () => {
  const viewport = {distanceScales: {unitsPerMeter: [1, 1, 1]}} as unknown as Viewport;
  const project = vi.fn(point => point);
  const first = new Map<string, SplatProjectedPosition>();
  const a = getSplatCachedPosition([1, 2, 3], viewport, new Map(), first, project);
  getSplatCachedPosition([2, 3, 4], viewport, new Map(), first, project);
  const next = new Map<string, SplatProjectedPosition>();
  expect(getSplatCachedPosition([1, 2, 3], viewport, first, next, project)).toBe(a);
  getSplatCachedPosition([3, 4, 5], viewport, first, next, project);
  expect(project).toHaveBeenCalledTimes(3);
  expect(next.size).toBe(2);
  expect(next.has('2,3,4')).toBe(false);
});
