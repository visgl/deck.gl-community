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

  it('applies each named strategy while the selected tiles load', async () => {
    const viewportAt = (zoom: number) =>
      new WebMercatorViewport({width: 256, height: 256, longitude: 0, latitude: 0, zoom});
    const drawnZooms: Record<string, number[]> = {};
    for (const refinementStrategy of ['best-available', 'no-overlap', 'never'] as const) {
      // z3 tiles load at once; z4 tiles never do.
      const tileset = new SharedTileset2D({
        getTileData: ({index}) => (index.z === 3 ? [] : new Promise<never>(() => {})),
        maxRequests: 0,
        refinementStrategy
      });
      const view = new SharedTile2DView(tileset);
      try {
        view.update(viewportAt(3));
        await new Promise(resolve => setTimeout(resolve, 0));
        view.update(viewportAt(4));
        const drawn = tileset.tiles.filter(tile => view.isTileVisible(tile));
        drawnZooms[refinementStrategy] = [...new Set(drawn.map(tile => tile.index.z))];
      } finally {
        view.finalize();
        tileset.finalize();
      }
    }
    // The loaded z3 parents stand in for the loading z4 tiles, except with 'never'.
    expect(drawnZooms).toEqual({'best-available': [3], 'no-overlap': [3], never: [4]});
  });

  it('rejects a refinement function passed to SharedTile2DLayer, with its own or a shared tileset', () => {
    for (const data of [
      'https://example.com/{z}/{x}/{y}',
      new SharedTileset2D({getTileData: () => []})
    ]) {
      const layer: any = new SharedTile2DLayer({
        id: 'tiles',
        data,
        refinementStrategy: hideEveryTile as any
      });
      expect(() => layer.updateState({changeFlags: {}})).toThrow(/not a function/);
    }
  });
});
