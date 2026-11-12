// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

/**
 * The force, 0-1, from which a directed wind starts to blow as a storm does, and the force by which it does in full:
 * longer lulls between sharper gusts, crowns combed over, and leaves streaming. Below the first nothing differs from
 * a breeze.
 */
export const TREE_WIND_STRONG_FROM = 0.06;
export const TREE_WIND_STRONG_TO = 0.85;

/** Where and when to read the gust that a photoreal `TreeLayer` tree stands in. */
export type TreeWindGustOptions = {
  /**
   * Metres from the layer's gust origin, along x and y. The origin is the position of the layer's first tree, so in
   * Cartesian coordinates with a first tree at `[0, 0]` this is the position itself.
   */
  position: ArrayLike<number>;
  /** Seconds on the gust clock: the layer's `windGustTime`, or its `windTime` when that is null. */
  time: number;
  /**
   * Compass bearing in degrees, clockwise from +y, that the wind blows toward, as the layer's `windDirection`. A
   * bearing that is not finite is the sway of no particular direction, which has no fronts: its gust is always 0.5.
   */
  direction: number;
  /** The wind's force there, 0-1: the layer's `windStrength`, or a tree's own `TreeSpec.wind`. */
  strength: number;
  /**
   * Radians, a tree's own phase, which its chop runs on. 0 reads a point in the open, such as grass or water.
   * @default 0
   */
  phase?: number;
};

/** How far a wind of this force, 0-1, blows as a storm does: 0 for a breeze, 1 for a storm. */
function getStrong(force: number): number {
  const t = Math.min(
    1,
    Math.max(0, (force - TREE_WIND_STRONG_FROM) / (TREE_WIND_STRONG_TO - TREE_WIND_STRONG_FROM))
  );
  return t * t * (3 - 2 * t);
}

/**
 * The gust before it is clamped to 1, 0 to 1.3, `along` and `side` metres from the gust origin along and across
 * the wind. What a tree bends by. The same sums as `treeWind_getGustAt`.
 */
function getRawGust(along: number, side: number, time: number, strong: number, phase: number) {
  const front =
    0.5 + 0.5 * Math.sin(along * 0.085 - time * 1.05 + 1.4 * Math.sin(side * 0.06 + time * 0.17));
  const chop = 0.5 + 0.5 * Math.sin(along * 0.21 - time * 2.3 + phase);
  const pulse = front + (front * front * front - front) * strong;
  const flurry = chop + (chop * chop * chop - chop) * strong;
  const gust = 0.15 + 0.05 * strong + (0.8 + 0.05 * strong) * pulse + 0.3 * flurry;
  return Math.min(1.3, Math.max(0, gust));
}

/**
 * The gust, 0-1, that a photoreal `TreeLayer` tree stands in at a place and time: the CPU twin of the shader's
 * travelling fronts, their chop and their pulse, so that a host can move grass, water, spray, a camera or a sound
 * with the trees. Fronts roll downwind across a grove at about 12 m for each second of the gust clock, wandering
 * slowly across the wind, and in a strong wind they come as a sharper pulse with longer lulls between. Pure: the
 * same options always give the same gust.
 *
 * ```ts
 * const gust = getTreeWindGust({position: [-18, 3.8], time: windGustTime, direction: 15, strength: 0.7});
 * ```
 *
 * The shader works in 32-bit floats, so the two agree to about 1e-4 at clocks of a few hundred seconds.
 */
export function getTreeWindGust(options: TreeWindGustOptions): number {
  const {position, time, direction, strength, phase = 0} = options;
  if (!Number.isFinite(direction)) return 0.5;
  const radians = (direction * Math.PI) / 180;
  const x = Math.sin(radians);
  const y = Math.cos(radians);
  const along = position[0] * x + position[1] * y;
  const side = position[1] * x - position[0] * y;
  return Math.min(getRawGust(along, side, time, getStrong(strength), phase), 1);
}

/** A number as a GLSL float literal. */
function toFloatLiteral(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/**
 * GLSL of the gust, which the photoreal shaders bend their trees by, and which `_treeWindGust` gives a host's own
 * layers. One copy, so the trees and the host cannot drift apart.
 */
export const TREE_WIND_GUST_GLSL = /* glsl */ `\
// How far a wind of this force, 0-1, blows as a storm does: 0 for a breeze, 1 for a storm.
float treeWind_getStrong(float force) {
  return smoothstep(${toFloatLiteral(TREE_WIND_STRONG_FROM)}, ${toFloatLiteral(TREE_WIND_STRONG_TO)}, force);
}

// The gust, 0 to 1.3, along and side metres from a photoreal TreeLayer's gust origin along and across the wind, at
// time seconds on its gust clock, in a wind strong 0-1 as treeWind_getStrong says, with phase a tree's own radians.
// Fronts a crown or two wide roll downwind, wandering slowly across the wind, and a quicker chop runs over them.
float treeWind_getGustAt(float along, float side, float time, float strong, float phase) {
  float front = 0.5 + 0.5 * sin(along * 0.085 - time * 1.05 + 1.4 * sin(side * 0.06 + time * 0.17));
  float chop = 0.5 + 0.5 * sin(along * 0.21 - time * 2.3 + phase);
  // A gust is a pulse with lulls between, and a storm has more of a pulse than a breeze.
  float pulse = mix(front, front * front * front, strong);
  float flurry = mix(chop, chop * chop * chop, strong);
  return clamp(mix(0.15, 0.2, strong) + mix(0.8, 0.85, strong) * pulse + 0.3 * flurry, 0.0, 1.3);
}

// The gust, 0-1, that a photoreal TreeLayer tree stands in: metres from the layer's gust origin, seconds on its
// gust clock, the unit vector the wind blows toward, its force 0-1 and a tree's own phase in radians, 0 in the
// open. getTreeWindGust on the GPU.
float treeWind_getGust(vec2 metres, float time, vec2 direction, float force, float phase) {
  float along = dot(metres, direction);
  float side = dot(metres, vec2(-direction.y, direction.x));
  return min(treeWind_getGustAt(along, side, time, treeWind_getStrong(force), phase), 1.0);
}
`;

/**
 * Shader module with `float treeWind_getGust(vec2 metres, float time, vec2 direction, float force, float phase)`,
 * the GLSL twin of {@link getTreeWindGust}, for a host's own layers to move with the trees. `direction` is the unit
 * vector the wind blows toward, `[sin(bearing), cos(bearing)]`. It has no uniforms: a host passes the layer's
 * gust clock and wind as its own.
 */
export const _treeWindGust = {
  name: 'treeWind',
  vs: TREE_WIND_GUST_GLSL,
  fs: TREE_WIND_GUST_GLSL
} as const satisfies ShaderModule;
