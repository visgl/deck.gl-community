// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import * as GeoLayers from '../src/index';
import * as SharedTilesetSurface from '../src/tileset/index';

it('exports TileSourceLayer', () => {
  expect(GeoLayers.TileSourceLayer).toBeDefined();
});

it('exports SharedTile2DLayer and SharedTileset2D', () => {
  expect(GeoLayers.SharedTile2DLayer).toBeDefined();
  expect(GeoLayers.SharedTileset2D).toBeDefined();
  expect(GeoLayers.sharedTile2DDeckAdapter).toBeDefined();
  expect(GeoLayers.TileGridLayer).toBeDefined();
});

it('exports the tileset sub-surface', () => {
  expect(SharedTilesetSurface.SharedTileset2D).toBeDefined();
  expect(SharedTilesetSurface.SharedTile2DHeader).toBeDefined();
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
