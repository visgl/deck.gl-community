// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import * as GeoLayers from '../src/index';

it('exports TileSourceLayer', () => {
  expect(GeoLayers.TileSourceLayer).toBeDefined();
});

it('exports Tile2DLayer and Tile2DTileset', () => {
  expect(GeoLayers.Tile2DLayer).toBeDefined();
  expect(GeoLayers.Tile2DTileset).toBeDefined();
  expect(GeoLayers.TileGridLayer).toBeDefined();
});

it('exports GlobalGridLayer', () => {
  expect(GeoLayers.GlobalGridLayer).toBeDefined();
});

it('exports grid systems', () => {
  expect(GeoLayers.H3Grid).toBeDefined();
  expect(GeoLayers.S2Grid).toBeDefined();
  expect(GeoLayers.GeohashGrid).toBeDefined();
  expect(GeoLayers.QuadkeyGrid).toBeDefined();
});
