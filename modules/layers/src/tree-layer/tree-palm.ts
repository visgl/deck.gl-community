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

const FROND_COUNT = 14;
const SPEAR_COUNT = 4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const PALM_FRONDS: PalmFrond[] = Array.from({length: FROND_COUNT + SPEAR_COUNT}, (_, index) => {
  const spear = index >= FROND_COUNT;
  const frondIndex = spear ? index - FROND_COUNT : index;
  // Keep frond maturity independent of azimuth so one side of the crown does not
  // end up uniformly younger (or older) than the other.
  const age = spear ? 0 : ((frondIndex * 5) % FROND_COUNT) / (FROND_COUNT - 1);
  const angle = frondIndex * GOLDEN_ANGLE + Math.sin(frondIndex * 5.37) * 0.055;
  const tier = spear ? 0 : Math.min(3, Math.floor((1 - age) * 4));
  const radial = (radius: number, z: number): Point => [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    z
  ];
  const lengthVariation = ((frondIndex * 7) % 9) / 8 - 0.5;
  const tipRadius = 0.74 + age * 0.2 + lengthVariation * 0.06;
  const baseHeight = 0.45 + tier * 0.01;
  const controls: PalmFrond['controls'] = spear
    ? [radial(0.025, 0.47), radial(0.13, 0.8), radial(0.34, 1.04), radial(0.54, 0.98)]
    : [
        radial(0.035, baseHeight),
        radial(0.22, baseHeight + 0.27 - age * 0.05),
        radial(tipRadius * 0.62, baseHeight + 0.34 - age * 0.2),
        radial(tipRadius, Math.max(0.1, baseHeight + 0.2 - age * 0.44))
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
