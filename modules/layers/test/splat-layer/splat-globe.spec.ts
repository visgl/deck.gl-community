// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {_GlobeViewport as GlobeViewport, WebMercatorViewport} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';
import {getSplatCommonUnits} from '../../src/splat-layer/splat-culling';
import {
  classifySplatHorizon,
  getSplatHorizon,
  getSplatTangentFrame,
  offsetSplatCommonPosition
} from '../../src/splat-layer/splat-globe';
import {
  createSplatSpatialIndex,
  querySplatSpatialIndex
} from '../../src/splat-layer/splat-spatial-index';

// deck.gl's GlobeViewport sphere.
const EARTH_RADIUS = 6370972;
const GLOBE_RADIUS = 256;
const DEGREES = 180 / Math.PI;
const LATITUDES = [0, 27, -45, 70, -85, 89.99, -89.99];
const LONGITUDES = [-170, -81, 0, 135];

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: number[]) => a.map(value => value / Math.hypot(...a));
const subtract = (a: number[], b: number[]) => a.map((value, i) => value - b[i]);
const column = (frame: number[], axis: number) => frame.slice(axis * 3, axis * 3 + 3);

/** Geographic point `east`, `north` metres along the surface and `up` metres above lng/lat. */
function moveSplatPosition([longitude, latitude]: number[], [east, north, up]: number[]) {
  return [
    longitude + (east / (EARTH_RADIUS * Math.cos(latitude / DEGREES))) * DEGREES,
    latitude + (north / EARTH_RADIUS) * DEGREES,
    up
  ];
}

/** A port of the GLSL `splatBehindGlobe`. */
function isSplatBehindGlobe(position: number[], camera: number[]): boolean {
  const ray = subtract(camera, position);
  const along = dot(position, ray);
  const rayLength = dot(ray, ray);
  if (along >= 0 || -along >= rayLength) return false;
  return dot(position, position) - (along * along) / rayLength < GLOBE_RADIUS * GLOBE_RADIUS;
}

/** A port of the vertex shader's screen covariance, in pixels with y up. */
function projectSplatCovariance(
  viewport: GlobeViewport,
  common: number[],
  axes: number[][]
): number[] {
  const m = viewport.viewProjectionMatrix;
  const clip = [0, 1, 2, 3].map(
    row => m[row] * common[0] + m[row + 4] * common[1] + m[row + 8] * common[2] + m[row + 12]
  );
  const rowW = [m[3], m[7], m[11]];
  const rowX = [m[0], m[4], m[8]].map(
    (value, i) => ((value - (rowW[i] * clip[0]) / clip[3]) * viewport.width) / (2 * clip[3])
  );
  const rowY = [m[1], m[5], m[9]].map(
    (value, i) => ((value - (rowW[i] * clip[1]) / clip[3]) * viewport.height) / (2 * clip[3])
  );
  let a = 0,
    b = 0,
    c = 0;
  for (const axis of axes) {
    const x = dot(rowX, axis),
      y = dot(rowY, axis);
    a += x * x;
    b += x * y;
    c += y * y;
  }
  return [a, b, c];
}

