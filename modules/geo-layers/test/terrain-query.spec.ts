// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test, vi} from 'vitest';
import {Matrix4} from '@math.gl/core';
import {pickTerrainSurface, type TerrainSurface} from '../src/terrain/terrain-query';
import {createFixtureTerrain} from '../../../examples/basemap-layers/terrain-contract/terrain-fixture';

const viewport = {x: 100, y: 50, width: 200, height: 100, viewProjectionMatrix: new Matrix4()};
const identity = new Matrix4();

test('routes absolute CSS pixels through the actual eye, with a finite content-space segment', () => {
  const source: TerrainSurface = {projection: 'web-mercator', intersectRay: vi.fn(() => null)};
  expect(pickTerrainSurface(viewport, [200, 100], source, identity)).toBeNull();
  expect(source.intersectRay).toHaveBeenLastCalledWith(
    {origin: [0, 0, -1], direction: [0, 0, 2]},
    2
  );
  pickTerrainSurface({...viewport, x: 300}, [400, 100], source, identity);
  expect(source.intersectRay).toHaveBeenLastCalledWith(
    {origin: [0, 0, -1], direction: [0, 0, 2]},
    2
  );
  pickTerrainSurface(viewport, [100, 50], source, identity);
  expect(source.intersectRay).toHaveBeenLastCalledWith(
    {origin: [-1, 1, -1], direction: [0, 0, 2]},
    2
  );
});

test('applies explicit content units and retains physical height and triangle identity', () => {
  const hit = {
    position: [10, 20, 100] as const,
    coordinate: [0, 0, 10] as const,
    normal: [0, 0, 1] as const,
    distance: 6,
    triangleIndex: 7,
    barycentric: [0.5, 0.25, 0.25] as const
  };
  const source: TerrainSurface = {projection: 'globe', intersectRay: vi.fn(() => hit)};
  const transform = new Matrix4().translate([10, 20, 30]).scale([2, 2, 3]);
  expect(pickTerrainSurface(viewport, [200, 100], source, transform)).toBe(hit);
  expect(source.intersectRay).toHaveBeenCalledWith({origin: [10, 20, 27], direction: [0, 0, 6]}, 6);
  expect(hit.coordinate[2]).toBe(10);
});

test.each([
  [99, 100],
  [300, 100],
  [200, 49],
  [200, 150],
  [NaN, 100]
])('does not query outside the owning eye at %s,%s', (horizontal, vertical) => {
  const source: TerrainSurface = {projection: 'globe', intersectRay: vi.fn(() => null)};
  expect(pickTerrainSurface(viewport, [horizontal, vertical], source, identity)).toBeNull();
  expect(source.intersectRay).not.toHaveBeenCalled();
});

test('rejects implicit or projective coordinate conversion', () => {
  const source: TerrainSurface = {projection: 'globe', intersectRay: () => null};
  expect(() => pickTerrainSurface(viewport, [200, 100], source, [1])).toThrow(/affine/);
  const matrix = new Matrix4();
  matrix[3] = 1;
  expect(() => pickTerrainSurface(viewport, [200, 100], source, matrix)).toThrow(/affine/);
});

test.each([
  0, 1, 4, 10
])('the displayed fixture and physical query agree at exaggeration %s', exaggeration => {
  const {grid, polygons, surface} = createFixtureTerrain(exaggeration);
  expect(Array.from(grid.heights)).toEqual([0, 10, 20, 30]);
  const ray = {origin: [1000, 1000, 1000] as const, direction: [0, 0, -2] as const};
  const hit = surface.intersectRay(ray);
  expect(hit?.coordinate[2]).toBe(15);
  expect(hit?.position[2]).toBe(15 * exaggeration);
  expect(hit?.distance).toBe(1000 - 15 * exaggeration);
  expect(surface.intersectRay(ray, hit!.distance - 0.01)).toBeNull();
  const triangle = polygons[hit!.triangleIndex].polygon;
  for (let axis = 0; axis < 3; axis++)
    expect(
      hit!.barycentric.reduce((value, weight, index) => value + weight * triangle[index][axis], 0)
    ).toBeCloseTo(hit!.position[axis]);
  expect(surface.intersectRay({origin: [-1, 1000, 1000], direction: [0, 0, -1]})).toBeNull();
});
