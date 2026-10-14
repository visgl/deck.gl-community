// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {SharedTileset2D} from '../../src';
import {SharedTile2DView} from '../../src/shared-tile-2d-layer/shared-tile-2d-view';

function viewportAt(longitude: number) {
  return new WebMercatorViewport({width: 256, height: 256, longitude, latitude: 0, zoom: 8});
}

/** Tiles this view keeps per-view state for. The state map is private; the test reads it. */
function tilesWithViewState(view: SharedTile2DView): object[] {
  return [...(view as any)._state.keys()];
}

describe('SharedTile2DView and cache eviction', () => {
  it('keeps no state for tiles the shared tileset evicted', async () => {
    const tileset = new SharedTileset2D({
      getTileData: () => ({payload: new Array(1000).fill(0)}),
      maxRequests: 0,
      maxCacheSize: 4
    });
    const view = new SharedTile2DView(tileset);
    let unloaded = 0;
    const unsubscribe = tileset.subscribe({onTileUnload: () => unloaded++});
    try {
      // Pan across 40 positions, letting each position's tiles load.
      for (let i = 0; i < 40; i++) {
        view.update(viewportAt(-170 + i * 8));
        await new Promise(resolve => setTimeout(resolve, 0));
        view.update(viewportAt(-170 + i * 8));
      }

      expect(unloaded, 'the pan evicts tiles').toBeGreaterThan(100);
      const cachedTiles = new Set<object>(tileset.tiles);
      const evicted = tilesWithViewState(view).filter(tile => !cachedTiles.has(tile));
      expect(evicted).toHaveLength(0);
      expect(tilesWithViewState(view).length).toBeLessThanOrEqual(tileset.tiles.length);
    } finally {
      unsubscribe();
      view.finalize();
      tileset.finalize();
    }
  });

  it('drops the state of a tile another consumer evicted at its next update', async () => {
    const tileset = new SharedTileset2D({getTileData: () => [], maxRequests: 0, maxCacheSize: 6});
    const view = new SharedTile2DView(tileset);
    const other = new SharedTile2DView(tileset);
    try {
      view.update(viewportAt(0));
      await new Promise(resolve => setTimeout(resolve, 0));
      // Move away so this view's earlier tiles are neither selected nor visible.
      view.update(viewportAt(120));
      await new Promise(resolve => setTimeout(resolve, 0));
      const heldBefore = new Set(tilesWithViewState(view));

      // The other consumer's tiles push this view's unused tiles out of the cache.
      other.update(viewportAt(-120));
      await new Promise(resolve => setTimeout(resolve, 0));
      other.update(viewportAt(-120));
      const cachedTiles = new Set<object>(tileset.tiles);
      expect([...heldBefore].some(tile => !cachedTiles.has(tile))).toBe(true);

      view.update(viewportAt(120));
      const evicted = tilesWithViewState(view).filter(
        tile => !new Set<object>(tileset.tiles).has(tile)
      );
      expect(evicted).toHaveLength(0);
    } finally {
      other.finalize();
      view.finalize();
      tileset.finalize();
    }
  });
});
