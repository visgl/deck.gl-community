// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {WebMercatorViewport, _GlobeViewport as GlobeViewport} from '@deck.gl/core';
import {_Tileset2D as Tileset2D} from '@deck.gl/geo-layers';
import {SharedTileset2D, sharedTile2DDeckAdapter} from '../../src';

// The tiles the shared tileset selects for a viewport, against deck.gl's own `Tileset2D` for the
// same viewport. On a globe, deck.gl skips tiles on the far side of the horizon (`beyondHorizon`
// in its tile-2d-traversal); the shared traversal must skip the same ones.

type ZRange = [number, number] | null;

function deckTileIds(viewport: any, zRange: ZRange = null): string[] {
  const tileset = new Tileset2D({getTileData: () => null, tileSize: 512} as any);
  return tileset
    .getTileIndices({viewport, zRange} as any)
    .map(({x, y, z}) => `${x}-${y}-${z}`)
    .sort();
}

function sharedTileIds(viewport: any, zRange: ZRange = null): string[] {
  const tileset = new SharedTileset2D({
    getTileData: () => null,
    tileSize: 512,
    adapter: sharedTile2DDeckAdapter
  } as any);
  return tileset
    .getTileIndices({viewState: viewport, zRange})
    .map(({x, y, z}) => `${x}-${y}-${z}`)
    .sort();
}

const GLOBE_VIEWS = [
  // Low zooms, where a whole hemisphere is in view and the far side is inside the frustum.
  {name: 'zoom 2 over the Atlantic', longitude: -30, latitude: 20, zoom: 2},
  {name: 'zoom 2.5 over the Pacific', longitude: 170, latitude: -10, zoom: 2.5},
  {name: 'zoom 3 over Europe', longitude: 10, latitude: 50, zoom: 3},
  {name: 'zoom 1 over the pole', longitude: 0, latitude: 80, zoom: 1},
  // Pitched, so the horizon falls inside the view.
  {name: 'zoom 3 pitched 45', longitude: -100, latitude: 40, zoom: 3, pitch: 45},
  {
    name: 'zoom 4 pitched 60, bearing 30',
    longitude: 140,
    latitude: 35,
    zoom: 4,
    pitch: 60,
    bearing: 30
  },
  {name: 'zoom 6 pitched 50', longitude: 0, latitude: 0, zoom: 6, pitch: 50}
];

describe('SharedTileset2D tile selection on a globe', () => {
  for (const {name, ...view} of GLOBE_VIEWS) {
    // deck.gl scales elevation bounds to common units before passing them to `projectPosition`,
    // which reads them as metres, so on a globe 8 km of relief moves a tile's bounding volume and
    // horizon point by about 0.3 m. The shared traversal must match that, not correct it.
    for (const zRange of [null, [0, 8000]] as ZRange[]) {
      it(`matches deck.gl for ${name}${zRange ? ' with elevation bounds' : ''}`, () => {
        const viewport = new GlobeViewport({width: 800, height: 600, ...view});
        const deck = deckTileIds(viewport, zRange);
        expect(deck.length).toBeGreaterThan(0);
        expect(sharedTileIds(viewport, zRange)).toEqual(deck);
      });
    }
  }
});

describe('SharedTileset2D tile selection on web mercator', () => {
  const views = [
    {longitude: -30, latitude: 20, zoom: 2},
    {longitude: 10, latitude: 50, zoom: 5},
    {longitude: -100, latitude: 40, zoom: 8, pitch: 60, bearing: 20},
    {longitude: 140, latitude: 35, zoom: 12, pitch: 75}
  ];
  for (const view of views) {
    it(`matches deck.gl at zoom ${view.zoom}, pitch ${view.pitch ?? 0}`, () => {
      const viewport = new WebMercatorViewport({width: 800, height: 600, ...view});
      const deck = deckTileIds(viewport);
      expect(deck.length).toBeGreaterThan(0);
      expect(sharedTileIds(viewport)).toEqual(deck);
    });
  }
});
