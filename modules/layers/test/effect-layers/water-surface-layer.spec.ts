// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {LayerContext} from '@deck.gl/core';
import type {Buffer} from '@luma.gl/core';
import {expect, it, vi} from 'vitest';
import {WaterSurfaceLayer} from '../../src/effect-layers';

it('releases the water model when Deck finalizes the layer and preserves the borrowed buffer', () => {
  const positions = {destroy: vi.fn()};
  const model = {destroy: vi.fn()};
  const layer = new WaterSurfaceLayer({positions: positions as unknown as Buffer, vertexCount: 3});
  Object.assign(layer, {state: {model}});
  layer.finalizeState({} as LayerContext);
  expect(model.destroy).toHaveBeenCalledOnce();
  expect(positions.destroy).not.toHaveBeenCalled();
});
