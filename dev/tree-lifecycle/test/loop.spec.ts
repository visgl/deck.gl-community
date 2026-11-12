// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {
  getFocusedCamera,
  getFocusPull,
  getLensAngles,
  getSubFrameSeconds,
  getSubFrames
} from '../stage/accumulator';
import {
  getOverlayMetrics,
  layOutTimelineOverlay,
  type MeasureText
} from '../stage/timeline-overlay';
import {
  CYCLE_SECONDS,
  getFallSeconds,
  getSceneSeconds,
  getSeamSeconds,
  getTimeRate,
  getYear,
  LOOP
} from '../story/beats';
import {getCameraEye, getCameraForward} from '../story/camera';
import {getStoryState} from '../story/story';
import type {StoryCamera, StoryState, StoryWorld, Vec3} from '../story/story-types';

// The coverage walk draws a great many states.
vi.setConfig({testTimeout: 120000});

const PORTRAIT = 9 / 16;
const LANDSCAPE = 16 / 9;
const FRAME_RATE = 30;
/** The overlay's four frames, as `timeline-overlay.spec.ts` lays them out. */
const OVERLAY_SIZES = [
  [1920, 1080],
  [1080, 1920],
  [1280, 720],
  [3840, 2160]
] as const;

/** The cycle second just before the swap, on the end world's side, and just after it. */
const BEFORE = CYCLE_SECONDS - 1e-9;
const AFTER = 1e-9;
/** Seconds the slopes are measured over, either side of the swap. */
const SLOPE_STEP = 1e-4;

/** The degrees of an orbit, 0 up to 360. */
function getBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Every number that must come through the swap unchanged, in value and slope: what is keyed on
 * seam seconds (the clocks, the rate and the camera relative to the fruit), and the sun, light,
 * grade, fog, sky and air, which are flat and equal at both ends of the cycle.
 */
function getSeamChannels(t: number, aspect = PORTRAIT): Record<string, number> {
  const state = getStoryState(t, {aspect});
  const {camera, props, sky, key, ambient, fog, grade, weather, wind, shadowColor} = state;
  const fruit = props.orange.position;
  const eye = getCameraEye(camera);
  const channels: Record<string, number> = {
    rate: state.cycle.rate,
    fall: state.cycle.fall,
    orbit: getBearing(camera.orbit),
    pitch: camera.pitch,
    distance: camera.distance,
    fovy: camera.fovy,
    aperture: camera.aperture,
    near: camera.near,
    far: camera.far,
    keyIntensity: key.intensity,
    keySoftness: key.softness,
    ambientIntensity: ambient.intensity,
    shadowAlpha: shadowColor[3],
    fogDensity: fog.density,
    turbidity: sky.turbidity,
    cloudCover: sky.cloudCover,
    cloudBuild: sky.cloudBuild,
    storm: sky.storm,
    eye: sky.eye,
    flash: sky.flash,
    wind: wind.strength,
    rain: weather.rain,
    debris: weather.debris,
    motes: weather.motes,
    petals: weather.petals,
    sparkle: weather.sparkle,
    spray: weather.spray,
    mist: weather.mist,
    radius: props.orange.radius,
    dew: props.orange.dew,
    seam: props.orange.seam,
    juice: props.orange.juice,
    squash: props.orange.squash,
    shake: Math.hypot(state.shake[0], state.shake[1])
  };
  for (const [name, value] of Object.entries(grade)) channels[`grade.${name}`] = value;
  const vectors: Record<string, readonly number[]> = {
    eyeFromFruit: subtract(eye, fruit),
    targetFromFruit: subtract(camera.target, fruit),
    sun: sky.sunDirection,
    keyDirection: key.direction,
    keyColor: key.color,
    ambientColor: ambient.color,
    fogColor: fog.color
  };
  for (const [name, vector] of Object.entries(vectors)) {
    vector.forEach((value, axis) => {
      channels[`${name}[${axis}]`] = value;
    });
  }
  const {rollover} = state.timeline;
  if (rollover) {
    for (const name of ['slide', 'previousAlpha', 'nextAlpha', 'roll', 'yieldAlpha'] as const) {
      channels[`rollover.${name}`] = rollover[name];
    }
  }
  return channels;
}

