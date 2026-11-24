// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AnimationLayer,
  BlockLayer,
  FastTextLayer,
  TimeDeltaLayer
} from '@deck.gl-community/layers/infovis-layers';
import {expect, it} from 'vitest';

it('exports Infovis layers from the Layers package subpath', () => {
  expect(
    [AnimationLayer, BlockLayer, FastTextLayer, TimeDeltaLayer].map(layer => layer.layerName)
  ).toEqual(['AnimationLayer', 'BlockLayer', 'FastTextLayer', 'TimeDeltaLayer']);
});
