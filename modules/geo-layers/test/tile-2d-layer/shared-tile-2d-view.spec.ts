// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {_Tileset2D as Tileset2D} from '@deck.gl/geo-layers';
import {SharedTileset2D} from '../../src';
import {SharedTile2DView} from '../../src/shared-tile-2d-layer/shared-tile-2d-view';

// The tiles a shared tileset view draws, step by step, against deck.gl's own `Tileset2D` with the
// same tiles loaded: placeholders while tiles load, and the selected tiles once they have.

type Strategy = 'best-available' | 'no-overlap';

function viewportAt(zoom: number) {
  return new WebMercatorViewport({width: 256, height: 256, longitude: 0, latitude: 0, zoom});
}

/** Tile data that resolves only when its zoom is released, as tiles arrive. */
function createLoader() {
  const pending = new Map<number, (() => void)[]>();
  const released = new Set<number>();
  return {
    getTileData: ({index}: {index: {z: number}}) =>
      released.has(index.z)
        ? Promise.resolve([index.z])
        : new Promise(resolve => {
            const list = pending.get(index.z) || [];
            list.push(() => resolve([index.z]));
            pending.set(index.z, list);
          }),
    /** Loads every requested tile of zoom `z`, and those requested later. */
    async release(z: number) {
      released.add(z);
      for (const resolve of pending.get(z) || []) resolve();
      pending.delete(z);
      // Let the tilesets see the loaded data.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
}

type Step = {zoom: number; load?: number[]};

/** The ids of the tiles each tileset draws after each step, deck.gl's and the shared one's. */
async function drawnTiles(strategy: Strategy, steps: Step[]) {
  const deckLoader = createLoader();
  const sharedLoader = createLoader();
  const deckTileset = new Tileset2D({
    getTileData: deckLoader.getTileData as any,
    refinementStrategy: strategy,
    maxRequests: 0,
    tileSize: 512
  } as any);
  const sharedTileset = new SharedTileset2D({
    getTileData: sharedLoader.getTileData as any,
    refinementStrategy: strategy,
    maxRequests: 0,
    tileSize: 512
  } as any);
  const view = new SharedTile2DView(sharedTileset as any);
  const result: {deck: string[]; shared: string[]}[] = [];
  for (const {zoom, load = []} of steps) {
    const viewport = viewportAt(zoom);
    deckTileset.update(viewport as any);
    view.update(viewport as any);
    for (const z of load) {
      await deckLoader.release(z);
      await sharedLoader.release(z);
    }
    // After the tiles load, as the layers update again.
    deckTileset.update(viewport as any);
    view.update(viewport as any);
    result.push({
      deck: (deckTileset.tiles as any[])
        .filter(tile => tile.isVisible)
        .map(tile => tile.id)
        .sort(),
      shared: (sharedTileset.tiles as any[])
        .filter(tile => view.isTileVisible(tile))
        .map(tile => tile.id)
        .sort()
    });
  }
  return result;
}

const Z4 = ['7-7-4', '7-8-4', '8-7-4', '8-8-4'];
const Z5 = ['15-15-5', '15-16-5', '16-15-5', '16-16-5'];

describe('SharedTile2DView refinement', () => {
  for (const strategy of ['best-available', 'no-overlap'] as Strategy[]) {
    describe(strategy, () => {
      it('draws the loaded selected tiles after zooming in, not their loaded parents', async () => {
        const steps = await drawnTiles(strategy, [
          {zoom: 4.1, load: [4]},
          {zoom: 4.9, load: [5]}
        ]);
        expect(steps[0].shared).toEqual(Z4);
        expect(steps[1].shared).toEqual(Z5);
        expect(steps.map(step => step.shared)).toEqual(steps.map(step => step.deck));
      });

      it('draws the loaded parents while the selected tiles load', async () => {
        const steps = await drawnTiles(strategy, [{zoom: 4.1, load: [4]}, {zoom: 4.9}]);
        expect(steps[1].deck).toEqual(Z4);
        expect(steps.map(step => step.shared)).toEqual(steps.map(step => step.deck));
      });

      it('draws loaded parents while the selected tiles load, without also their grandchildren', async () => {
        const steps = await drawnTiles(strategy, [
          {zoom: 5.9, load: [6]},
          {zoom: 4.1, load: [4]},
          {zoom: 4.9}
        ]);
        expect(steps.map(step => step.shared)).toEqual(steps.map(step => step.deck));
      });

      it('draws the loaded children while the selected tiles load after zooming out', async () => {
        const steps = await drawnTiles(strategy, [{zoom: 4.9, load: [5]}, {zoom: 4.1}]);
        expect(steps[1].deck).toEqual(Z5);
        expect(steps.map(step => step.shared)).toEqual(steps.map(step => step.deck));
      });

      it('draws loaded grandchildren while the selected tiles and their children load', async () => {
        const steps = await drawnTiles(strategy, [{zoom: 5.9, load: [6]}, {zoom: 4.1}]);
        expect(steps[1].deck.length).toBeGreaterThan(0);
        expect(steps.map(step => step.shared)).toEqual(steps.map(step => step.deck));
      });

      it('draws loaded grandchildren under requested children that have not loaded', async () => {
        const steps = await drawnTiles(strategy, [
          {zoom: 5.9, load: [6]},
          {zoom: 4.9},
          {zoom: 4.1}
        ]);
        expect(steps[2].deck.length).toBeGreaterThan(0);
        expect(steps.map(step => step.shared)).toEqual(steps.map(step => step.deck));
      });

      it('draws the selected tiles once they load after zooming out', async () => {
        const steps = await drawnTiles(strategy, [
          {zoom: 4.9, load: [5]},
          {zoom: 4.1, load: [4]}
        ]);
        expect(steps[1].deck).toEqual(Z4);
        expect(steps.map(step => step.shared)).toEqual(steps.map(step => step.deck));
      });
    });
  }
});
