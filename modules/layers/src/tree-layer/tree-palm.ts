// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

type Point = [number, number, number];

export type PalmFrond = {
  angle: number;
  tier: number;
  spear: boolean;
  controls: readonly [Point, Point, Point, Point];
};

const FROND_COUNT = 12;
const SPEAR_COUNT = 1;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const PALM_LEADER_TOP = 0.68;

/** Keep the authored frond bases on the same crownshaft surface as the wood mesh. */
export function getPalmTrunkRadius(z: number, aggregate = false): number {
  const progress = Math.max(0, Math.min(1, (z + 1) / (PALM_LEADER_TOP + 1)));
  const scar = aggregate ? 0 : Math.pow((1 + Math.cos(progress * Math.PI * 44)) / 2, 10) * 0.012;
  const baseRadius = 0.074 - progress * 0.018 + scar;
  const crownProgress = Math.max(0, Math.min(1, (z - 0.48) / (PALM_LEADER_TOP - 0.48)));
  const crownTaper = crownProgress ** 2 * (3 - 2 * crownProgress);
  return baseRadius * (1 - crownTaper * 0.94);
}

const PALM_FRONDS: PalmFrond[] = Array.from({length: FROND_COUNT + SPEAR_COUNT}, (_, index) => {
  const spear = index >= FROND_COUNT;
  const frondIndex = spear ? index - FROND_COUNT : index;
  // Keep frond maturity independent of azimuth so one side of the crown does not
  // end up uniformly younger (or older) than the other.
  const ageSeed = Math.sin((frondIndex + 1) * 12.9898 + 78.233) * 43758.5453;
  const age = spear ? 0 : ageSeed - Math.floor(ageSeed);
  const angle =
    frondIndex * GOLDEN_ANGLE +
    Math.sin(frondIndex * 5.37) * 0.23 +
    Math.sin(frondIndex * 1.7) * 0.06;
  const tier = spear ? 0 : Math.min(3, Math.floor((1 - age) * 4));
  // Each rachis sweeps a little as it grows outward instead of staying in a
  // perfectly flat radial plane. This breaks the mechanical pinwheel when the
  // pinnate crowns overlap, while keeping the wood and leaf splats coincident.
  const sweep = Math.sin(frondIndex * 7.31 + 0.8) * 0.52;
  const radial = (radius: number, z: number): Point => {
    const azimuth = angle + radius * sweep;
    return [Math.cos(azimuth) * radius, Math.sin(azimuth) * radius, z];
  };
  const lengthVariation = ((frondIndex * 7) % 9) / 8 - 0.5;
  const tipRadius = 0.68 + age * 0.26 + lengthVariation * 0.09;
  const baseHeight =
    0.515 + Math.sin(frondIndex * 3.91) * 0.022 + Math.cos(frondIndex * 8.1) * 0.012;
  const controls: PalmFrond['controls'] = spear
    ? [
        [0, 0, 0.6],
        [0.008, -0.004, 0.78],
        [0.025, -0.002, 0.98],
        [0.052, 0.012, 1.14]
      ]
    : [
        radial(getPalmTrunkRadius(baseHeight), baseHeight),
        radial(0.22 + lengthVariation * 0.035, baseHeight + 0.3 - age * 0.06),
        radial(tipRadius * (0.58 + lengthVariation * 0.035), baseHeight + 0.39 - age * 0.25),
        radial(tipRadius, Math.max(0.08, baseHeight + 0.25 - age * 0.55))
      ];
  return {angle, tier, spear, controls};
});

/** Shared rachis paths keep the splat leaflets aligned with their woody frond stems. */
export function getPalmFronds(): readonly PalmFrond[] {
  return PALM_FRONDS;
}

/** Evaluate a normalized point along a shared cubic frond centerline. */
export function evaluatePalmFrond(frond: PalmFrond, t: number): Point {
  const u = 1 - t;
  const weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
  return [0, 1, 2].map(axis =>
    frond.controls.reduce((sum, point, index) => sum + point[axis] * weights[index], 0)
  ) as Point;
}
