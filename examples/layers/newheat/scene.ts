// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, type Color, type OrbitViewState} from '@deck.gl/core';
import {PathLayer} from '@deck.gl/layers';
import {TripsLayer} from '@deck.gl/geo-layers';
import {_TerrainExtension as TerrainExtension} from '@deck.gl/extensions';
import {NewHeatLayer} from '@deck.gl-community/layers';
import {createTerrainLayers} from './terrain';

type Trip = {path: [number, number][]; timestamps: number[]};
export type SceneOptions = {
  currentTime: number;
  flameTime: number;
  trailLength: number;
  width: number;
  fadeTrail: boolean;
  grid: boolean;
  mode: 'fire' | 'trips';
  tint: Color;
  surface: 'terrain' | 'flat';
  followSurface: boolean;
};

// Synthetic coordinates: no map service, personal data, or API keys.
const TRIP: Trip = {path: [], timestamps: []};
for (let i = 0; i <= 600; i++) {
  const t = (i / 600) * Math.PI * 2;
  TRIP.path.push([
    340 * Math.cos(t) + 75 * Math.sin(t * 3),
    195 * Math.sin(t) + 42 * Math.sin(t * 2 + 0.5)
  ]);
  TRIP.timestamps.push((i / 600) * 240);
}
const TRIPS = [TRIP];
const TERRAIN_EXTENSIONS = [new TerrainExtension()];
const TERRAIN_PROPS = {
  extensions: TERRAIN_EXTENSIONS,
  terrainDrawMode: 'offset' as const,
  billboard: false
};
const GRID = Array.from({length: 25}, (_, i) => i * 50 - 600).flatMap(value => [
  {
    path: [
      [value, -600],
      [value, 600]
    ]
  },
  {
    path: [
      [-600, value],
      [600, value]
    ]
  }
]);
const SHARED_PROPS = {
  data: TRIPS,
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  getPath: (d: Trip) => d.path,
  getTimestamps: (d: Trip) => d.timestamps,
  getWidth: 1,
  widthUnits: 'pixels' as const,
  capRounded: true,
  jointRounded: true,
  parameters: {depthWriteEnabled: false}
};

export function createSceneLayers(options: SceneOptions) {
  const LayerClass = options.mode === 'fire' ? NewHeatLayer : TripsLayer;
  const terrain = options.surface === 'terrain';
  const fitting = terrain && options.followSurface ? TERRAIN_PROPS : {};
  return [
    ...(terrain ? createTerrainLayers(options.grid) : []),
    !terrain &&
      options.grid &&
      new PathLayer({
        id: 'grid',
        data: GRID,
        getPath: d => d.path,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getColor: [38, 41, 46, 65],
        getWidth: 1,
        widthUnits: 'pixels',
        parameters: {depthWriteEnabled: false}
      }),
    new LayerClass<Trip>({
      ...SHARED_PROPS,
      ...fitting,
      id: `route-${options.mode}-${terrain && options.followSurface ? 'surface' : 'flat'}`,
      currentTime: options.currentTime,
      ...(options.mode === 'fire' && {flameTime: options.flameTime}),
      trailLength: options.trailLength,
      fadeTrail: options.fadeTrail,
      getColor: options.mode === 'fire' ? options.tint : [255, 118, 49],
      widthScale: options.width
    })
  ];
}

export function fitSceneView(
  width: number,
  height: number,
  surface: SceneOptions['surface'] = 'flat'
): OrbitViewState {
  const terrain = surface === 'terrain';
  return {
    target: [0, 0, terrain ? 95 : 35],
    zoom: Math.log2(
      Math.max(0.1, Math.min(width / (terrain ? 1220 : 1000), height / (terrain ? 840 : 620)))
    ),
    rotationX: terrain ? 50 : 42,
    rotationOrbit: terrain ? -30 : -18
  };
}
