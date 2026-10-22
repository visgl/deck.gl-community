// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {worldToLngLat} from '@math.gl/web-mercator';
import type {TerrainSurface} from '@deck.gl-community/geo-layers';

/** Same north-first physical grid convention as loaders.gl and Tangram; no network or provider. */
export const terrainGrid = {
  width: 2,
  height: 2,
  heights: new Float32Array([0, 10, 20, 30]),
  valid: new Uint8Array([1, 1, 1, 1]),
  bounds: [0, 0, 2000, 2000] as const,
  registration: 'grid-node' as const,
  verticalDatum: 'unknown' as const
};

/**
 * Two planar triangles are an analytic contract fixture, not a production terrain mesher/index.
 * The very same plane supplies the drawn vertices and ray hits; source heights stay physical.
 */
export function createFixtureTerrain(exaggeration: number) {
  if (!Number.isFinite(exaggeration) || exaggeration < 0 || exaggeration > 10)
    throw new RangeError('Invalid fixture exaggeration');
  const vertices = [
    [0, 2000],
    [2000, 2000],
    [0, 0],
    [2000, 0]
  ].map(([horizontal, vertical], index) => [
    horizontal,
    vertical,
    terrainGrid.heights[index] * exaggeration
  ]);
  const polygons = [
    [2, 3, 0],
    [3, 1, 0]
  ].map(indices => ({polygon: indices.map(index => vertices[index])}));
  // Source height is 20 + x/200 - y/100 throughout both triangles.
  const surface: TerrainSurface = {
    projection: 'web-mercator',
    intersectRay({origin, direction}, maxDistance = Infinity) {
      const denominator = direction[2] - exaggeration * (direction[0] / 200 - direction[1] / 100);
      if (denominator === 0) return null;
      const parameter =
        (exaggeration * (20 + origin[0] / 200 - origin[1] / 100) - origin[2]) / denominator;
      const distance = parameter * Math.hypot(...direction);
      if (!Number.isFinite(distance) || distance < 0 || distance > maxDistance) return null;
      const position: [number, number, number] = [
        origin[0] + parameter * direction[0],
        origin[1] + parameter * direction[1],
        origin[2] + parameter * direction[2]
      ];
      if (position[0] < 0 || position[0] > 2000 || position[1] < 0 || position[1] > 2000)
        return null;
      const horizontal = position[0] / 2000,
        vertical = position[1] / 2000;
      const first = horizontal + vertical <= 1;
      const circumference = 2 * Math.PI * 6378137;
      const coordinate = worldToLngLat([
        256 + (position[0] / circumference) * 512,
        256 + (position[1] / circumference) * 512
      ]);
      const normalLength = Math.hypot(-exaggeration / 200, exaggeration / 100, 1);
      return {
        position,
        coordinate: [coordinate[0], coordinate[1], 20 + position[0] / 200 - position[1] / 100],
        distance,
        normal: [
          -exaggeration / 200 / normalLength,
          exaggeration / 100 / normalLength,
          1 / normalLength
        ],
        triangleIndex: first ? 0 : 1,
        barycentric: first
          ? [1 - horizontal - vertical, horizontal, vertical]
          : [1 - vertical, horizontal + vertical - 1, 1 - horizontal]
      };
    }
  };
  return {grid: terrainGrid, polygons, surface};
}
