// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it} from 'vitest';
import {getTreeLeafPaleness, getTreeLeafShaders} from '../../src/tree-layer/tree-photoreal-shaders';

it('keeps the opaque leaf passes eligible for early depth testing', () => {
  for (const blade of ['far', 'coarse', 'fine', 'macro'] as const) {
    expect(getTreeLeafShaders(blade).fs).not.toMatch(/\bdiscard\b/);
  }
});

it('pales a flip by the layer, so a leaf in a breeze carries nothing of it', () => {
  expect(getTreeLeafPaleness(0)).toEqual([0.85, 0.85, 0.85]);
  // Below force 0.06 nothing differs from a breeze.
  expect(getTreeLeafPaleness(0.05)).toEqual([0.85, 0.85, 0.85]);
  const gale = getTreeLeafPaleness(0.39);
  const storm = getTreeLeafPaleness(0.85);
  for (let channel = 0; channel < 3; channel++) {
    expect(gale[channel]).toBeGreaterThan(0.85);
    expect(storm[channel]).toBeGreaterThanOrEqual(gale[channel]);
  }
  // Silver, not yellow: the most in blue.
  expect(storm[2]).toBeGreaterThan(storm[1]);
  expect(storm[1]).toBeGreaterThan(storm[0]);
});
