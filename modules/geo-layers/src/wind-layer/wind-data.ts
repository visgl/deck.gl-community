// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import Delaunator from 'delaunator';

/** A weather station in the original deck.gl wind showcase dataset. */
export type WindStation = {
  name: string;
  long: number;
  lat: number;
  elv: number;
  icao?: string;
  state?: string;
  abbr?: string;
};

/** West, south, east, and north bounds of a geographic wind field. */
export type WindBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

/** Direction in eighth-turns, wind speed, and temperature at one station. */
export type WindMeasurement = readonly [number, number, number];

/** Three indices into a wind field's station and measurement arrays. */
export type WindTriangle = readonly [number, number, number];

/** A time-varying Delaunay-interpolated geographic vector field. */
export type WindField = {
  stations: readonly WindStation[];
  frames: readonly (readonly WindMeasurement[])[];
  triangles: readonly WindTriangle[];
  bounds: WindBounds;
  speedRange: readonly [number, number];
  temperatureRange: readonly [number, number];
  spatialIndex: WindSpatialIndex;
};

/** A sampled and temporally interpolated wind vector. */
export type WindSample = {
  direction: number;
  speed: number;
  temperature: number;
  elevation: number;
  velocity: [number, number];
};

type WindSpatialIndex = {
  columns: number;
  rows: number;
  cells: number[][];
};

type Point = readonly [number, number];

const EPSILON = 1e-10;
const WIND_DIRECTION_EAST = Float64Array.from({length: 8}, (_, index) =>
  Math.cos((index * Math.PI) / 4)
);
const WIND_DIRECTION_NORTH = Float64Array.from({length: 8}, (_, index) =>
  Math.sin((index * Math.PI) / 4)
);

/** Parses the station-major, 72-hour binary format used by the original wind showcase. */
export function parseWindData(
  buffer: ArrayBuffer,
  stationCount: number,
  frameCount = 72
): WindMeasurement[][] {
  if (stationCount <= 0 || frameCount <= 0) {
    throw new RangeError('Wind data requires a positive station and frame count.');
  }
  if (buffer.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
    throw new RangeError('Wind data must contain complete unsigned 16-bit measurements.');
  }

  const values = new Uint16Array(buffer);
  const expectedLength = stationCount * frameCount * 3;
  if (values.length !== expectedLength) {
    throw new RangeError(
      `Expected ${expectedLength} wind measurements, but received ${values.length}.`
    );
  }

  return Array.from({length: frameCount}, (_, frameIndex) =>
    Array.from({length: stationCount}, (_, stationIndex) => {
      const offset = (stationIndex * frameCount + frameIndex) * 3;
      return [values[offset], values[offset + 1], values[offset + 2]];
    })
  );
}

/** Calculates geographic bounds for stations whose legacy longitudes are positive-west. */
export function getWindBounds(stations: readonly WindStation[]): WindBounds {
  if (stations.length === 0) {
    throw new RangeError('A wind field requires at least one station.');
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const station of stations) {
    const longitude = station.long === 0 ? 0 : -station.long;
    if (!Number.isFinite(longitude) || !Number.isFinite(station.lat)) {
      throw new TypeError('Wind station coordinates must be finite numbers.');
    }
    minLng = Math.min(minLng, longitude);
    minLat = Math.min(minLat, station.lat);
    maxLng = Math.max(maxLng, longitude);
    maxLat = Math.max(maxLat, station.lat);
  }

  return {minLng, minLat, maxLng, maxLat};
}

/** Builds a robust Delaunay triangulation of positive-west weather-station positions. */
export function triangulateWindStations(stations: readonly WindStation[]): WindTriangle[] {
  if (stations.length < 3) {
    return [];
  }

  getWindBounds(stations);
  const {triangles} = Delaunator.from(
    Array.from(stations),
    station => -station.long,
    station => station.lat
  );

  return Array.from({length: triangles.length / 3}, (_, index) => {
    const offset = index * 3;
    return [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
  });
}

function getRange(
  frames: readonly (readonly WindMeasurement[])[],
  component: 1 | 2
): [number, number] {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const frame of frames) {
    for (const measurement of frame) {
      if (measurement[component] !== 0) {
        minimum = Math.min(minimum, measurement[component]);
        maximum = Math.max(maximum, measurement[component]);
      }
    }
  }
  return Number.isFinite(minimum) ? [minimum, maximum] : [0, 0];
}

function createSpatialIndex(
  stations: readonly WindStation[],
  triangles: readonly WindTriangle[],
  bounds: WindBounds
): WindSpatialIndex {
  const columns = 48;
  const rows = 24;
  const cells = Array.from({length: columns * rows}, () => [] as number[]);
  const longitudeSpan = Math.max(bounds.maxLng - bounds.minLng, EPSILON);
  const latitudeSpan = Math.max(bounds.maxLat - bounds.minLat, EPSILON);

  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) {
    const vertices = triangles[triangleIndex].map(index => stations[index]);
    const west = Math.min(...vertices.map(station => -station.long));
    const east = Math.max(...vertices.map(station => -station.long));
    const south = Math.min(...vertices.map(station => station.lat));
    const north = Math.max(...vertices.map(station => station.lat));
    const minColumn = Math.max(0, Math.floor(((west - bounds.minLng) / longitudeSpan) * columns));
    const maxColumn = Math.min(
      columns - 1,
      Math.floor(((east - bounds.minLng) / longitudeSpan) * columns)
    );
    const minRow = Math.max(0, Math.floor(((south - bounds.minLat) / latitudeSpan) * rows));
    const maxRow = Math.min(rows - 1, Math.floor(((north - bounds.minLat) / latitudeSpan) * rows));

    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        cells[row * columns + column].push(triangleIndex);
      }
    }
  }

  return {columns, rows, cells};
}

