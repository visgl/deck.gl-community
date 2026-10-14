// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import type {TileSource} from '@loaders.gl/loader-utils';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {SharedTile2DLayer} from '../../src';

// A layer selects its tiles again when a prop or TileSource metadata changes what covers the
// viewport, without waiting for the viewport to move, as deck.gl's TileLayer does.

const VIEW_STATE = {longitude: 0, latitude: 0, zoom: 5};

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

function createDeck(layer: SharedTile2DLayer): Deck<any> {
  parent = document.createElement('div');
  document.body.append(parent);
  deck = new Deck({
    parent,
    width: 128,
    height: 128,
    deviceProps: {adapters: [webgl2Adapter]},
    views: new MapView({id: 'main'}),
    viewState: VIEW_STATE,
    layers: [layer]
  });
  return deck;
}

/** The zoom levels of the tiles the layer's tileset selected. */
function selectedZooms(): number[] {
  const layer: any = (deck as any).layerManager?.getLayers().find((l: any) => l.id === 'tiles');
  const tiles = layer?.state?.tileset?.selectedTiles || [];
  return [...new Set<number>(tiles.map((tile: any) => tile.index.z))];
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  throw new Error(message);
}

describe('SharedTile2DLayer reselects tiles without a viewport change', () => {
  test('when maxZoom changes', async () => {
    const props = {
      id: 'tiles',
      data: 'https://example.com/{z}/{x}/{y}',
      getTileData: () => [],
      renderSubLayers: () => null
    };
    createDeck(new SharedTile2DLayer(props));
    await waitFor(() => selectedZooms().join() === '5', 'expected z5 tiles at zoom 5');

    deck!.setProps({layers: [new SharedTile2DLayer({...props, maxZoom: 2})]});
    await waitFor(
      () => selectedZooms().join() === '2',
      'expected z2 tiles after maxZoom changed to 2'
    );
    expect(selectedZooms()).toEqual([2]);
  }, 30_000);

  test('when TileSource metadata arrives after the first frame', async () => {
    let resolveMetadata: (metadata: unknown) => void = () => {};
    const tileSource = {
      getMetadata: () =>
        new Promise(resolve => {
          resolveMetadata = resolve;
        }),
      getTile: () => Promise.resolve(null),
      getTileData: () => Promise.resolve([])
    } as unknown as TileSource;
    createDeck(new SharedTile2DLayer({id: 'tiles', data: tileSource, renderSubLayers: () => null}));
    await waitFor(() => selectedZooms().join() === '5', 'expected z5 tiles before metadata');

    resolveMetadata({maxZoom: 2});
    await waitFor(
      () => selectedZooms().join() === '2',
      'expected z2 tiles after TileSource metadata set maxZoom to 2'
    );
    expect(selectedZooms()).toEqual([2]);
  }, 30_000);
});
