// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  _GlobeView as GlobeView,
  FirstPersonView,
  MapView,
  type Color,
  type FirstPersonViewState,
  type GlobeViewState,
  type MapViewState
} from '@deck.gl/core';
import {PathLayer, PolygonLayer} from '@deck.gl/layers';

export type ViewMode = 'map' | 'globe' | 'first-person';
export type ExampleView = MapView | GlobeView | FirstPersonView;
export type CameraState = (MapViewState | GlobeViewState | FirstPersonViewState) & {
  bearing?: number;
  exampleView?: ViewMode;
};

type Position = [longitude: number, latitude: number, altitude: number];
export type Target = {position: Position; label: string; color: Color};

const LONGITUDE = -122.42;
const LATITUDE = 37.77;
const RADIANS_PER_DEGREE = Math.PI / 180;
const METERS_PER_DEGREE = 111_320;
const COLORS: Color[] = [
  [111, 221, 255],
  [255, 191, 114],
  [142, 230, 169],
  [255, 151, 201],
  [188, 172, 255]
];

export const VIEWS = {
  map: new MapView({id: 'map', controller: true}),
  globe: new GlobeView({id: 'globe', controller: true}),
  'first-person': new FirstPersonView({id: 'first-person', controller: true, far: 5_000})
};

export const INITIAL_CAMERAS: Record<ViewMode, CameraState> = {
  map: {longitude: LONGITUDE, latitude: LATITUDE, zoom: 13, pitch: 50},
  globe: {longitude: 0, latitude: 20, zoom: 1.2, maxZoom: 12},
  'first-person': {longitude: LONGITUDE, latitude: LATITUDE, position: [0, 0, 30]}
};

function offsetPosition(
  longitude: number,
  latitude: number,
  east: number,
  north: number,
  altitude: number
): Position {
  return [
    longitude + east / (METERS_PER_DEGREE * Math.cos(latitude * RADIANS_PER_DEGREE)),
    latitude + north / METERS_PER_DEGREE,
    altitude
  ];
}

function orbitGlobe(angle: number, radius: number, altitude: number): Position {
  const centerLatitude = INITIAL_CAMERAS.globe.latitude * RADIANS_PER_DEGREE;
  const sinLatitude = Math.sin(centerLatitude);
  const cosLatitude = Math.cos(centerLatitude);
  const latitude = Math.asin(
    sinLatitude * Math.cos(radius) + cosLatitude * Math.sin(radius) * Math.cos(angle)
  );
  const longitude = Math.atan2(
    Math.sin(angle) * Math.sin(radius) * cosLatitude,
    Math.cos(radius) - sinLatitude * Math.sin(latitude)
  );
  return [longitude / RADIANS_PER_DEGREE, latitude / RADIANS_PER_DEGREE, altitude];
}

export function createTargets(mode: ViewMode, camera: CameraState, count: number, seconds: number) {
  const firstPerson = mode === 'first-person';
  const [east, north, elevation] = firstPerson ? (camera.position ?? [0, 0, 30]) : [0, 0, 0];
  return Array.from({length: count}, (_, index): Target => {
    const radiusFactor = ((index * 0.75487766625) % 1) ** 2;
    const heightFactor = (index * 0.41421356237) % 1;
    const angle = index * 2.39996323 + seconds * (0.04 + (index % 11) * 0.012);
    const radius = firstPerson ? 70 + radiusFactor * 1_880 : 120 + radiusFactor * 24_000;
    const altitude = firstPerson
      ? Math.max(0, elevation + heightFactor * 170 - 35)
      : heightFactor * 1_600;
    const position =
      mode === 'globe'
        ? orbitGlobe(
            angle,
            0.06 + radiusFactor * 3.03,
            index % 3 ? 0 : 500_000 + heightFactor * 2_500_000
          )
        : offsetPosition(
            // Map targets circle a fixed point, so a pan can bring them into view.
            firstPerson ? (camera.longitude ?? LONGITUDE) : LONGITUDE,
            firstPerson ? (camera.latitude ?? LATITUDE) : LATITUDE,
            east + Math.cos(angle) * radius,
            north + Math.sin(angle) * radius,
            altitude
          );
    return {
      position,
      label: `T-${String(index + 1).padStart(3, '0')}`,
      color: COLORS[index % COLORS.length]
    };
  });
}

function createMapGrid(): Position[][] {
  const paths: Position[][] = [];
  for (let i = -20; i <= 20; i++) {
    const offset = i / 100;
    paths.push(
      [
        [LONGITUDE + offset, LATITUDE - 0.2, 0],
        [LONGITUDE + offset, LATITUDE + 0.2, 0]
      ],
      [
        [LONGITUDE - 0.2, LATITUDE + offset, 0],
        [LONGITUDE + 0.2, LATITUDE + offset, 0]
      ]
    );
  }
  return paths;
}

function createGroundGrid(): Position[][] {
  const paths: Position[][] = [];
  const point = (east: number, north: number) =>
    offsetPosition(LONGITUDE, LATITUDE, east, north, 0);
  for (let offset = -2_000; offset <= 2_000; offset += 50) {
    paths.push(
      [point(offset, -2_000), point(offset, 2_000)],
      [point(-2_000, offset), point(2_000, offset)]
    );
  }
  return paths;
}

function createGlobeGrid(): Position[][] {
  const paths: Position[][] = [];
  for (let longitude = -180; longitude < 180; longitude += 10) {
    paths.push(Array.from({length: 91}, (_, i) => [longitude, -90 + 2 * i, 1_000]));
  }
  for (let latitude = -80; latitude <= 80; latitude += 10) {
    paths.push(Array.from({length: 181}, (_, i) => [-180 + 2 * i, latitude, 1_000]));
  }
  return paths;
}

function createGlobeSurface(): Position[][] {
  const polygons: Position[][] = [];
  const step = 5;
  // Small faces follow the globe curvature across the longitude seam.
  for (let longitude = -180; longitude < 180; longitude += step) {
    for (let latitude = -85; latitude < 85; latitude += step) {
      polygons.push([
        [longitude, latitude, 0],
        [longitude + step, latitude, 0],
        [longitude + step, latitude + step, 0],
        [longitude, latitude + step, 0]
      ]);
    }
  }
  return polygons;
}

const CREATE_GRID = {map: createMapGrid, globe: createGlobeGrid, 'first-person': createGroundGrid};

export function createContextLayers(view: ViewMode) {
  const grid = new PathLayer<Position[]>({
    id: `${view}-grid`,
    data: CREATE_GRID[view](),
    coordinateSystem: 'lnglat',
    getPath: path => path,
    getColor: [75, 111, 147, 150],
    widthUnits: 'pixels',
    getWidth: 1
  });
  if (view !== 'globe') return [grid];

  const surface = new PolygonLayer<Position[]>({
    id: 'globe-surface',
    data: createGlobeSurface(),
    getPolygon: polygon => polygon,
    getFillColor: [19, 31, 48],
    stroked: false
  });
  return [surface, grid];
}
