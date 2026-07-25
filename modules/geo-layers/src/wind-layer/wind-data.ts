// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

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

type Circumcircle = {x: number; y: number; radiusSquared: number};
type Point = readonly [number, number];

const EPSILON = 1e-10;

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

function getCircumcircle(a: Point, b: Point, c: Point): Circumcircle | null {
  const determinant = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(determinant) < EPSILON) {
    return null;
  }
  const aSquared = a[0] * a[0] + a[1] * a[1];
  const bSquared = b[0] * b[0] + b[1] * b[1];
  const cSquared = c[0] * c[0] + c[1] * c[1];
  const x =
    (aSquared * (b[1] - c[1]) + bSquared * (c[1] - a[1]) + cSquared * (a[1] - b[1])) / determinant;
  const y =
    (aSquared * (c[0] - b[0]) + bSquared * (a[0] - c[0]) + cSquared * (b[0] - a[0])) / determinant;
  return {x, y, radiusSquared: (x - a[0]) ** 2 + (y - a[1]) ** 2};
}

/** Builds a dependency-free Delaunay triangulation of weather-station positions. */
export function triangulateWindStations(stations: readonly WindStation[]): WindTriangle[] {
  if (stations.length < 3) {
    return [];
  }

  const bounds = getWindBounds(stations);
  const centerX = (bounds.minLng + bounds.maxLng) / 2;
  const centerY = (bounds.minLat + bounds.maxLat) / 2;
  const span = Math.max(bounds.maxLng - bounds.minLng, bounds.maxLat - bounds.minLat, 1);
  const points: Point[] = stations.map(station => [-station.long, station.lat]);
  const count = points.length;
  points.push(
    [centerX - 32 * span, centerY - span],
    [centerX, centerY + 32 * span],
    [centerX + 32 * span, centerY - span]
  );

  let triangles: WindTriangle[] = [[count, count + 1, count + 2]];
  const seenPoints = new Set<string>();

  for (let pointIndex = 0; pointIndex < count; pointIndex++) {
    const point = points[pointIndex];
    const pointKey = `${point[0]},${point[1]}`;
    if (seenPoints.has(pointKey)) {
      continue;
    }
    seenPoints.add(pointKey);

    const surviving: WindTriangle[] = [];
    const boundary = new Map<string, [number, number]>();

    for (const triangle of triangles) {
      const circle = getCircumcircle(points[triangle[0]], points[triangle[1]], points[triangle[2]]);
      const inside =
        circle !== null &&
        (point[0] - circle.x) ** 2 + (point[1] - circle.y) ** 2 <= circle.radiusSquared + EPSILON;

      if (!inside) {
        surviving.push(triangle);
        continue;
      }

      for (const [start, end] of [
        [triangle[0], triangle[1]],
        [triangle[1], triangle[2]],
        [triangle[2], triangle[0]]
      ] as [number, number][]) {
        const edgeKey = start < end ? `${start}:${end}` : `${end}:${start}`;
        if (boundary.has(edgeKey)) {
          boundary.delete(edgeKey);
        } else {
          boundary.set(edgeKey, [start, end]);
        }
      }
    }

    for (const [start, end] of boundary.values()) {
      surviving.push([start, end, pointIndex]);
    }
    triangles = surviving;
  }

  return triangles.filter(triangle => triangle.every(index => index < count));
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
  a: Point,
  b: Point,
  c: Point
): [number, number, number] | null {
  const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(determinant) < EPSILON) {
    return null;
  }
  const first =
    ((b[1] - c[1]) * (position[0] - c[0]) + (c[0] - b[0]) * (position[1] - c[1])) / determinant;
  const second =
    ((c[1] - a[1]) * (position[0] - c[0]) + (a[0] - c[0]) * (position[1] - c[1])) / determinant;
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
      [-stations[triangle[0]].long, stations[triangle[0]].lat],
      [-stations[triangle[1]].long, stations[triangle[1]].lat],
      [-stations[triangle[2]].long, stations[triangle[2]].lat]
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
      const fromAngle = (from[0] * Math.PI) / 4;
      const toAngle = (to[0] * Math.PI) / 4;
      east += weight * ((1 - frameMix) * Math.cos(fromAngle) + frameMix * Math.cos(toAngle));
      north += weight * ((1 - frameMix) * Math.sin(fromAngle) + frameMix * Math.sin(toAngle));
      speed += weight * ((1 - frameMix) * from[1] + frameMix * to[1]);
      temperature += weight * ((1 - frameMix) * from[2] + frameMix * to[2]);
      elevation += weight * stations[stationIndex].elv;
    }

    if (Math.abs(east) < EPSILON && Math.abs(north) < EPSILON) {
      return null;
    }
    const direction = Math.atan2(north, east);
    return {
      direction,
      speed,
      temperature,
      elevation,
      velocity: [Math.cos(direction) * speed, Math.sin(direction) * speed]
    };
  }

  return null;
}
