// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Keep detailed crowns 50% farther away than the original interactive field defaults. */
export const DEFAULT_DETAIL_REACH = 1.5;

/** Crown widths on screen; a lower threshold keeps the richer representation farther away. */
export function getFieldDetailThresholds(reach = DEFAULT_DETAIL_REACH) {
  const scale = Number.isFinite(reach) ? Math.max(0.5, Math.min(3, reach)) : DEFAULT_DETAIL_REACH;
  return {
    nearIn: 300 / scale,
    nearOut: 255 / scale,
    finePixels: 24 / scale,
    tinyPixels: 12 / scale
  };
}