/** A one-sided slope at `t` toward `side`, with Richardson's step to take out the curvature. */
function getSlopes(t: number, side: 1 | -1): Record<string, number> {
  const at = getSeamChannels(t);
  const near = getSeamChannels(t + (side * SLOPE_STEP) / 2);
  const far = getSeamChannels(t + side * SLOPE_STEP);
  const slopes: Record<string, number> = {};
  for (const name of Object.keys(at)) {
    const short = (near[name] - at[name]) / (side * (SLOPE_STEP / 2));
    const long = (far[name] - at[name]) / (side * SLOPE_STEP);
    slopes[name] = 2 * short - long;
  }
  return slopes;
}

/** The channels that differ by more than `tolerance` between two sets of them. */
function findDifferences(
  a: Record<string, number>,
  b: Record<string, number>,
  tolerance: number
): string[] {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names]
    .filter(name => !(Math.abs((a[name] ?? NaN) - (b[name] ?? NaN)) <= tolerance))
    .map(name => `${name}: ${a[name]} / ${b[name]}`);
}

/** Text about as wide as the overlay's faces, as `timeline-overlay.spec.ts` measures it. */
const measure: MeasureText = (text, font) => text.length * (font.size * 0.58 + font.tracking);

/** Every number in a layout, by its path, and the text in it. */
function flatten(value: unknown, path: string, into: Map<string, unknown>): Map<string, unknown> {
  if (typeof value === 'number' || typeof value === 'string' || value === null) {
    into.set(path, value);
  } else if (Array.isArray(value)) {
    into.set(`${path}.length`, value.length);
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, into));
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) flatten(item, `${path}.${name}`, into);
  }
  return into;
}

/** Where a ray from `eye` along unit `direction` comes nearest `center`, if ahead of it. */
function getMiss(eye: Vec3, direction: Vec3, center: Vec3): number {
  const toCenter = subtract(center, eye);
  const along =
    toCenter[0] * direction[0] + toCenter[1] * direction[1] + toCenter[2] * direction[2];
  if (along <= 0) return Infinity;
  return Math.hypot(
    toCenter[0] - direction[0] * along,
    toCenter[1] - direction[1] * along,
    toCenter[2] - direction[2] * along
  );
}

/** The four corner rays of a camera's frame, as unit vectors. */
function getCornerRays(camera: StoryCamera, aspect: number): Vec3[] {
  const forward = getCameraForward(camera);
  const flat = Math.hypot(forward[0], forward[1]);
  const right: Vec3 = [forward[1] / flat, -forward[0] / flat, 0];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]
  ];
  const tangent = Math.tan((camera.fovy / 2) * (Math.PI / 180));
  const rays: Vec3[] = [];
  for (const across of [-1, 1]) {
    for (const above of [-1, 1]) {
      const ray: Vec3 = [0, 1, 2].map(
        axis => forward[axis] + right[axis] * across * tangent * aspect + up[axis] * above * tangent
      ) as Vec3;
      const length = Math.hypot(ray[0], ray[1], ray[2]);
      rays.push([ray[0] / length, ray[1] / length, ray[2] / length]);
    }
  }
  return rays;
}

/** The camera of one sub-frame, as the stage draws it: shaken, focused, and moved on its lens. */
function getSubFrameCamera(state: StoryState, lens: readonly [number, number]): StoryCamera {
  const shaken = {
    ...state.camera,
    orbit: state.camera.orbit + state.shake[0],
    pitch: state.camera.pitch + state.shake[1]
  };
  const focused = getFocusedCamera(shaken, getFocusPull(state));
  const [orbit, pitch] = getLensAngles(focused, lens);
  return {...focused, orbit: focused.orbit + orbit, pitch: focused.pitch + pitch};
}

