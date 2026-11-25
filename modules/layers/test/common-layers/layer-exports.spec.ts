// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {AnimationLayer, BlockLayer, FastTextLayer} from '@deck.gl-community/layers/common-layers';
import {TimeDeltaLayer} from '@deck.gl-community/layers/timeline-layers';
import {expect, it} from 'vitest';

it('exports layers from the common and timeline subpaths', () => {
  expect(
    [AnimationLayer, BlockLayer, FastTextLayer, TimeDeltaLayer].map(layer => layer.layerName)
  ).toEqual(['AnimationLayer', 'BlockLayer', 'FastTextLayer', 'TimeDeltaLayer']);
});
