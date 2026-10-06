// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Matrix4} from '@math.gl/core';
import type {Viewport} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';
import {
  getSplatPixelsPerMeter,
  intersectsSplatLightVolume
} from '../../src/splat-layer/splat-culling';
const matrix = new Matrix4().perspective({fovy: Math.PI / 2, aspect: 1, near: 0.1, far: 100});
const projection = {matrix, center: [0, 0, 0, 0], width: 100, height: 100};
describe('Gaussian projection refinement', () => {
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
