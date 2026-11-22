// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  FirstPersonViewport,
  WebMercatorViewport,
  _GlobeViewport as GlobeViewport,
  type Viewport
} from '@deck.gl/core';
import {
  computeEdgeMarkers,
  DEFAULT_EDGE_MARKER_OPTIONS,
  EdgeMarkerState,
  isBeyondHorizon,
  type EdgeMarkerOptions
} from '../../src/edge-marker-layer/compute-edge-markers';

const WIDTH = 800;
const HEIGHT = 600;
const MARGIN = 30;
const OPTIONS: EdgeMarkerOptions = {
  ...DEFAULT_EDGE_MARKER_OPTIONS,
  margins: {top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN}
};

const VIEWPORTS: Record<string, () => Viewport> = {
  map: () =>
    new WebMercatorViewport({
      width: WIDTH,
      height: HEIGHT,
      longitude: -122.4,
      latitude: 37.8,
      zoom: 12,
      pitch: 60,
      bearing: 30
    }),
  globe: () =>
    new GlobeViewport({width: WIDTH, height: HEIGHT, longitude: 10, latitude: 40, zoom: 1.5}),
  'first-person': () =>
    new FirstPersonViewport({
      width: WIDTH,
      height: HEIGHT,
      longitude: -122.4,
      latitude: 37.8,
      position: [0, 0, 120],
      pitch: -10,
      bearing: 45
    })
};

/** Deterministic pseudo-random numbers in [0, 1). */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** `count` targets in all directions around the camera, at 0.2x to 5x the focal distance. */
function makeTargetsAroundCamera(viewport: Viewport, count: number, seed = 1): Float64Array {
  const random = makeRandom(seed);
  const camera = viewport.cameraPosition;
  const center = viewport.center;
  // First-person viewports have the focal point at the camera: use 200 m there.
  const focal = Math.max(
    Math.hypot(center[0] - camera[0], center[1] - camera[1], (center[2] || 0) - camera[2]),
    200 * viewport.distanceScales.unitsPerMeter[0]
  );
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform direction on the sphere.
    const z = random() * 2 - 1;
    const phi = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const distance = focal * (0.2 + random() * 4.8);
    const common = [
      camera[0] + r * Math.cos(phi) * distance,
      camera[1] + r * Math.sin(phi) * distance,
      camera[2] + z * distance
    ];
    const world = viewport.unprojectPosition(common);
    out.set([world[0], world[1], world[2]], i * 3);
  }
  return out;
}