describe('globe tangent frames', () => {
  it('points owner metres east, north and up of every globe anchor, including near the poles', () => {
    for (const latitude of [...LATITUDES, 90, -90])
      for (const longitude of LONGITUDES) {
        const viewport = new GlobeViewport({width: 512, height: 512, longitude, latitude, zoom: 3});
        const common = viewport.projectPosition([longitude, latitude, 0]);
        const frame = getSplatTangentFrame(common, viewport)!;
        const [east, north, up] = [0, 1, 2].map(axis => column(frame, axis));
        // A right-handed rotation: wood, crops and every covariance keep their handedness.
        for (const [a, b, expected] of [
          [east, east, 1],
          [north, north, 1],
          [up, up, 1],
          [east, north, 0],
          [north, up, 0],
          [up, east, 0]
        ] as const)
          expect(dot(a, b)).toBeCloseTo(expected, 12);
        const cross = [
          east[1] * north[2] - east[2] * north[1],
          east[2] * north[0] - east[0] * north[2],
          east[0] * north[1] - east[1] * north[0]
        ];
        expect(dot(cross, up)).toBeCloseTo(1, 12);
        expect(dot(up, normalize(common))).toBeCloseTo(1, 12);
        if (Math.abs(latitude) === 90) continue;
        // Agree with deck.gl's own globe projection one metre away.
        for (const [axis, offset] of [
          [east, [1, 0, 0]],
          [north, [0, 1, 0]],
          [up, [0, 0, 1]]
        ] as const) {
          const moved = viewport.projectPosition(moveSplatPosition([longitude, latitude], offset));
          expect(dot(axis, normalize(subtract(moved, common)))).toBeCloseTo(1, 6);
        }
      }
  });

  it('offsets owner centers along the anchor frame and keeps planar views unrotated', () => {
    // Away from the poles, where a parallel bends away from the tangent plane within metres.
    for (const latitude of [0, 27, -45, 70, -85])
      for (const longitude of LONGITUDES) {
        const viewport = new GlobeViewport({width: 512, height: 512, longitude, latitude, zoom: 3});
        const common = viewport.projectPosition([longitude, latitude, 0]);
        const units = getSplatCommonUnits(common, viewport);
        const offset = [12, -8, 3.5];
        const center = offsetSplatCommonPosition(
          common,
          offset,
          units,
          getSplatTangentFrame(common, viewport)
        );
        const expected = viewport.projectPosition(moveSplatPosition([longitude, latitude], offset));
        // A tangent-plane step leaves the parallel by offset^2 / (2 R cos(latitude)).
        expect(Math.hypot(...subtract(center, expected)) / units[0]).toBeLessThan(1e-3);
      }
    const mercator = new WebMercatorViewport({width: 512, height: 512, latitude: 40, zoom: 14});
    const common = mercator.projectPosition([0, 40, 0]);
    const units = getSplatCommonUnits(common, mercator);
    expect(getSplatTangentFrame(common, mercator)).toBeNull();
    expect(offsetSplatCommonPosition(common, [3, 4, 5], units, null)).toEqual(
      common.map((value, axis) => value + [3, 4, 5][axis] * units[axis])
    );
  });

  it("projects tangent-frame covariance through the globe's screen Jacobian", () => {
    // East 40 km, north 8 km, up 20 km, sheared by a 30 degree yaw.
    const yaw = Math.PI / 6;
    const local = [
      [40000 * Math.cos(yaw), 40000 * Math.sin(yaw), 0],
      [-8000 * Math.sin(yaw), 8000 * Math.cos(yaw), 0],
      [0, 0, 20000]
    ];
    for (const latitude of [0, 27, -45, 70, -85, 89])
      for (const [pitch, bearing] of [
        [0, 0],
        [40, 30],
        [55, -120]
      ]) {
        const longitude = 31;
        const viewport = new GlobeViewport({
          width: 800,
          height: 600,
          longitude,
          latitude,
          zoom: 6,
          pitch,
          bearing
        });
        const common = viewport.projectPosition([longitude, latitude, 0]);
        const units = getSplatCommonUnits(common, viewport);
        const frame = getSplatTangentFrame(common, viewport)!;
        const axes = local.map(axis =>
          [0, 1, 2].map(
            row =>
              (frame[row] * axis[0] + frame[row + 3] * axis[1] + frame[row + 6] * axis[2]) *
              units[0]
          )
        );
        const [a, b, c] = projectSplatCovariance(viewport, common, axes);
        // Finite differences of deck.gl's own lng/lat projection, along each local metre axis.
        const step = 10;
        const jacobian = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1]
        ].map(direction => {
          const [x0, y0] = viewport.project(
            moveSplatPosition(
              [longitude, latitude],
              direction.map(value => -value * step)
            )
          );
          const [x1, y1] = viewport.project(
            moveSplatPosition(
              [longitude, latitude],
              direction.map(value => value * step)
            )
          );
          // Screen y grows downward; clip-space y grows upward.
          return [(x1 - x0) / (2 * step), -(y1 - y0) / (2 * step)];
        });
        let expectedA = 0,
          expectedB = 0,
          expectedC = 0;
        for (const axis of local) {
          const x = jacobian.reduce((sum, derivative, i) => sum + derivative[0] * axis[i], 0);
          const y = jacobian.reduce((sum, derivative, i) => sum + derivative[1] * axis[i], 0);
          expectedA += x * x;
          expectedB += x * y;
          expectedC += y * y;
        }
        const scale = Math.max(expectedA, expectedC);
        expect(Math.abs(a - expectedA) / scale).toBeLessThan(1e-4);
        expect(Math.abs(b - expectedB) / scale).toBeLessThan(1e-4);
        expect(Math.abs(c - expectedC) / scale).toBeLessThan(1e-4);
      }
  });
});

