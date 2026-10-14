// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import type {TileSource} from '@loaders.gl/loader-utils';
import {SharedTileset2D} from '../../src';
import {SharedTile2DView} from '../../src/shared-tile-2d-layer/shared-tile-2d-view';

// deck.gl's `Tileset2D.setOptions` forgets its viewport, so the next update selects tiles again
// even when the viewport has not moved. A shared tileset's views must do the same when an option
// that decides tile selection changes, or when TileSource metadata arrives.

function viewportAt(zoom: number) {
  return new WebMercatorViewport({width: 256, height: 256, longitude: 0, latitude: 0, zoom});
}

/** The distinct zoom levels of the tiles a view selected. */
function selectedZooms(view: SharedTile2DView): number[] {
  return [...new Set((view.selectedTiles || []).map(tile => tile.index.z))];
}

describe('SharedTile2DView after a tileset option change', () => {
  it('reselects tiles for an unchanged viewport when maxZoom changes', () => {
    const tileset = new SharedTileset2D({getTileData: () => [], maxRequests: 0});
    const view = new SharedTile2DView(tileset);
    try {
      view.update(viewportAt(5));
      expect(selectedZooms(view)).toEqual([5]);

      tileset.setOptions({maxZoom: 2});
      view.update(viewportAt(5));
      expect(selectedZooms(view)).toEqual([2]);
    } finally {
      view.finalize();
      tileset.finalize();
    }
  });

  it('reselects tiles for an unchanged viewport when zoomOffset or minZoom changes', () => {
    const tileset = new SharedTileset2D({getTileData: () => [], maxRequests: 0});
    const view = new SharedTile2DView(tileset);
    try {
      view.update(viewportAt(3));
      expect(selectedZooms(view)).toEqual([3]);

      tileset.setOptions({zoomOffset: 1});
      view.update(viewportAt(3));
      expect(selectedZooms(view)).toEqual([4]);

      // Below minZoom and without an extent, deck.gl's traversal selects no tiles.
      tileset.setOptions({zoomOffset: 0, minZoom: 6});
      view.update(viewportAt(3));
      expect(selectedZooms(view)).toEqual([]);
    } finally {
      view.finalize();
      tileset.finalize();
    }
  });

  it('reselects tiles for an unchanged viewport when extent changes', () => {
    const tileset = new SharedTileset2D({getTileData: () => [], maxRequests: 0});
    const view = new SharedTile2DView(tileset);
    try {
      view.update(viewportAt(3));
      expect(view.selectedTiles?.length).toBeGreaterThan(1);

      // A box east of the meridian and north of the equator, inside one z3 tile.
      tileset.setOptions({extent: [10, 10, 20, 20]});
      view.update(viewportAt(3));
      expect(view.selectedTiles?.map(tile => tile.id)).toEqual(['4-3-3']);
    } finally {
      view.finalize();
      tileset.finalize();
    }
  });

  it('keeps its selection when setOptions changes nothing that selects tiles', () => {
    const tileset = new SharedTileset2D({
      getTileData: () => [],
      maxRequests: 0,
      extent: [-180, -85, 180, 85]
    });
    const view = new SharedTile2DView(tileset);
    try {
      view.update(viewportAt(3));
      const selection = view.selectedTiles;

      tileset.setOptions({extent: [-180, -85, 180, 85], maxCacheSize: 50});
      view.update(viewportAt(3));
      expect(view.selectedTiles).toBe(selection);
    } finally {
      view.finalize();
      tileset.finalize();
    }
  });

  it('reselects tiles for an unchanged viewport when TileSource metadata arrives', async () => {
    let resolveMetadata: (metadata: Awaited<ReturnType<TileSource['getMetadata']>>) => void =
      () => {};
    const tileSource = {
      getMetadata: () =>
        new Promise(resolve => {
          resolveMetadata = resolve;
        }),
      getTile: () => Promise.resolve(null),
      getTileData: () => Promise.resolve([])
    } as unknown as TileSource;
    const tileset = SharedTileset2D.fromTileSource(tileSource, {maxRequests: 0});
    let updates = 0;
    const unsubscribe = tileset.subscribe({onUpdate: () => updates++});
    const view = new SharedTile2DView(tileset);
    try {
      view.update(viewportAt(5));
      expect(selectedZooms(view)).toEqual([5]);

      resolveMetadata({maxZoom: 2} as any);
      for (let i = 0; i < 5 && !updates; i++) {
        await Promise.resolve();
      }
      expect(updates).toBe(1);
      expect(tileset.maxZoom).toBe(2);

      // The layer updates its views with the same viewport when the tileset reports an update.
      view.update(viewportAt(5));
      expect(selectedZooms(view)).toEqual([2]);
    } finally {
      unsubscribe();
      view.finalize();
      tileset.finalize();
    }
  });
});
