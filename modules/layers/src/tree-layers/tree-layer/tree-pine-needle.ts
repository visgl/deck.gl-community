// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Relative half-width of a pine needle, with a short base and a long narrow taper. */
export function getPineBladeOutline(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return Math.min(t / 0.045, 1) * (1 - 0.38 * t) * Math.min((1 - t) / 0.18, 1);
}
