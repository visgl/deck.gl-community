// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import * as GeoLayers from '../../src/geo-layers';
import * as SharedTilesetSurface from '../../src/geo-layers/tileset/index';

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

it('exports isGlobeViewport', () => {
  expect(GeoLayers.isGlobeViewport).toBeTypeOf('function');
});
