// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createRequire} from 'node:module';
import {expect, it, vi} from 'vitest';

it('reads the scene wind across the CommonJS package subpaths', () => {
  const require = createRequire(import.meta.url);
  const {GrassLayer} = require('@deck.gl-community/layers/vegetation-layers/grass-layer');
  const {WindEffect} = require('@deck.gl-community/layers/wind-layers/wind-effect');
  const deck = {};
  new WindEffect({strength: 0.7, direction: 90, time: 2}).setup({deck});
  const setProps = vi.fn();
  const layer = new GrassLayer();
  Object.assign(layer, {
    context: {deck, timeline: {getTime: () => 0}},
    state: {model: {shaderInputs: {setProps}, setVertexCount: vi.fn(), draw: vi.fn()}}
  });

  layer.draw({renderPass: null});
  const {wind} = setProps.mock.calls[0][0].grass;
  expect(wind[0]).toBeCloseTo(1);
  expect(wind[1]).toBeCloseTo(0);
  expect(wind.slice(2)).toEqual([0.7, 2]);
});
