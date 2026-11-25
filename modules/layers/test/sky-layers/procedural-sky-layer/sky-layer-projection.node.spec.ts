// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GlobeViewport, OrbitViewport, type Viewport} from '@deck.gl/core';
import {expect, it} from 'vitest';
import {getClipToLocal} from '../../../src/sky-layers/procedural-sky-layer/procedural-sky-layer';

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

it('uses the Y-up axis from an orbit viewport without its prototype', () => {
  const orbit = new OrbitViewport({
    width: 320,
    height: 240,
    target: [0, 0, 0],
    orbitAxis: 'Y',
    rotationX: 22,
    rotationOrbit: 30
  });
  const foreignViewport = {
    orbitAxis: orbit.orbitAxis,
    viewMatrix: orbit.viewMatrix,
    viewMatrixUncentered: orbit.viewMatrixUncentered,
    projectionMatrix: orbit.projectionMatrix
  } as Viewport;

  expect(getClipToLocal(foreignViewport)).toEqual(getClipToLocal(orbit));
});
