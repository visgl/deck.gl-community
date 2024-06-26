// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * A multiplier for screen-space width/scale for Arc, Line, Icon and Text layers.
 * Required in order to maintain the same appearance after upgrading to deck.gl v8.5.
 * https://github.com/visgl/deck.gl/blob/master/docs/upgrade-guide.md
 */
export const PROJECTED_PIXEL_SIZE_MULTIPLIER = 2 / 3;

/**
 * Unit literal to shader unit number conversion.
 */
export const UNIT = {
  common: 0,
  meters: 1,
  pixels: 2
};
