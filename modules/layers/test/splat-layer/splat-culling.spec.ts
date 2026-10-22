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
  getSplatViewportLodWeight,
  createSplatFrustum,
  intersectsSplatFrustum,
  classifySplatFrustum
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
  it('culls camera-space spheres and retains bounds intersecting the near plane', () => {
    const planes = createSplatFrustum(projection);
    expect(intersectsSplatFrustum([0, 0, 5], 0.5, planes)).toBe(false);
    expect(intersectsSplatFrustum([0, 0, -0.05], 0.02, planes)).toBe(false);
    expect(intersectsSplatFrustum([0, 0, -0.05], 0.1, planes)).toBe(true);
    expect(intersectsSplatFrustum([0, 0, -5], 0.5, planes)).toBe(true);
    expect(intersectsSplatFrustum([8, 0, -5], 0.5, planes)).toBe(false);
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

it('matches clip-space plane tests for translated perspective and orthographic camera frusta', () => {
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
  expect(getSplatBoundedPixelsPerMeter([0, 0, -5], 0.5, viewport)).toBeGreaterThan(10);
  expect(getSplatFocusWeight([0, 0, 5], viewport, 1)).toBeCloseTo(0.15);
});

it('uses the nearest visible support depth when a pitched camera sees a crown approach its eye', () => {
  const viewport = {
    viewProjectionMatrix: matrix,
    width: 100,
    height: 100,
    distanceScales: {unitsPerMeter: [1, 1, 1]}
  } as unknown as Viewport;
  const position = [0, 0, -5];
  expect(getSplatPixelsPerMeter(position, viewport)).toBeCloseTo(10);
  // A radius-four support reaches much closer than its center. The analytic bound resolves to
  // the existing viewport cap rather than under-requesting the visible edge detail.
  expect(getSplatBoundedPixelsPerMeter(position, 4, viewport)).toBe(50);
  // A sphere touching the eye remains finite and bounded.
  expect(getSplatBoundedPixelsPerMeter(position, 5, viewport)).toBe(40);
});

it('accepts owner-local unit scales without changing projected detail', () => {
  const viewport = {
    viewProjectionMatrix: matrix,
    width: 100,
    height: 100,
    distanceScales: {unitsPerMeter: [2, 3, 4]}
  } as unknown as Viewport;
  const position = [0, 0, -5];
  const units = getSplatCommonUnits(position, viewport);
  expect(getSplatPixelsPerMeter(position, viewport, units)).toBeCloseTo(
    getSplatPixelsPerMeter(position, viewport)
  );
  expect(getSplatBoundedPixelsPerMeter(position, 0.5, viewport, units)).toBeCloseTo(
    getSplatBoundedPixelsPerMeter(position, 0.5, viewport)
  );
});

it('keeps centered supports detailed and tapers offscreen support toward a sliver', () => {
  const viewport = {viewProjectionMatrix: matrix, width: 100, height: 100} as unknown as Viewport;
  const orthographic = {
    viewProjectionMatrix: new Matrix4().scale([0.02, 0.02, 0.4]),
    width: 100,
    height: 100
  } as unknown as Viewport;
  const clipped = getSplatViewportLodWeight([8, 0, -5], 4, viewport);
  const corner = getSplatViewportLodWeight([8, 8, -5], 4, viewport);
  expect(getSplatViewportLodWeight([0, 0, -5], 0.5, viewport)).toBe(1);
  expect(clipped).toBeGreaterThan(0);
  expect(clipped).toBeLessThan(1);
  expect(corner).toBeLessThan(clipped);
  // A large orthographic support remains detailed when it contains the complete viewport.
  expect(getSplatViewportLodWeight([55, 0, 0], 120, orthographic)).toBe(1);
  expect(getSplatViewportLodWeight([0, 0, 5], 1, viewport)).toBe(1);
  expect(getSplatViewportLodWeight([0, 0, -0.05], 0.1, viewport)).toBe(1);
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

it.each([0, 1])('retains filtered pixels beyond camera axis %i without expanding depth', axis => {
  const projection = {
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    center: [0, 0, 0, 0],
    width: 100,
    height: 100
  };
  const center = [0, 0, 0];
  center[axis] = 1.08;
  const index = createSplatSpatialIndex([
    {center, radius: 0.06, value: 'filtered-edge'},
    {center: [1.4, 0, 0], radius: 0.06, value: 'distant'},
    {center: [0, 0, -2], radius: 0.06, value: 'behind-near'}
  ]);
  expect(querySplatSpatialIndex(index, [projection])).not.toContain('filtered-edge');
  expect(querySplatSpatialIndex(index, [projection], 3 * Math.sqrt(4))).toEqual(['filtered-edge']);
});

it('accepts contained BVH branches with the same owners and order as testing every owner', () => {
  const planes = createSplatFrustum(projection);
  expect(classifySplatFrustum([0, 0, -5], 0.5, planes)).toBe(1);
  expect(classifySplatFrustum([5, 0, -5], 0.5, planes)).toBe(0);
  expect(classifySplatFrustum([0, 0, 5], 0.5, planes)).toBe(-1);
  // Pseudo-random crowns in, across and outside two overlapping frusta.
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  const entries = Array.from({length: 3000}, (_, i) => ({
    center: [random() * 30, random() * 30, -15 + random() * 14],
    radius: Math.abs(random()) * 2,
    value: i
  }));
  const index = createSplatSpatialIndex(entries)!;
  for (const views of [[projection], [projection, {...projection, center: [-6, 3, 0, 0]}]]) {
    const frusta = views.map(view => createSplatFrustum(view, 2));
    const reference: number[] = [];
    // The previous traversal: test every node and every owner against each frustum.
    const visit = (node: typeof index) => {
      const hit = (entry: {center: number[]; radius: number}) =>
        frusta.some(frustum => intersectsSplatFrustum(entry.center, entry.radius, frustum));
      if (!hit(node)) return;
      if (node.children) node.children.forEach(visit);
      else for (const entry of node.entries!) if (hit(entry)) reference.push(entry.value);
    };
    visit(index);
    expect(reference.length).toBeGreaterThan(100);
    expect(reference.length).toBeLessThan(entries.length);
    expect(querySplatSpatialIndex(index, views, 2)).toEqual(reference);
  }
});

it('caches per-view projection scales without changing bounded detail', () => {
  const viewport = new WebMercatorViewport({width: 800, height: 600, zoom: 16, pitch: 50});
  const position = viewport.projectPosition([0.001, 0.001, 0]);
  const units = getSplatCommonUnits(position, viewport);
  const first = getSplatBoundedPixelsPerMeter(position, 0.01, viewport, units);
  const other = new WebMercatorViewport({width: 400, height: 900, zoom: 17, pitch: 20});
  const second = getSplatBoundedPixelsPerMeter(position, 0.01, other, units);
  // Alternating views must not reuse another camera's scales.
  expect(getSplatBoundedPixelsPerMeter(position, 0.01, viewport, units)).toBe(first);
  expect(getSplatBoundedPixelsPerMeter(position, 0.01, other, units)).toBe(second);
  expect(second).not.toBe(first);
});