describe('the swap', () => {
  it('comes through in value and slope, for everything keyed on seam seconds and held flat', () => {
    const before = getSeamChannels(BEFORE);
    const after = getSeamChannels(AFTER);
    expect(findDifferences(before, after, 1e-6)).toEqual([]);
    expect(findDifferences(getSlopes(BEFORE, -1), getSlopes(AFTER, 1), 1e-6)).toEqual([]);
  });

  it('is between the end world and the start world, and nothing else changes sides there', () => {
    expect(getStoryState(BEFORE).cycle.world).toBe('end');
    expect(getStoryState(AFTER).cycle.world).toBe('start');
    expect(getStoryState(BEFORE).year).toBe(30);
    expect(getStoryState(AFTER).year).toBeCloseTo(0, 12);
    // Seam seconds turn over at mid-cycle, and the world's label with them; nothing reads it there.
    const middle = CYCLE_SECONDS / 2;
    const a = getStoryState(middle - 1e-9, {aspect: PORTRAIT});
    const b = getStoryState(middle + 1e-9, {aspect: PORTRAIT});
    expect(a.cycle.world).toBe('start');
    expect(b.cycle.world).toBe('end');
    const channels = (state: StoryState) => ({
      eye: getCameraEye(state.camera),
      target: state.camera.target,
      sun: state.sky.sunDirection,
      orange: state.props.orange.visible,
      timeline: state.timeline.playhead,
      trees: state.trees.map(tree => tree.growth)
    });
    const ca = channels(a);
    const cb = channels(b);
    expect(ca.orange).toBe(cb.orange);
    for (let axis = 0; axis < 3; axis++) {
      expect(ca.eye[axis]).toBeCloseTo(cb.eye[axis], 6);
      expect(ca.target[axis]).toBeCloseTo(cb.target[axis], 6);
      expect(ca.sun[axis]).toBeCloseTo(cb.sun[axis], 7);
    }
    expect(ca.timeline).toBeCloseTo(cb.timeline, 7);
    ca.trees.forEach((growth, index) => expect(growth).toBeCloseTo(cb.trees[index] as number, 7));
  });

  it("lays the overlay out alike within a pixel either side, on the film's frame", () => {
    // A wider frame's axis is longer, and its roll-over's slide moves further in the same time.
    for (const [width, height] of [[1080, 1920]]) {
      const metrics = getOverlayMetrics(width, height);
      const getLayout = (t: number) => {
        const state = getStoryState(t, {aspect: width / height});
        return flatten(
          layOutTimelineOverlay(state.timeline, state.caption, metrics, measure),
          '',
          new Map()
        );
      };
      const before = getLayout(CYCLE_SECONDS - 0.001);
      const after = getLayout(0.001);
      const differences: string[] = [];
      for (const path of new Set([...before.keys(), ...after.keys()])) {
        const a = before.get(path);
        const b = after.get(path);
        const same = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1 : a === b;
        if (!same) differences.push(`${path}: ${String(a)} / ${String(b)}`);
      }
      expect(differences.slice(0, 12), `${width}x${height}`).toEqual([]);
    }
  });

  it('moves the overlay no further across the swap than either side of it, at every size', () => {
    // The roll-over's own slide covers more pixels on a wider frame's longer axis, so there the
    // step across the swap is held to the steps beside it, 2 ms either way, rather than to a pixel.
    const STEP = 0.001;
    for (const [width, height] of OVERLAY_SIZES) {
      const metrics = getOverlayMetrics(width, height);
      const getLayout = (seam: number) => {
        const state = getStoryState((seam + CYCLE_SECONDS) % CYCLE_SECONDS, {
          aspect: width / height
        });
        return flatten(
          layOutTimelineOverlay(state.timeline, state.caption, metrics, measure),
          '',
          new Map()
        );
      };
      const [early, before, after, late] = [-3 * STEP, -STEP, STEP, 3 * STEP].map(getLayout);
      const jumps: string[] = [];
      for (const path of new Set([...before.keys(), ...after.keys()])) {
        const values = [early, before, after, late].map(layout => layout.get(path));
        if (!values.every(value => typeof value === 'number')) {
          if (values[1] !== values[2])
            jumps.push(`${path}: ${String(values[1])} / ${String(values[2])}`);
          continue;
        }
        const [a, b, c, d] = values as number[];
        const beside = Math.max(Math.abs(b - a), Math.abs(d - c));
        if (Math.abs(c - b) > beside + 0.01) jumps.push(`${path}: ${c - b} against ${beside}`);
      }
      expect(jumps.slice(0, 12), `${width}x${height}`).toEqual([]);
    }
  });

  it('hides everything that may change at the swap inside the rind', () => {
    // Every corner ray of every lens position of every sub-frame, in both worlds, hits the fruit.
    const subFrames = getSubFrames(32);
    const misses: string[] = [];
    const from = Math.ceil(LOOP.cover[0] * FRAME_RATE);
    const to = Math.floor(LOOP.cover[1] * FRAME_RATE);
    for (let frame = from; frame <= to; frame++) {
      const t = (frame / FRAME_RATE + CYCLE_SECONDS) % CYCLE_SECONDS;
      for (const world of ['end', 'start'] as StoryWorld[]) {
        for (const aspect of [PORTRAIT, LANDSCAPE]) {
          for (const subFrame of subFrames) {
            const state = getStoryState(getSubFrameSeconds(t, subFrame), {aspect, world});
            const camera = getSubFrameCamera(state, subFrame.lens);
            const eye = getCameraEye(camera);
            const {position, radius} = state.props.orange;
            for (const ray of getCornerRays(camera, aspect)) {
              const miss = getMiss(eye, ray, position);
              if (!(miss < radius)) {
                misses.push(`seam ${getSeamSeconds(t).toFixed(3)} ${world} ${aspect.toFixed(2)}`);
              }
            }
          }
        }
      }
    }
    expect([...new Set(misses)].slice(0, 10)).toEqual([]);
  });

  it('pins the planes across LOOP.pinned', () => {
    for (let seam = LOOP.pinned[0]; seam <= LOOP.pinned[1]; seam += 0.05) {
      const {camera} = getStoryState((seam + CYCLE_SECONDS) % CYCLE_SECONDS, {aspect: PORTRAIT});
      expect(camera.near).toBeCloseTo(LOOP.pinnedPlanes.near, 9);
      expect(camera.far).toBeCloseTo(LOOP.pinnedPlanes.far, 9);
    }
  });

  it('brings the far plane in only where the rind is all there is to see', () => {
    // Pinned inside the cover, the far plane never sweeps through the crowns behind the falling
    // fruit while they are on screen: in the dive it draws to its own far plane, frame by frame.
    expect(LOOP.pinned[0]).toBeGreaterThan(LOOP.cover[0]);
    expect(LOOP.pinned[1]).toBeLessThan(LOOP.cover[1]);
    for (const aspect of [PORTRAIT, LANDSCAPE]) {
      let last = Number.NaN;
      for (let frame = -90; frame <= 30; frame++) {
        const seam = frame / FRAME_RATE;
        // Every sub-frame of a frame outside the cover, at either end of its shutter.
        for (const shutter of [-1 / 120, 0, 1 / 120]) {
          const at = seam + shutter;
          if (at >= LOOP.cover[0] && at <= LOOP.cover[1]) continue;
          const {far} = getStoryState((at + CYCLE_SECONDS) % CYCLE_SECONDS, {aspect}).camera;
          if (shutter === 0 && Number.isFinite(last) && at < LOOP.cover[0]) {
            expect(far / last, `far at seam ${at.toFixed(3)}`).toBeGreaterThan(0.94);
          }
          if (shutter === 0) last = far;
          // Out of the cover the far plane reaches past the fruit and the crowns round it.
          expect(far, `far at seam ${at.toFixed(3)}`).toBeGreaterThan(at < 0 ? 5 : 0.5);
        }
      }
    }
  });
});

