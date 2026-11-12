// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Pure helpers behind the story tables: tracks that interpolate keyed values without overshoot,
 * eases with weight, stable hashes in place of randomness, and small vector and quaternion math.
 * Nothing here holds state, and no number here belongs to the film: those live in the tables of the
 * files that use them.
 */

import type {Quat, Rgb, Vec3} from './story-types';

export const RADIANS_PER_DEGREE = Math.PI / 180;

/** A keyed value: `[x, y]`, in order of x. */
export type Key = readonly [x: number, y: number];
/** A keyed value of any x, clamped at both ends. */
export type Track = (x: number) => number;

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function smoothstep(from: number, to: number, value: number): number {
  const u = clamp01((value - from) / (to - from));
  return u * u * (3 - 2 * u);
}

/** Smoothstep with no jump in acceleration at either end. */
export function smootherstep(from: number, to: number, value: number): number {
  const u = clamp01((value - from) / (to - from));
  return u * u * u * (u * (6 * u - 15) + 10);
}

/** 0 to 1 over `[riseFrom, riseTo]`, and back to 0 over `[fallFrom, fallTo]`. */
export function pulse(
  riseFrom: number,
  riseTo: number,
  fallFrom: number,
  fallTo: number,
  value: number
): number {
  return smoothstep(riseFrom, riseTo, value) * (1 - smoothstep(fallFrom, fallTo, value));
}

