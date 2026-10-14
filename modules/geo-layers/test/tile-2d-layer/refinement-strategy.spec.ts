// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {SharedTile2DLayer, SharedTileset2D} from '../../src';
import {SharedTile2DView} from '../../src/shared-tile-2d-layer/shared-tile-2d-view';

// Tile visibility is held per view, so a function receiving the shared tile headers cannot change
// what draws. The tileset rejects one instead of accepting it and ignoring what it does.

const hideEveryTile = (tiles: any[]) => {
  for (const tile of tiles) {
    tile.isVisible = false;
  }
};

describe('SharedTileset2D refinementStrategy', () => {
  it('rejects a refinement function at construction', () => {
    expect(
      () => new SharedTileset2D({getTileData: () => [], refinementStrategy: hideEveryTile as any})
    ).toThrow(/refinementStrategy must be .* not a function/);
  });

  it('rejects a refinement function in setOptions and keeps the current strategy', () => {
    const tileset = new SharedTileset2D({getTileData: () => [], refinementStrategy: 'no-overlap'});
    try {
      expect(() => tileset.setOptions({refinementStrategy: hideEveryTile as any})).toThrow(
        /not a function/
      );
      expect(tileset.refinementStrategy).toBe('no-overlap');
    } finally {
      tileset.finalize();
    }
  });

  it('rejects an unknown strategy name', () => {
    expect(
      () => new SharedTileset2D({getTileData: () => [], refinementStrategy: 'replace' as any})
    ).toThrow(/not "replace"/);
  });

  it('accepts the three named strategies and draws selected tiles with each', async () => {
    for (const refinementStrategy of ['best-available', 'no-overlap', 'never'] as const) {
      const tileset = new SharedTileset2D({
        getTileData: () => [],
        maxRequests: 0,
        refinementStrategy
      });
      const view = new SharedTile2DView(tileset);
      try {
        const viewport = new WebMercatorViewport({
          width: 256,
          height: 256,
          longitude: 0,
          latitude: 0,
          zoom: 3
        });
        view.update(viewport);
        await new Promise(resolve => setTimeout(resolve, 0));
        view.update(viewport);
        const selected = view.selectedTiles || [];
        expect(selected.length, refinementStrategy).toBeGreaterThan(0);
        expect(
          selected.every(tile => view.isTileVisible(tile)),
          refinementStrategy
        ).toBe(true);
      } finally {
        view.finalize();
        tileset.finalize();
      }
    }
  });

  it('reports a refinement function passed to SharedTile2DLayer', () => {
    const layer = new SharedTile2DLayer({
      id: 'tiles',
      data: 'https://example.com/{z}/{x}/{y}',
      refinementStrategy: hideEveryTile as any
    });
    expect(() => new SharedTileset2D((layer as any)._getTilesetOptions())).toThrow(
      /not a function/
    );
  });
});
