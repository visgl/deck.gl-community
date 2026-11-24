// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The force, 0-1, from which a directed wind starts to blow as a storm does, and the force by which it does in full:
 * longer lulls between sharper gusts, crowns combed over, and leaves streaming. Below the first nothing differs from
 * a breeze.
 */
export const TREE_WIND_STRONG_FROM = 0.06;
export const TREE_WIND_STRONG_TO = 0.85;

/** A number as a GLSL float literal. */
function toFloatLiteral(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

export const TREE_WIND_GUST_GLSL = /* glsl */ `\
// How far a wind of this force, 0-1, blows as a storm does: 0 for a breeze, 1 for a storm.
float treeWind_getStrong(float force) {
  return smoothstep(${toFloatLiteral(TREE_WIND_STRONG_FROM)}, ${toFloatLiteral(TREE_WIND_STRONG_TO)}, force);
}

// The gust, 0 to 1.3, along and side metres from a photoreal TreeLayer's gust origin along and across the wind, at
// time seconds on the layer clock, with strength 0-1 from treeWind_getStrong and the tree's phase in radians.
// Fronts a crown or two wide roll downwind, wandering slowly across the wind, and a quicker chop runs over them.
float treeWind_getGustAt(float along, float side, float time, float strong, float phase) {
  float front = 0.5 + 0.5 * sin(along * 0.085 - time * 1.05 + 1.4 * sin(side * 0.06 + time * 0.17));
  float chop = 0.5 + 0.5 * sin(along * 0.21 - time * 2.3 + phase);
  // A gust is a pulse with lulls between, and a storm has more of a pulse than a breeze.
  float pulse = mix(front, front * front * front, strong);
  float flurry = mix(chop, chop * chop * chop, strong);
  return clamp(mix(0.15, 0.2, strong) + mix(0.8, 0.85, strong) * pulse + 0.3 * flurry, 0.0, 1.3);
}
`;
