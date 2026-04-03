// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {OrthographicViewport, WebMercatorViewport} from '@deck.gl/core';
import type {TileSource} from '@loaders.gl/loader-utils';
import {Tile2DLayer, Tile2DTileset} from '../../src';
import {Tile2DView} from '../../src/tileset-2d-v2/tile-2d-view';

type TestTileData = Array<{tileId: string}> & {byteLength?: number};

function createMockTileSource(
  overrides: Partial<TileSource> & {
    getMetadata?: TileSource['getMetadata'];
    getTileData?: TileSource['getTileData'];
  } = {}
): TileSource {
  return {
    getMetadata: () => Promise.resolve({
      minZoom: 1,
      maxZoom: 4,
      boundingBox: [
        [-10, -20],
        [30, 40]
      ]
    }),
    getTile: () => Promise.resolve(null),
    getTileData: ({id}) => {
      const result = [{tileId: id}] as TestTileData;
      result.byteLength = 16;
      return Promise.resolve(result);
    },
    ...overrides
  };
}

function expectSharedTilesetState(
  sharedTileset: Tile2DTileset<TestTileData>,
  leftTileIds: Set<string>,
  rightTileIds: Set<string>,
  statsChangeCount: number
): void {
  expect(leftTileIds.size).toBeGreaterThan(0);
  expect(rightTileIds.size).toBeGreaterThan(0);
  expect([...leftTileIds].some(id => !rightTileIds.has(id))).toBe(true);
  expect(sharedTileset.tiles.length).toBeGreaterThanOrEqual(leftTileIds.size + rightTileIds.size - 1);
  expect(sharedTileset.visibleTiles.length).toBeGreaterThanOrEqual(
    Math.max(leftTileIds.size, rightTileIds.size)
  );
  expect(sharedTileset.visibleTiles.some(tile => leftTileIds.has(tile.id))).toBe(true);
  expect(sharedTileset.visibleTiles.some(tile => rightTileIds.has(tile.id))).toBe(true);
  expect(sharedTileset.stats.get('Visible Tiles').count).toBe(sharedTileset.visibleTiles.length);
  expect(sharedTileset.stats.get('Tiles In Cache').count).toBe(sharedTileset.tiles.length);
  expect(sharedTileset.stats.get('Cache Size').count).toBeGreaterThan(0);
  expect(sharedTileset.stats.get('Unloaded Tiles').count).toBeGreaterThanOrEqual(0);
  expect(sharedTileset.stats.get('Consumers').count).toBe(2);
  expect(statsChangeCount).toBeGreaterThan(0);
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

describe('Tile2DLayer', () => {
  it('exports from the package surface', () => {
    expect(Tile2DLayer).toBeDefined();
    expect(Tile2DTileset).toBeDefined();
  });

  it('builds URL-template requests through the layer path', () => {
    let requestedUrl: string | undefined | null;
    const layer = new Tile2DLayer({
      id: 'tile-2d-url-template',
      data: 'https://example.com/{z}/{x}/{y}.json',
      getTileData: tile => {
        requestedUrl = tile.url;
        return null;
      }
    });

    const tileData = layer.getTileData({
      index: {x: 3, y: 5, z: 2},
      id: '3-5-2',
      bbox: {west: 0, south: 0, east: 1, north: 1},
      zoom: 2
    });

    expect(tileData).toBeNull();
    expect(requestedUrl).toBe('https://example.com/2/3/5.json');
  });

  it('adopts TileSource metadata with explicit overrides winning', async () => {
    const tileset = Tile2DTileset.fromTileSource(createMockTileSource(), {minZoom: 2});
    await waitFor(() => tileset.maxZoom === 4, 'expected TileSource metadata to resolve');
    expect(tileset.minZoom).toBe(2);
    expect(tileset.maxZoom).toBe(4);
    expect((tileset as any).opts.extent).toEqual([-10, -20, 30, 40]);
    tileset.finalize();
  });

  it('accepts TileSource data in Tile2DLayer options', () => {
    const source = createMockTileSource();
    const layer = new Tile2DLayer({
      id: 'tile-2d-source',
      data: source
    });

    const tilesetOptions = (layer as any)._getTilesetOptions();
    expect(tilesetOptions.tileSource).toBe(source);
    expect(tilesetOptions.getTileData).toBeUndefined();
  });

  it('shares one Tile2DTileset across multiple consumers and views', async () => {
    const sharedTileset = Tile2DTileset.fromTileSource<TestTileData>(createMockTileSource());
    const leftView = new Tile2DView(sharedTileset);
    const rightView = new Tile2DView(sharedTileset);
    let statsChangeCount = 0;
    const unsubscribe = sharedTileset.subscribe({
      onStatsChange: () => {
        statsChangeCount++;
      }
    });

    const leftViewport = new OrthographicViewport({
      id: 'left',
      width: 200,
      height: 200,
      target: [100, 100],
      zoom: 1
    });
    const rightViewport = new OrthographicViewport({
      id: 'right',
      width: 200,
      height: 200,
      target: [500, 500],
      zoom: 1
    });

    try {
      leftView.update(leftViewport);
      rightView.update(rightViewport);

      await waitFor(
        () => Boolean(leftView.isLoaded && rightView.isLoaded),
        'expected both views to finish loading shared tiles'
      );
      leftView.update(leftViewport);
      rightView.update(rightViewport);

      const leftTileIds = new Set(leftView.selectedTiles?.map(tile => tile.id));
      const rightTileIds = new Set(rightView.selectedTiles?.map(tile => tile.id));

      expectSharedTilesetState(sharedTileset, leftTileIds, rightTileIds, statsChangeCount);

      leftView.finalize();
      rightView.update(rightViewport);
      expect(rightView.selectedTiles?.length).toBeGreaterThan(0);
    } finally {
      unsubscribe();
      rightView.finalize();
      sharedTileset.finalize();
    }
  });

  it('evicts least recently used non-visible tiles once the cache exceeds the high-water mark', () => {
    const tileset = new Tile2DTileset({
      getTileData: () => null,
      maxCacheSize: 2
    });
    const viewport = new OrthographicViewport({
      id: 'cache-test',
      width: 256,
      height: 256,
      target: [0, 0],
      zoom: 1
    });
    (tileset as any)._lastViewport = viewport;

    const consumerId = Symbol('consumer');
    tileset.attachConsumer(consumerId);

    const tile1 = tileset.getTile({x: 0, y: 0, z: 1}, true);
    const tile2 = tileset.getTile({x: 1, y: 0, z: 1}, true);
    tileset.updateConsumer(consumerId, [tile1, tile2], [tile1, tile2]);

    tileset.getTile({x: 0, y: 0, z: 1}, true);

    const tile3 = tileset.getTile({x: 0, y: 1, z: 1}, true);
    tileset.updateConsumer(consumerId, [tile3], [tile3]);

    expect(tileset.tiles.map(tile => tile.id)).toContain('0-0-1');
    expect(tileset.tiles.map(tile => tile.id)).toContain('0-1-1');
    expect(tileset.tiles.map(tile => tile.id)).not.toContain('1-0-1');
    expect(tileset.stats.get('Tiles In Cache').count).toBe(2);
    expect(tileset.stats.get('Unloaded Tiles').count).toBe(2);

    tileset.detachConsumer(consumerId);
    tileset.finalize();
  });

  it('does not finalize an external shared tileset when the layer finalizes', async () => {
    const sharedTileset = Tile2DTileset.fromTileSource<TestTileData>(createMockTileSource());
    const layer = new Tile2DLayer({
      id: 'tile-2d-external-tileset',
      data: sharedTileset
    });
    const externalView = new Tile2DView(sharedTileset);
    const viewport = new WebMercatorViewport({
      width: 256,
      height: 256,
      longitude: 0,
      latitude: 0,
      zoom: 2
    });

    externalView.update(viewport);
    await waitFor(() => externalView.isLoaded, 'expected shared tileset to load before finalization');

    (layer as any).state = {
      tileset: sharedTileset,
      tilesetViews: new Map(),
      ownsTileset: false,
      isLoaded: false,
      frameNumbers: new Map(),
      tileLayers: new Map(),
      unsubscribeTilesetEvents: null
    };

    layer.finalizeState();

    externalView.update(viewport);
    expect(sharedTileset.tiles.length).toBeGreaterThan(0);

    externalView.finalize();
    sharedTileset.finalize();
  });

  it('requests an update when a new viewport is activated', () => {
    const layer = new Tile2DLayer({
      id: 'tile-2d-activate-viewport',
      data: createMockTileSource()
    });
    let updatesRequested = 0;
    (layer as any).setNeedsUpdate = () => {
      updatesRequested++;
    };

    const minimapViewport = new WebMercatorViewport({
      id: 'minimap',
      width: 256,
      height: 256,
      longitude: 0,
      latitude: 0,
      zoom: 2
    });

    layer.activateViewport(minimapViewport);
    expect(updatesRequested).toBe(1);

    layer.activateViewport(minimapViewport);
    expect(updatesRequested).toBe(1);
  });
});
