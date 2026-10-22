// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, type Color, type OrbitViewState} from '@deck.gl/core';
import {_TerrainExtension as TerrainExtension} from '@deck.gl/extensions';
import {FlameTrailLayer} from '@deck.gl-community/layers';
import {createTerrainLayer, sampleTerrainHeight} from './terrain';

// The source preview can opt into the unreleased TerrainExtension WGSL port.
const WEBGPU_TERRAIN = Boolean(import.meta.env?.DECK_GL_TERRAIN_WEBGPU);
export const TRIP_DURATION = 240;

type Trip = {path: ([number, number] | [number, number, number])[]; timestamps: number[]};
export type SceneOptions = {
  currentTime: number;
  trailLength: number;
  width: number;
  color: Color;
};

// Synthetic coordinates: no map service, personal data, or API keys.
const TRIP: Trip = {path: [], timestamps: []};
for (let i = 0; i <= 600; i++) {
  const t = (i / 600) * Math.PI * 2;
  TRIP.path.push([
    340 * Math.cos(t) + 75 * Math.sin(t * 3),
    195 * Math.sin(t) + 42 * Math.sin(t * 2 + 0.5)
  ]);
  TRIP.timestamps.push((i / 600) * TRIP_DURATION);
}
const TRIPS = [TRIP];
// Elevations are sampled once from the same mesh, never recomputed per animation frame.
const ELEVATED_TRIPS: Trip[] = [
  {...TRIP, path: TRIP.path.map(([x, y]) => [x, y, sampleTerrainHeight(x, y)])}
];
const TERRAIN_EXTENSIONS = [new TerrainExtension()];
const TERRAIN_PROPS = {
  extensions: TERRAIN_EXTENSIONS,
  terrainDrawMode: 'offset' as const,
  billboard: false
};

/** Keep two flame heads half a circuit apart, including when either trip wraps. */
export function createSceneLayers(options: SceneOptions, backend: 'webgl' | 'webgpu' = 'webgl') {
  const gpuTerrain = backend === 'webgl' || WEBGPU_TERRAIN;
  return [
    createTerrainLayer(gpuTerrain),
    ...[0, TRIP_DURATION / 2].map(
      (offset, index) =>
        new FlameTrailLayer<Trip>({
          id: `flame-trail-${index}`,
          data: gpuTerrain ? TRIPS : ELEVATED_TRIPS,
          ...(gpuTerrain ? TERRAIN_PROPS : {}),
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          getPath: d => d.path,
          getTimestamps: d => d.timestamps,
          getWidth: 1,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          currentTime: (options.currentTime + offset) % TRIP_DURATION,
          trailLength: options.trailLength,
          getColor: options.color,
          widthScale: options.width,
          parameters: {depthWriteEnabled: false}
        })
    )
  ];
}

/** Fit the terrain circuit to the example viewport. */
export function fitSceneView(width: number, height: number): OrbitViewState {
  return {
    target: [0, 0, 95],
    zoom: Math.log2(Math.max(0.1, Math.min(width / 1220, height / 840))),
    rotationX: 50,
    rotationOrbit: -30
  };
}
