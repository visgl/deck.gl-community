// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import * as GeoLayers from '../src/index';
import type {WindFieldOptions} from '../src/index';
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

it('exports the reusable wind showcase layers and field utilities', () => {
  expect(GeoLayers.WindLayer).toBeDefined();
  expect(GeoLayers.ParticleLayer).toBeDefined();
  expect(GeoLayers.DelaunayCoverLayer).toBeDefined();
  expect(GeoLayers.ElevationLayer).toBeDefined();
  expect(GeoLayers.DelaunayInterpolation).toBeDefined();
  expect(GeoLayers.createWindField).toBeDefined();
  expect(GeoLayers.getWindBounds).toBeDefined();
  expect(GeoLayers.parseWindData).toBeDefined();
  expect(GeoLayers.sampleWindField).toBeDefined();
  expect(GeoLayers.triangulateWindStations).toBeDefined();
});

it('exports typed wind field options', () => {
  const options: WindFieldOptions = {triangles: [[0, 1, 2]]};
  expect(options.triangles).toEqual([[0, 1, 2]]);
});

it('exports grid systems', () => {
  expect(GeoLayers.H3Grid).toBeDefined();
  expect(GeoLayers.S2Grid).toBeDefined();
  expect(GeoLayers.GeohashGrid).toBeDefined();
  expect(GeoLayers.QuadkeyGrid).toBeDefined();
});