function getWorld(positions: Float64Array, i: number): number[] {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

/** Oracle: screen bearing from camera-space coordinates (no projection, no divide). */
function getCameraSpaceBearing(viewport: Viewport, world: number[]): number {
  const p = viewport.projectPosition(world);
  const v = viewport.viewMatrix;
  const x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
  const y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
  // View space is y-up; the marker angle is counterclockwise on screen from +x.
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function getCameraSpaceZ(viewport: Viewport, world: number[]): number {
  const p = viewport.projectPosition(world);
  const v = viewport.viewMatrix;
  return v[2] * p[0] + v[6] * p[1] + v[10] * p[2] + v[14];
}

function angleDifference(a: number, b: number): number {
  const d = Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  return d;
}

describe.each(Object.keys(VIEWPORTS))('computeEdgeMarkers in the %s view', name => {
  const viewport = VIEWPORTS[name]();
  const count = 1000;
  const targets = makeTargetsAroundCamera(viewport, count);
  const frame = computeEdgeMarkers(viewport, targets, count, OPTIONS);

  it('produces every state that the view can have', () => {
    const states = new Set(Array.from(frame.states.subarray(0, count)));
    expect(states.has(EdgeMarkerState.ON_SCREEN)).toBe(true);
    expect(states.has(EdgeMarkerState.OFF_SCREEN)).toBe(true);
    expect(states.has(EdgeMarkerState.BEHIND_CAMERA)).toBe(true);
    expect(states.has(EdgeMarkerState.BEYOND_HORIZON)).toBe(name === 'globe');
  });

  it('puts the principal point at the viewport center', () => {
    expect(frame.principalPoint[0]).toBeCloseTo(WIDTH / 2, 3);
    expect(frame.principalPoint[1]).toBeCloseTo(HEIGHT / 2, 3);
    const anchor = viewport.project(frame.anchor);
    expect(anchor[0]).toBeCloseTo(WIDTH / 2, 3);
    expect(anchor[1]).toBeCloseTo(HEIGHT / 2, 3);
    // In front of the camera.
    expect(getCameraSpaceZ(viewport, frame.anchor)).toBeLessThan(0);
  });

  it('keeps 100% of the docked markers inside the margins', () => {
    let docked = 0;
    for (let i = 0; i < count; i++) {
      if (frame.states[i] <= EdgeMarkerState.ON_SCREEN) continue;
      docked++;
      const x = frame.positions[i * 2];
      const y = frame.positions[i * 2 + 1];
      expect(x).toBeGreaterThanOrEqual(MARGIN);
      expect(x).toBeLessThanOrEqual(WIDTH - MARGIN);
      expect(y).toBeGreaterThanOrEqual(MARGIN);
      expect(y).toBeLessThanOrEqual(HEIGHT - MARGIN);
      // Docked markers sit on the margin edge.
      const onEdge = x === MARGIN || x === WIDTH - MARGIN || y === MARGIN || y === HEIGHT - MARGIN;
      expect(onEdge).toBe(true);
    }
    expect(docked).toBeGreaterThan(count / 4);
  });

  it('draws on-screen markers at the projected position, rounded to whole pixels', () => {
    let onScreen = 0;
    for (let i = 0; i < count; i++) {
      if (frame.states[i] !== EdgeMarkerState.ON_SCREEN) continue;
      onScreen++;
      const [px, py] = viewport.project(getWorld(targets, i));
      expect(frame.positions[i * 2]).toBe(Math.round(px));
      expect(frame.positions[i * 2 + 1]).toBe(Math.round(py));
      expect(px).toBeGreaterThanOrEqual(MARGIN);
      expect(px).toBeLessThanOrEqual(WIDTH - MARGIN);
      expect(py).toBeGreaterThanOrEqual(MARGIN);
      expect(py).toBeLessThanOrEqual(HEIGHT - MARGIN);
    }
    expect(onScreen).toBeGreaterThan(5);
  });

  it('turns every docked arrow within 1 degree of the true bearing', () => {
    let worst = 0;
    for (let i = 0; i < count; i++) {
      if (frame.states[i] <= EdgeMarkerState.ON_SCREEN) continue;
      const expected = getCameraSpaceBearing(viewport, getWorld(targets, i));
      worst = Math.max(worst, angleDifference(frame.angles[i], expected));
    }
    expect(worst).toBeLessThan(1);
  });

  it('docks behind-camera targets on the side of the target, not the mirrored side', () => {
    const [cx, cy] = frame.principalPoint;
    let behind = 0;
    let mirrored = 0;
    for (let i = 0; i < count; i++) {
      if (frame.states[i] !== EdgeMarkerState.BEHIND_CAMERA) continue;
      behind++;
      const world = getWorld(targets, i);
      // Behind the camera plane: camera-space z is positive (the camera looks down -z).
      expect(getCameraSpaceZ(viewport, world)).toBeGreaterThan(0);
      const expected = getCameraSpaceBearing(viewport, world);
      const x = frame.positions[i * 2] - cx;
      const y = frame.positions[i * 2 + 1] - cy;
      const positionBearing = (Math.atan2(-y, x) * 180) / Math.PI;
      expect(angleDifference(positionBearing, expected)).toBeLessThan(1);
      // The naive projection mirrors the point through the center.
      const [px, py] = viewport.project(world);
      if (angleDifference((Math.atan2(-(py - cy), px - cx) * 180) / Math.PI, expected) > 179) {
        mirrored++;
      }
    }
    expect(behind).toBeGreaterThan(50);
    // The check above can fail: the naive projection is on the wrong side for these targets.
    expect(mirrored).toBe(behind);
  });
});

describe('computeEdgeMarkers integer coordinates', () => {
  it.each([1, 2, 1.5])('moves no marker by a sub-pixel amount during a slow pan (dpr %s)', dpr => {
    const options = {...OPTIONS, devicePixelRatio: dpr};
    const start = VIEWPORTS.map() as WebMercatorViewport;
    const targets = makeTargetsAroundCamera(start, 500, 7);
    let previous: Float64Array | null = null;
    let moved = 0;
    for (let step = 0; step < 120; step++) {
      // About 0.1 CSS pixels per frame.
      const viewport = new WebMercatorViewport({
        width: WIDTH,
        height: HEIGHT,
        longitude: -122.4 + step * 2e-6,
        latitude: 37.8,
        zoom: 12,
        pitch: 60,
        bearing: 30
      });
      const frame = computeEdgeMarkers(viewport, targets, 500, options);
      for (let i = 0; i < 1000; i++) {
        const device = frame.positions[i] * dpr;
        expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9);
        if (previous) {
          const delta = Math.abs(frame.positions[i] - previous[i]) * dpr;
          expect(delta === 0 || delta > 1 - 1e-9).toBe(true);
          if (delta) moved++;
        }
      }
      previous = frame.positions.slice();
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('keeps rounded docked markers inside margins that are not whole device pixels', () => {
    // 25 CSS px at 1.5 device px per CSS px is 37.5 device px.
    const margins = {top: 25, right: 25, bottom: 25, left: 25};
    const viewport = VIEWPORTS.map();
    const targets = makeTargetsAroundCamera(viewport, 500, 13);
    const frame = computeEdgeMarkers(viewport, targets, 500, {
      ...OPTIONS,
      margins,
      devicePixelRatio: 1.5
    });
    let docked = 0;
    for (let i = 0; i < 500; i++) {
      if (frame.states[i] <= EdgeMarkerState.ON_SCREEN) continue;
      docked++;
      expect(frame.positions[i * 2]).toBeGreaterThanOrEqual(25);
      expect(frame.positions[i * 2]).toBeLessThanOrEqual(WIDTH - 25);
      expect(frame.positions[i * 2 + 1]).toBeGreaterThanOrEqual(25);
      expect(frame.positions[i * 2 + 1]).toBeLessThanOrEqual(HEIGHT - 25);
    }
    expect(docked).toBeGreaterThan(100);
  });

  it('keeps sub-pixel positions when integerCoordinates is false', () => {
    const viewport = VIEWPORTS.map();
    const targets = makeTargetsAroundCamera(viewport, 200, 3);
    const frame = computeEdgeMarkers(viewport, targets, 200, {
      ...OPTIONS,
      integerCoordinates: false
    });
    let fractional = 0;
    for (let i = 0; i < 400; i++) {
      if (!Number.isInteger(frame.positions[i])) fractional++;
    }
    expect(fractional).toBeGreaterThan(100);
  });
});

describe('computeEdgeMarkers distance range', () => {
  it('hides targets outside [minDistance, maxDistance] in meters', () => {
    const viewport = VIEWPORTS['first-person']();
    const camera = viewport.cameraPosition;
    const unitsPerMeter = viewport.distanceScales.unitsPerMeter[0];
    const meters = [5, 50, 99, 101, 500, 999, 1001, 5000];
    const targets = new Float64Array(meters.length * 3);
    meters.forEach((d, i) => {
      const world = viewport.unprojectPosition([
        camera[0] + d * unitsPerMeter * 0.6,
        camera[1] + d * unitsPerMeter * 0.8,
        camera[2]
      ]);
      targets.set(world, i * 3);
    });
    const frame = computeEdgeMarkers(viewport, targets, meters.length, {
      ...OPTIONS,
      minDistance: 100,
      maxDistance: 1000
    });
    meters.forEach((d, i) => {
      expect(frame.distances[i]).toBeCloseTo(d, 3);
      const hidden = frame.states[i] === EdgeMarkerState.HIDDEN;
      expect(hidden).toBe(d < 100 || d > 1000);
    });
  });
});

describe('computeEdgeMarkers globe horizon', () => {
  const viewport = VIEWPORTS.globe();
  const random = makeRandom(11);
  const count = 400;
  const targets = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    targets.set([random() * 360 - 180, Math.asin(random() * 2 - 1) * (180 / Math.PI), 0], i * 3);
  }

  it('marks surface targets on the far side as beyond the horizon', () => {
    const frame = computeEdgeMarkers(viewport, targets, count, OPTIONS);
    const camera = viewport.cameraPosition;
    const radius = Math.hypot(...viewport.projectPosition([0, 0, 0]));
    let far = 0;
    for (let i = 0; i < count; i++) {
      // Oracle for a point on the sphere: visible when dot(P, C) > R^2.
      const p = viewport.projectPosition(getWorld(targets, i));
      const visible = p[0] * camera[0] + p[1] * camera[1] + p[2] * camera[2] > radius * radius;
      const state = frame.states[i];
      if (!visible) far++;
      expect(state === EdgeMarkerState.BEYOND_HORIZON).toBe(!visible);
    }
    expect(far).toBeGreaterThan(count / 4);
  });

  it('hides or ignores beyond-horizon targets on request', () => {
    const hidden = computeEdgeMarkers(viewport, targets, count, {
      ...OPTIONS,
      beyondHorizon: 'hide'
    });
    const ignored = computeEdgeMarkers(viewport, targets, count, {
      ...OPTIONS,
      beyondHorizon: 'ignore'
    });
    const docked = computeEdgeMarkers(viewport, targets, count, OPTIONS);
    for (let i = 0; i < count; i++) {
      if (docked.states[i] !== EdgeMarkerState.BEYOND_HORIZON) continue;
      expect(hidden.states[i]).toBe(EdgeMarkerState.HIDDEN);
      expect(ignored.states[i]).not.toBe(EdgeMarkerState.BEYOND_HORIZON);
      expect(ignored.states[i]).not.toBe(EdgeMarkerState.HIDDEN);
    }
  });

  it('does not hide a target on the visible surface or above it', () => {
    const camera = [0, 0, 1000];
    expect(isBeyondHorizon(camera, [0, 0, 256], 256)).toBe(false);
    expect(isBeyondHorizon(camera, [0, 0, -256], 256)).toBe(true);
    expect(isBeyondHorizon(camera, [300, 0, 0], 256)).toBe(false);
  });
});

describe('computeEdgeMarkers options', () => {
  it('hides behind-camera targets with behindCamera: hide', () => {
    const viewport = VIEWPORTS['first-person']();
    const targets = makeTargetsAroundCamera(viewport, 300, 5);
    const docked = computeEdgeMarkers(viewport, targets, 300, OPTIONS);
    const hidden = computeEdgeMarkers(viewport, targets, 300, {...OPTIONS, behindCamera: 'hide'});
    let behind = 0;
    for (let i = 0; i < 300; i++) {
      if (docked.states[i] === EdgeMarkerState.BEHIND_CAMERA) {
        behind++;
        expect(hidden.states[i]).toBe(EdgeMarkerState.HIDDEN);
      } else {
        expect(hidden.states[i]).toBe(docked.states[i]);
      }
    }
    expect(behind).toBeGreaterThan(0);
  });

  it('stretches the docked position, not the arrow, with yStretch', () => {
    const viewport = VIEWPORTS['first-person']();
    const targets = makeTargetsAroundCamera(viewport, 300, 9);
    const plain = computeEdgeMarkers(viewport, targets, 300, {
      ...OPTIONS,
      integerCoordinates: false
    });
    const plainPositions = plain.positions.slice();
    const plainAngles = plain.angles.slice();
    const stretched = computeEdgeMarkers(viewport, targets, 300, {
      ...OPTIONS,
      integerCoordinates: false,
      yStretch: 1.5
    });
    const [cx, cy] = stretched.principalPoint;
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      if (stretched.states[i] <= EdgeMarkerState.ON_SCREEN) continue;
      expect(stretched.angles[i]).toBe(plainAngles[i]);
      // The docked point is on the ray (dx, 1.5 * dy): its slope is 1.5x the plain slope.
      const sx = stretched.positions[i * 2] - cx;
      const sy = stretched.positions[i * 2 + 1] - cy;
      const px = plainPositions[i * 2] - cx;
      const py = plainPositions[i * 2 + 1] - cy;
      if (Math.abs(px) > 1 && Math.abs(sx) > 1) {
        expect(sy / sx).toBeCloseTo((1.5 * py) / px, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('computeEdgeMarkers projection cache', () => {
  const moves: Record<string, (k: number) => Viewport> = {
    // Latitude changes the Web Mercator altitude scale: the cache must keep only z = 0.
    map: k =>
      new WebMercatorViewport({
        width: WIDTH,
        height: HEIGHT,
        longitude: -122.4 + k * 0.01,
        latitude: 37.8 + k * 0.2,
        zoom: 12 - k * 0.1,
        pitch: 60,
        bearing: 30 + k * 5
      }),
    globe: k =>
      new GlobeViewport({
        width: WIDTH,
        height: HEIGHT,
        longitude: 10 + k * 3,
        latitude: 40 - k,
        zoom: 1.5
      }),
    'first-person': k =>
      new FirstPersonViewport({
        width: WIDTH,
        height: HEIGHT,
        longitude: -122.4,
        latitude: 37.8 + k * 0.001,
        position: [0, 0, 120],
        bearing: 45 + k * 7
      })
  };

  it.each(Object.keys(moves))('gives the same result as a fresh frame in the %s view', name => {
    const targets = makeTargetsAroundCamera(moves[name](0), 300, 17);
    // Altitudes far from 0, so that a stale altitude scale shows.
    for (let i = 0; i < 300; i++) targets[i * 3 + 2] += 5000;
    let reused;
    for (let k = 0; k < 12; k++) {
      const viewport = moves[name](k);
      reused = computeEdgeMarkers(viewport, targets, 300, OPTIONS, reused);
      const fresh = computeEdgeMarkers(viewport, targets, 300, OPTIONS);
      expect(Array.from(reused.states.subarray(0, 300))).toEqual(Array.from(fresh.states));
      expect(Array.from(reused.positions.subarray(0, 600))).toEqual(Array.from(fresh.positions));
      expect(Array.from(reused.angles.subarray(0, 300))).toEqual(Array.from(fresh.angles));
    }
  });

  it('projects again when the viewport projection changes', () => {
    // The built-in geospatial views project z = 0 the same way for every camera. A custom
    // viewport may not: here the common space shifts with the viewport.
    // Viewports are frozen after construction, so the shift comes from a factory closure.
    const makeShifted = (shift: number) =>
      new (class extends WebMercatorViewport {
        override projectPosition(xyz: number[]): [number, number, number] {
          const [x, y, z] = super.projectPosition(xyz);
          return [x + shift, y, z];
        }
      })({width: WIDTH, height: HEIGHT, longitude: -122.4, latitude: 37.8, zoom: 12});
    const targets = makeTargetsAroundCamera(makeShifted(0), 100, 3);
    const frame = computeEdgeMarkers(makeShifted(0), targets, 100, OPTIONS);
    const shifted = makeShifted(0.05);
    computeEdgeMarkers(shifted, targets, 100, OPTIONS, frame);
    const fresh = computeEdgeMarkers(shifted, targets, 100, OPTIONS);
    expect(Array.from(frame.positions.subarray(0, 200))).toEqual(Array.from(fresh.positions));
  });

  it('projects again when the positions change', () => {
    const viewport = VIEWPORTS.map();
    const a = makeTargetsAroundCamera(viewport, 100, 1);
    const b = makeTargetsAroundCamera(viewport, 100, 2);
    const frame = computeEdgeMarkers(viewport, a, 100, OPTIONS);
    const first = frame.positions.slice(0, 200);
    computeEdgeMarkers(viewport, b, 100, OPTIONS, frame);
    const fresh = computeEdgeMarkers(viewport, b, 100, OPTIONS);
    expect(Array.from(frame.positions.subarray(0, 200))).toEqual(Array.from(fresh.positions));
    expect(Array.from(frame.positions.subarray(0, 200))).not.toEqual(Array.from(first));
  });
});