/** Creates the shared, indexed wind field consumed by all wind showcase layers. */
export function createWindField(
  stations: readonly WindStation[],
  frames: readonly (readonly WindMeasurement[])[],
  options: {triangles?: readonly WindTriangle[]} = {}
): WindField {
  if (stations.length < 3) {
    throw new RangeError('A wind field requires at least three stations.');
  }
  if (frames.length === 0 || frames.some(frame => frame.length !== stations.length)) {
    throw new RangeError('Each wind frame must contain one measurement for every station.');
  }

  const bounds = getWindBounds(stations);
  const triangles = options.triangles ?? triangulateWindStations(stations);
  return {
    stations,
    frames,
    triangles,
    bounds,
    speedRange: getRange(frames, 1),
    temperatureRange: getRange(frames, 2),
    spatialIndex: createSpatialIndex(stations, triangles, bounds)
  };
}

function getBarycentricWeights(
  position: Point,
  a: WindStation,
  b: WindStation,
  c: WindStation
): [number, number, number] | null {
  const ax = -a.long;
  const ay = a.lat;
  const bx = -b.long;
  const by = b.lat;
  const cx = -c.long;
  const cy = c.lat;
  const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(determinant) < EPSILON) {
    return null;
  }
  const first = ((by - cy) * (position[0] - cx) + (cx - bx) * (position[1] - cy)) / determinant;
  const second = ((cy - ay) * (position[0] - cx) + (ax - cx) * (position[1] - cy)) / determinant;
  const third = 1 - first - second;
  return first >= -EPSILON && second >= -EPSILON && third >= -EPSILON
    ? [first, second, third]
    : null;
}

/** Samples the wind field using spatial Delaunay and circular temporal interpolation. */
export function sampleWindField(field: WindField, position: Point, time = 0): WindSample | null {
  const {bounds, spatialIndex, triangles, stations, frames} = field;
  if (
    position[0] < bounds.minLng ||
    position[0] > bounds.maxLng ||
    position[1] < bounds.minLat ||
    position[1] > bounds.maxLat
  ) {
    return null;
  }

  const column = Math.min(
    spatialIndex.columns - 1,
    Math.max(
      0,
      Math.floor(
        ((position[0] - bounds.minLng) / Math.max(bounds.maxLng - bounds.minLng, EPSILON)) *
          spatialIndex.columns
      )
    )
  );
  const row = Math.min(
    spatialIndex.rows - 1,
    Math.max(
      0,
      Math.floor(
        ((position[1] - bounds.minLat) / Math.max(bounds.maxLat - bounds.minLat, EPSILON)) *
          spatialIndex.rows
      )
    )
  );
  const wrappedTime = ((time % frames.length) + frames.length) % frames.length;
  const frameIndex = Math.floor(wrappedTime);
  const nextFrameIndex = (frameIndex + 1) % frames.length;
  const frameMix = wrappedTime - frameIndex;

  for (const triangleIndex of spatialIndex.cells[row * spatialIndex.columns + column]) {
    const triangle = triangles[triangleIndex];
    const weights = getBarycentricWeights(
      position,
      stations[triangle[0]],
      stations[triangle[1]],
      stations[triangle[2]]
    );
    if (!weights) {
      continue;
    }

    let east = 0;
    let north = 0;
    let speed = 0;
    let temperature = 0;
    let elevation = 0;

    for (let vertex = 0; vertex < 3; vertex++) {
      const stationIndex = triangle[vertex];
      const from = frames[frameIndex][stationIndex];
      const to = frames[nextFrameIndex][stationIndex];
      const weight = weights[vertex];
      const fromDirection = from[0] % WIND_DIRECTION_EAST.length;
      const toDirection = to[0] % WIND_DIRECTION_EAST.length;
      east +=
        weight *
        ((1 - frameMix) * WIND_DIRECTION_EAST[fromDirection] +
          frameMix * WIND_DIRECTION_EAST[toDirection]);
      north +=
        weight *
        ((1 - frameMix) * WIND_DIRECTION_NORTH[fromDirection] +
          frameMix * WIND_DIRECTION_NORTH[toDirection]);
      speed += weight * ((1 - frameMix) * from[1] + frameMix * to[1]);
      temperature += weight * ((1 - frameMix) * from[2] + frameMix * to[2]);
      elevation += weight * stations[stationIndex].elv;
    }

    if (Math.abs(east) < EPSILON && Math.abs(north) < EPSILON) {
      return null;
    }
    const direction = Math.atan2(north, east);
    const directionLength = Math.hypot(east, north);
    return {
      direction,
      speed,
      temperature,
      elevation,
      velocity: [(east / directionLength) * speed, (north / directionLength) * speed]
    };
  }

  return null;
}