describe('globe horizon culling', () => {
  it("matches deck.gl's ray/globe intersection for every surface point", () => {
    for (const [longitude, latitude, zoom, pitch] of [
      [10, 20, 1.5, 0],
      [-60, -35, 3, 50],
      [120, 80, 2, 30]
    ]) {
      const viewport = new GlobeViewport({
        width: 640,
        height: 480,
        longitude,
        latitude,
        zoom,
        pitch
      });
      const horizon = getSplatHorizon(viewport)!;
      let visible = 0,
        hidden = 0;
      for (let lat = -88; lat <= 88; lat += 4)
        for (let lng = -180; lng < 180; lng += 6) {
          const position = viewport.projectPosition([lng, lat, 0]);
          const [x, y] = viewport.project([lng, lat, 0]);
          if (!(x > 0 && x < viewport.width && y > 0 && y < viewport.height)) continue;
          // The first surface hit along this pixel's ray is the point itself unless it is hidden.
          const hit = viewport.projectPosition(viewport.unproject([x, y], {targetZ: 0}));
          const front = Math.hypot(...subtract(hit, position)) < 1e-6;
          const angle = Math.acos(dot(normalize(position), normalize(horizon.camera)));
          // deck.gl's unproject is ill-conditioned at the limb.
          if (Math.abs(angle - horizon.angle) < 1e-3) continue;
          expect(classifySplatHorizon(position, 0, horizon)).toBe(front ? 1 : -1);
          expect(isSplatBehindGlobe(position, horizon.camera)).toBe(!front);
          if (front) visible++;
          else hidden++;
        }
      expect(visible).toBeGreaterThan(20);
      expect(hidden).toBeGreaterThan(20);
    }
  });

  it('keeps elevated owners visible over the sea-level horizon and bounds whole spheres', () => {
    const viewport = new GlobeViewport({width: 512, height: 512, longitude: 0, latitude: 0});
    const horizon = getSplatHorizon(viewport)!;
    expect(getSplatHorizon(new WebMercatorViewport({width: 512, height: 512}))).toBeNull();
    // A summit 300 km up stays visible a little past the camera's sea-level horizon.
    const lift = Math.acos(GLOBE_RADIUS / (GLOBE_RADIUS * (1 + 300000 / EARTH_RADIUS)));
    for (const [angle, height, expected] of [
      [horizon.angle - 0.01, 0, 1],
      [horizon.angle + 0.01, 0, -1],
      [horizon.angle + lift - 0.01, 300000, 1],
      [horizon.angle + lift + 0.01, 300000, -1]
    ] as const) {
      // Sweep away from the camera, which is above longitude 0 and the equator.
      const position = viewport.projectPosition([angle * DEGREES, 0, height]);
      expect(classifySplatHorizon(position, 0, horizon)).toBe(expected);
      expect(isSplatBehindGlobe(position, horizon.camera)).toBe(expected < 0);
    }
    // A sphere is hidden only when every point in it is, and fully visible only when all are.
    const units = GLOBE_RADIUS / EARTH_RADIUS;
    for (let angle = 0; angle < Math.PI; angle += 0.02) {
      const center = viewport.projectPosition([angle * DEGREES, 3, 20000]);
      const radius = 150000 * units;
      const side = classifySplatHorizon(center, radius, horizon);
      const samples = Array.from({length: 200}, (_, i) => {
        const direction = normalize([Math.sin(i * 2.4), Math.cos(i * 1.7), Math.sin(i * 0.9)]);
        const scale = ((i % 7) + 1) / 7;
        return center.map((value, axis) => value + direction[axis] * radius * scale);
      });
      const behind = samples.map(point => isSplatBehindGlobe(point, horizon.camera));
      if (side < 0) expect(behind.every(Boolean)).toBe(true);
      if (side > 0) expect(behind.some(Boolean)).toBe(false);
    }
  });

  it('omits far-side owners from the spatial query, including inside collected branches', () => {
    const viewport = new GlobeViewport({
      width: 512,
      height: 512,
      longitude: 20,
      latitude: 10,
      zoom: 0.5
    });
    const horizon = getSplatHorizon(viewport)!;
    const radius = (20000 * GLOBE_RADIUS) / EARTH_RADIUS;
    const entries: {center: number[]; radius: number; value: number}[] = [];
    for (let lat = -80; lat <= 80; lat += 5)
      for (let lng = -180; lng < 180; lng += 5)
        entries.push({
          center: viewport.projectPosition([lng, lat, 0]),
          radius,
          value: entries.length
        });
    const projection = {
      matrix: viewport.viewProjectionMatrix,
      center: [0, 0, 0, 0],
      width: viewport.width,
      height: viewport.height
    };
    const all = querySplatSpatialIndex(createSplatSpatialIndex(entries), [projection]);
    const visible = new Set(
      querySplatSpatialIndex(createSplatSpatialIndex(entries), [{...projection, horizon}])
    );
    // Without the horizon the whole globe lies inside the frustum.
    expect(all).toHaveLength(entries.length);
    expect(visible.size).toBeGreaterThan(entries.length * 0.25);
    expect(visible.size).toBeLessThan(entries.length * 0.6);
    for (const entry of entries)
      expect(visible.has(entry.value)).toBe(
        classifySplatHorizon(entry.center, radius, horizon) >= 0
      );
  });
});