/** Stable 0-1 value for an id. All the film's randomness comes through here. */
export function hash01(id: number, salt = 0): number {
  let h =
    Math.imul((id | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((salt | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hashRange(id: number, salt: number, low: number, high: number): number {
  return lerp(low, high, hash01(id, salt));
}

/** Smooth value noise from -1 to 1, stable for a seed, with lattice points one x apart. */
export function smoothNoise(x: number, seed: number): number {
  const cell = Math.floor(x);
  const from = hash01(cell, seed);
  const to = hash01(cell + 1, seed);
  return lerp(from, to, smootherstep(0, 1, x - cell)) * 2 - 1;
}

/**
 * A track through keys, on Steffen's monotone cubic: smooth, passes through every key, and never
 * overshoots, so a key's value is the most a stretch of the track can reach. It leaves the first
 * key and arrives at the last with zero slope.
 */
export function createTrack(keys: readonly Key[]): Track {
  const count = keys.length;
  const last = count - 1;
  const slopes = new Float64Array(count);
  for (let i = 1; i < last; i++) {
    const before = keys[i][0] - keys[i - 1][0];
    const after = keys[i + 1][0] - keys[i][0];
    if (before <= 0 || after <= 0) throw new Error(`Track keys out of order at x=${keys[i][0]}`);
    const secantBefore = (keys[i][1] - keys[i - 1][1]) / before;
    const secantAfter = (keys[i + 1][1] - keys[i][1]) / after;
    if (secantBefore * secantAfter > 0) {
      const middle = (secantBefore * after + secantAfter * before) / (before + after);
      const limit = Math.min(Math.abs(secantBefore), Math.abs(secantAfter), 0.5 * Math.abs(middle));
      slopes[i] = 2 * Math.sign(secantBefore) * limit;
    }
  }
  return x => {
    if (x <= keys[0][0]) return keys[0][1];
    if (x >= keys[last][0]) return keys[last][1];
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (keys[middle][0] <= x) low = middle;
      else high = middle;
    }
    const span = keys[high][0] - keys[low][0];
    const u = (x - keys[low][0]) / span;
    const v = 1 - u;
    const value =
      keys[low][1] * v * v * (1 + 2 * u) +
      keys[high][1] * u * u * (1 + 2 * v) +
      slopes[low] * span * u * v * v -
      slopes[high] * span * u * u * v;
    // Rounding must not take a flat stretch, or a monotone one's end, past its keys.
    return clamp(
      value,
      Math.min(keys[low][1], keys[high][1]),
      Math.max(keys[low][1], keys[high][1])
    );
  };
}

/** A soft window, a binomial row: how `getSoftened` weighs a track either side of where it reads. */
export const SOFTEN_WEIGHTS: readonly number[] = [1, 6, 15, 20, 15, 6, 1];

/**
 * A dense soft window for `getSoftened`: a reading every `step` across `reach` either way, weighed
 * by a smooth bell, the biweight `(1 - u^2)^2`, which comes to nothing with no slope at its ends.
 * Read as sparsely as `SOFTEN_WEIGHTS` reads, a few readings each carry a large share of the
 * result, so a sudden change of a track's rate, such as an impact, comes into the result in steps,
 * one as each reading passes it. Read this densely it eases in and out over the whole reach instead,
 * with no step in acceleration.
 */
export function getBellWeights(reach: number, step: number): number[] {
  const half = Math.max(1, Math.ceil(reach / step));
  return Array.from({length: 2 * half + 1}, (_, index) => {
    const u = (index - half) / half;
    return (1 - u * u) ** 2;
  });
}

/**
 * A track's value at `x`, averaged over `reach` either way with `weights`, so that its changes of
 * speed ease in and out. As pure as the track it reads, and as continuous: a track of seam seconds
 * is softened through the swap by reading it on both sides.
 */
export function getSoftened(
  track: Track,
  x: number,
  reach: number,
  weights: readonly number[] = SOFTEN_WEIGHTS
): number {
  const center = (weights.length - 1) / 2;
  let sum = 0;
  let total = 0;
  for (let index = 0; index < weights.length; index++) {
    sum += weights[index] * track(x + ((index - center) / center) * reach);
    total += weights[index];
  }
  return sum / total;
}

/** `getSoftened` of a point that moves along `x`. */
export function getSoftenedPoint(
  read: (x: number) => Vec3,
  x: number,
  reach: number,
  weights: readonly number[] = SOFTEN_WEIGHTS
): Vec3 {
  const center = (weights.length - 1) / 2;
  const sum: Vec3 = [0, 0, 0];
  let total = 0;
  for (let index = 0; index < weights.length; index++) {
    const point = read(x + ((index - center) / center) * reach);
    sum[0] += weights[index] * point[0];
    sum[1] += weights[index] * point[1];
    sum[2] += weights[index] * point[2];
    total += weights[index];
  }
  return [sum[0] / total, sum[1] / total, sum[2] / total];
}

/**
 * The smaller of `a` and `b`, eased over `softness` where they meet, so that a value held to a
 * limit arrives at it with no kink in its rate. It is never more than either, and is the smaller
 * exactly once they are `softness` apart.
 */
export function getSoftMin(a: number, b: number, softness: number): number {
  if (softness <= 0) return Math.min(a, b);
  const gap = a - b;
  if (gap >= softness) return b;
  if (gap <= -softness) return a;
  // A quadratic through the corner: the same value and slope as each side where it meets it.
  const u = (gap + softness) / (2 * softness);
  return a - softness * u * u;
}

/** Degrees from `from` to `to` the short way round, -180 to 180. */
export function getAngleBetween(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/** A track of colors, one channel at a time, with each channel kept in range. */
export function createColorTrack(
  keys: readonly (readonly [x: number, color: Rgb])[]
): (x: number) => Rgb {
  const channels = [0, 1, 2].map(channel =>
    createTrack(keys.map(([x, color]) => [x, color[channel]] as const))
  );
  return x => [
    clamp(channels[0](x), 0, 255),
    clamp(channels[1](x), 0, 255),
    clamp(channels[2](x), 0, 255)
  ];
}

export function mixColor(from: Rgb, to: Rgb, amount: number): Rgb {
  return [lerp(from[0], to[0], amount), lerp(from[1], to[1], amount), lerp(from[2], to[2], amount)];
}

/**
 * Where a heavy thing is, 0 to 1 and a little past, for time 0 to 1 of its move: it gathers speed
 * from rest, goes past its mark by about `overshoot` and comes back. A step response of a damped
 * spring, softened at the start, and exactly 1 from time 1 on.
 */
export function getSettle(time: number, overshoot = 0.08): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const logOvershoot = Math.log(Math.max(overshoot, 1e-3));
  const damping = -logOvershoot / Math.sqrt(Math.PI * Math.PI + logOvershoot * logOvershoot);
  const ringing = Math.PI / 0.55;
  const decay = (damping * ringing) / Math.sqrt(1 - damping * damping);
  const soft = (time * time) / (time + 0.12);
  const response =
    1 -
    Math.exp(-decay * soft) *
      (Math.cos(ringing * soft) + (decay / ringing) * Math.sin(ringing * soft));
  return lerp(response, 1, smootherstep(0.82, 1, time));
}

/** Compass bearing in degrees, clockwise from +y, to a unit vector on the ground. */
export function getBearingVector(bearing: number): [number, number] {
  const radians = bearing * RADIANS_PER_DEGREE;
  return [Math.sin(radians), Math.cos(radians)];
}

export function getLength(vector: Vec3): number {
  return Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
}

export function normalize(vector: Vec3): Vec3 {
  const length = getLength(vector);
  return length > 0 ? [vector[0] / length, vector[1] / length, vector[2] / length] : [0, 0, 1];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function mixVec3(from: Vec3, to: Vec3, amount: number): Vec3 {
  return [lerp(from[0], to[0], amount), lerp(from[1], to[1], amount), lerp(from[2], to[2], amount)];
}

export function getQuatFromAxisAngle(axis: Vec3, radians: number): Quat {
  const unit = normalize(axis);
  const half = radians / 2;
  const s = Math.sin(half);
  return [unit[0] * s, unit[1] * s, unit[2] * s, Math.cos(half)];
}

/** The rotation that does `b` first, then `a`. */
export function multiplyQuat(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}

export function rotateVector(q: Quat, v: Vec3): Vec3 {
  const axis: Vec3 = [q[0], q[1], q[2]];
  const t = cross(axis, v);
  const u = cross(axis, t);
  return [
    v[0] + 2 * (q[3] * t[0] + u[0]),
    v[1] + 2 * (q[3] * t[1] + u[1]),
    v[2] + 2 * (q[3] * t[2] + u[2])
  ];
}

/** The shortest rotation taking one unit vector to another. */
export function getQuatFromTo(from: Vec3, to: Vec3): Quat {
  const cosine = dot(from, to);
  if (cosine > 0.999999) return [0, 0, 0, 1];
  if (cosine < -0.999999) {
    const axis = cross(from, Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    return getQuatFromAxisAngle(axis, Math.PI);
  }
  return getQuatFromAxisAngle(cross(from, to), Math.acos(cosine));
}
