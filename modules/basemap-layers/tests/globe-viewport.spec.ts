// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test} from 'vitest';
import {_GlobeViewport as GlobeViewport, WebMercatorViewport} from '@deck.gl/core';
import {BasemapLayer} from '../src/basemap-layer';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const camera = {width: 256, height: 256, longitude: 10, latitude: 20, zoom: 2, bearing: 40};
/** deck.gl 9.4 sets `resolution` to 10 on a globe. */
const globe94 = new GlobeViewport(camera);
/** deck.gl v10 sets `resolution` to 0 on every viewport, a globe included. */
const globeV10 = new GlobeViewport({...camera, resolution: 0});
const map = new WebMercatorViewport(camera);

describe('globe viewport detection', () => {
  test('a globe BasemapLayer draws its globe sublayers on a globe with resolution 0', () => {
    const layer = new BasemapLayer({id: 'basemap', style: null, mode: 'globe'} as any);
    expect(layer.getDrawMode(globe94)).toBe('globe');
    expect(layer.getDrawMode(globeV10)).toBe('globe');
    expect(layer.getDrawMode(map)).toBe('map');
  });

  test('line labels keep a bearing of 0 on a globe with resolution 0', () => {
    const layer = new MVTLabelLayer({id: 'labels'} as any);
    expect(layer.getBearingStep(globe94)).toBe(0);
    expect(layer.getBearingStep(globeV10)).toBe(0);
    expect(layer.getBearingStep(map)).not.toBe(0);
  });
});
