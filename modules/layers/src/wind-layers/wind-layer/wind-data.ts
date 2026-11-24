// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import Delaunator from 'delaunator';

/**
 * A weather station in the original wind-showcase dataset.
 *
 * @remarks
 * This work-in-progress format uses positive-west `long` values. Use
 * {@link getWindBounds} or {@link createWindField} to convert those values to deck.gl
 * longitude/latitude coordinates.
 */
export type WindStation = {
  /** Human-readable station name. */
  name: string;
  /** Positive-west longitude from the historical station dataset. */
  long: number;
  /** Latitude in decimal degrees. */
  lat: number;
  /** Station elevation in meters. */
  elv: number;
  /** Optional International Civil Aviation Organization station identifier. */
  icao?: string;
  /** Optional US state name or abbreviation. */
  state?: string;
  /** Optional abbreviated station name. */
  abbr?: string;
};

/** Geographic longitude/latitude coverage for a station-interpolated wind field. */
export type WindBounds = {
  /** Westernmost geographic longitude in decimal degrees. */
  minLng: number;
  /** Southernmost latitude in decimal degrees. */
  minLat: number;
  /** Easternmost geographic longitude in decimal degrees. */
  maxLng: number;
  /** Northernmost latitude in decimal degrees. */
  maxLat: number;
};

/**
 * One station measurement: direction in eighth-turns, wind speed, and temperature.
 *
 * @remarks
 * Direction `0` points east; each subsequent unit rotates by 45 degrees.
 */
export type WindMeasurement = readonly [direction: number, speed: number, temperature: number];

/** Three indices into a wind field's station and measurement arrays. */
export type WindTriangle = readonly [first: number, second: number, third: number];

/** Optional configuration for {@link createWindField}. */
export type WindFieldOptions = {
  /** Existing station-index triangles; omit this to compute a robust Delaunay triangulation. */
  triangles?: readonly WindTriangle[];
};

/**
 * A time-varying, station-interpolated geographic wind field.
 *
 * @remarks
 * Construct this object with {@link createWindField} rather than assembling its spatial
 * index manually. The reusable wind, particle, and station-surface layers share this field.
 */
export type WindField = {
  /** Weather stations in the original positive-west coordinate format. */
  stations: readonly WindStation[];
  /** Forecast frames, each containing one measurement per station. */
  frames: readonly (readonly WindMeasurement[])[];
  /** Robust Delaunay triangles referencing {@link WindField.stations}. */
  triangles: readonly WindTriangle[];
  /** Geographic station bounds in deck.gl longitude/latitude coordinates. */
  bounds: WindBounds;
  /** Minimum and maximum nonzero observed wind speeds. */
  speedRange: readonly [number, number];
  /** Minimum and maximum nonzero observed temperatures. */
  temperatureRange: readonly [number, number];
  /** @internal Spatial lookup shared by field sampling and GPU weather rasterization. */
  spatialIndex: WindSpatialIndex;
};

/** A spatially and temporally interpolated wind observation. */
export type WindSample = {
  /** Counterclockwise wind direction in radians, measured from the east. */
  direction: number;
  /** Interpolated wind speed in the dataset's original units. */
  speed: number;
  /** Interpolated temperature in the dataset's original units. */
  temperature: number;
  /** Interpolated station elevation in meters. */
  elevation: number;
  /** Eastward and northward velocity components. */
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

/**
 * Decodes the station-major binary forecast from the historical wind showcase.
 *
 * @param buffer - Unsigned 16-bit forecast data in station-major order.
 * @param stationCount - Number of stations represented by each forecast frame.
 * @param frameCount - Number of forecast frames; the original dataset contains 72.
 * @returns Frame-major direction, speed, and temperature measurements.
 * @throws RangeError if the forecast dimensions or binary length are invalid.
 *
 * @example
 * ```ts
 * const weather = await fetch('/weather.bin').then(response => response.arrayBuffer());
 * const frames = parseWindData(weather, stations.length);
 * ```
 */
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

/**
 * Converts legacy positive-west station coordinates into geographic field bounds.
 *
 * @param stations - Historical station records.
 * @returns Western, southern, eastern, and northern geographic coverage.
 * @throws RangeError if no station is provided.
 * @throws TypeError if any station coordinate is not finite.
 */
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

/**
 * Builds a robust Delaunay triangulation of positive-west weather stations.
 *
 * @remarks
 * Duplicate coordinates are ignored. Fewer than three distinct non-collinear positions
 * produce an empty triangulation.
 *
 * @param stations - Historical station records in measurement-array order.
 * @returns Station-index triangles covering the valid station hull.
 * @throws TypeError if any station coordinate is not finite.
 */
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

/**
 * Creates the indexed, time-varying wind field shared by the reusable wind layers.
 *
 * @param stations - Weather stations using the historical positive-west format.
 * @param frames - Frame-major measurements with one observation per station.
 * @param options - Optional precomputed station triangulation.
 * @returns Geographic bounds, station triangles, observed ranges, and a spatial index.
 * @throws RangeError if fewer than three stations are supplied or a frame is misaligned.
 *
 * @example
 * ```ts
 * const frames = parseWindData(weather, stations.length);
 * const field = createWindField(stations, frames);
 * ```
 */
export function createWindField(
  stations: readonly WindStation[],
  frames: readonly (readonly WindMeasurement[])[],
  options: WindFieldOptions = {}
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

/**
 * Samples a wind field with barycentric spatial and circular temporal interpolation.
 *
 * @param field - Indexed wind field returned by {@link createWindField}.
 * @param position - Geographic `[longitude, latitude]` position.
 * @param time - Fractional forecast-frame index; values wrap in either direction.
 * @returns The interpolated observation, or `null` outside the station hull.
 *
 * @example
 * ```ts
 * const sample = sampleWindField(field, [-97, 38], 12.5);
 * console.log(sample?.velocity, sample?.elevation);
 * ```
 */
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