describe('the clocks', () => {
  it('runs year, the scene clock and the fall on through the cycle, starting again only at the swap', () => {
    const step = 1 / 240;
    let last = {year: -1, clock: -1, fall: -1};
    for (let t = 0; t < CYCLE_SECONDS; t += step) {
      const now = {year: getYear(t), clock: getSceneSeconds(t), fall: getFallSeconds(t)};
      expect(now.year).toBeGreaterThanOrEqual(last.year);
      expect(now.clock).toBeGreaterThan(last.clock);
      // The fall runs from the let-go through the swap, and is 0 from its rest to the let-go.
      if (getSeamSeconds(t) > LOOP.letGo + step) expect(now.fall).toBeGreaterThan(last.fall);
      last = now;
    }
    // Through the swap the fall runs on, the scene clock and year start again.
    expect(getFallSeconds(AFTER)).toBeCloseTo(getFallSeconds(BEFORE), 6);
    expect(getSceneSeconds(AFTER)).toBeLessThan(1e-6);
    expect(getYear(AFTER)).toBeLessThan(1e-6);
  });

  it('slows to an eighth around the swap, and is real time from 2.6 to 60.4', () => {
    for (let t = 2.6; t <= 60.4; t += 0.1) expect(getTimeRate(t)).toBeCloseTo(1, 9);
    for (let seam = -2.6; seam <= 1.25; seam += 0.05) {
      expect(getTimeRate((seam + CYCLE_SECONDS) % CYCLE_SECONDS)).toBeCloseTo(0.12, 9);
    }
    expect(getStoryState(LOOP.fileStart).cycle.rate).toBeLessThan(0.2);
  });

  it('makes the file wrap an ordinary step: the same world, the same easing rate and move', () => {
    // The file's last frame and its first, and the frame after: one step of story time, then the next.
    const [last, first, next] = [-1, 0, 1].map(frame =>
      getStoryState(LOOP.fileStart + frame / FRAME_RATE, {aspect: PORTRAIT})
    );
    expect(last.cycle.world).toBe(first.cycle.world);
    expect(first.cycle.world).toBe(next.cycle.world);
    const rateBefore = first.cycle.rate - last.cycle.rate;
    const rateAfter = next.cycle.rate - first.cycle.rate;
    expect(Math.abs(rateBefore)).toBeLessThan(Math.abs(rateAfter) * 1.5 + 1e-6);
    const eyes = [last, first, next].map(state => getCameraEye(state.camera));
    const stepBefore = Math.hypot(...subtract(eyes[1], eyes[0]));
    const stepAfter = Math.hypot(...subtract(eyes[2], eyes[1]));
    expect(stepBefore).toBeGreaterThan(0);
    expect(Math.abs(stepAfter - stepBefore)).toBeLessThan(stepBefore * 0.15);
  });
});

