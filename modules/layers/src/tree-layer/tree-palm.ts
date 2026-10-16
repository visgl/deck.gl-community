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

const FROND_COUNT = 22;
const SPEAR_COUNT = 4;

const PALM_FRONDS: PalmFrond[] = Array.from({length: FROND_COUNT + SPEAR_COUNT}, (_, index) => {
  const spear = index >= FROND_COUNT;
  const frondIndex = spear ? index - FROND_COUNT : index;
  const count = spear ? SPEAR_COUNT : FROND_COUNT;
  const angle =
    ((frondIndex + (spear ? 0.5 : 0)) / count) * Math.PI * 2 +
    (spear ? 0 : Math.sin(frondIndex * 5.37) * 0.07);
  const tier = frondIndex % 4;
  const radial = (radius: number, z: number): Point => [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    z
  ];
  const tipRadius = 0.82 + ((frondIndex * 7) % 9) * 0.018;
  const tipDrop = 0.1 + tier * 0.035 + ((frondIndex * 3) % 7) * 0.008;
  const controls: PalmFrond['controls'] = spear
    ? [radial(0.025, 0.46), radial(0.13, 0.8), radial(0.34, 1.04), radial(0.54, 0.98)]
    : [
        radial(0.035, 0.45 + tier * 0.012),
        radial(0.26, 0.74 - tier * 0.022),
        radial(0.61, 0.47 - tier * 0.025),
        radial(tipRadius, Math.max(0.035, 0.18 - tipDrop))
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
