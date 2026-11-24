// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GlobeViewport, type Viewport} from '@deck.gl/core';
import {expect, it} from 'vitest';
import {getClipToLocal} from '../../../src/wind-layers/sky-layer/sky-layer';

it('orients globe rays the same way for a viewport from a different deck.gl copy', () => {
  const globe = new GlobeViewport({width: 320, height: 240, longitude: 137, latitude: -35});
  const foreignViewport = {
    projectionMode: globe.projectionMode,
    viewMatrix: globe.viewMatrix,
    viewMatrixUncentered: globe.viewMatrixUncentered,
    projectionMatrix: globe.projectionMatrix,
    longitude: globe.longitude,
    latitude: globe.latitude
  } as Viewport;

  expect(getClipToLocal(foreignViewport)).toEqual(getClipToLocal(globe));
});