describe('the still air', () => {
  it('has no wind at all through LOOP.stillAir, and no motes or petals through LOOP.noMotes', () => {
    for (let seam = LOOP.stillAir[0]; seam <= LOOP.stillAir[1]; seam += 1 / 120) {
      const state = getStoryState((seam + CYCLE_SECONDS) % CYCLE_SECONDS);
      expect(state.wind.strength, `seam ${seam}`).toBe(0);
      if (seam >= LOOP.noMotes[0] && seam <= LOOP.noMotes[1]) {
        expect(state.weather.motes).toBe(0);
        expect(state.weather.petals).toBe(0);
      }
      for (const tree of state.trees) {
        expect(tree.wind ?? 0).toBe(0);
      }
    }
  });

  it('has no rain, debris, sparkle or spray, and no caption, around the swap', () => {
    for (let seam = LOOP.noCaption[0]; seam <= LOOP.noCaption[1]; seam += 1 / 60) {
      const state = getStoryState((seam + CYCLE_SECONDS) % CYCLE_SECONDS);
      expect(state.weather.rain).toBe(0);
      expect(state.weather.debris).toBe(0);
      expect(state.weather.sparkle).toBe(0);
      expect(state.weather.spray).toBe(0);
      expect(state.caption, `caption at seam ${seam}`).toBeNull();
    }
  });
});
