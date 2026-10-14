// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {SharedTile2DLayer, SharedTileset2D} from '../../src';

// A view the deck no longer draws the layer in releases its hold on the shared tileset: its tiles
// are no longer selected (pinned against eviction) and its tileset consumer is detached.

const MAIN = new MapView({id: 'main', x: 0, width: '50%'});
const MINI = new MapView({id: 'mini', x: '50%', width: '50%'});
const VIEW_STATE = {
  main: {longitude: 0, latitude: 0, zoom: 3},
  mini: {longitude: 100, latitude: 40, zoom: 5}
};

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;
let tileset: SharedTileset2D | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
  tileset?.finalize();
  tileset = null;
});

function createDeck(views = [MAIN, MINI]): SharedTileset2D {
  tileset = new SharedTileset2D({getTileData: () => [], maxZoom: 6});
  parent = document.createElement('div');
  document.body.append(parent);
  deck = new Deck({
    parent,
    width: 256,
    height: 128,
    deviceProps: {adapters: [webgl2Adapter]},
    views,
    viewState: VIEW_STATE as any,
    // The default sublayers, so that deck.gl also filters them per viewport.
    layers: [new SharedTile2DLayer({id: 'tiles', data: tileset})]
  });
  return tileset;
}

function getLayer(): any {
  return (deck as any)?.layerManager?.getLayers().find((layer: any) => layer.id === 'tiles');
}

function viewIds(): string[] {
  return [...(getLayer()?.state?.tilesetViews.keys() || [])].sort();
}

/** Zoom levels of the tiles the shared tileset holds selected for any consumer. */
function selectedZooms(): number[] {
  return [...new Set((tileset?.selectedTiles || []).map(tile => tile.index.z))].sort();
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  throw new Error(`${message}: views ${viewIds()}, selected zooms ${selectedZooms()}`);
}

describe('SharedTile2DLayer views', () => {
  test('detaches a view the deck stops rendering', async () => {
    const shared = createDeck();
    await waitFor(
      () => viewIds().join() === 'main,mini' && selectedZooms().join() === '3,5',
      'expected both views to select tiles'
    );
    expect(shared.stats.get('Consumers').count).toBe(2);

    // `main` keeps its viewport.
    deck!.setProps({views: [MAIN], viewState: {main: VIEW_STATE.main} as any});
    await waitFor(() => viewIds().join() === 'main', 'expected the mini view to be detached');

    expect(shared.stats.get('Consumers').count).toBe(1);
    expect(selectedZooms()).toEqual([3]);
    expect(getLayer().isLoaded).toBe(true);
  }, 30_000);

  test('detaches a removed view when the layer is replaced in the same update', async () => {
    // `mini` draws first, so the deck's current viewport is `main` when the new layer updates.
    const shared = createDeck([MINI, MAIN]);
    await waitFor(
      () => viewIds().join() === 'main,mini' && selectedZooms().join() === '3,5',
      'expected both views to select tiles'
    );

    // A new layer instance inherits the views in its state, but has not seen their viewports.
    deck!.setProps({
      views: [MAIN],
      viewState: {main: VIEW_STATE.main} as any,
      layers: [new SharedTile2DLayer({id: 'tiles', data: shared})]
    });
    await waitFor(() => viewIds().join() === 'main', 'expected the mini view to be detached');

    expect(shared.stats.get('Consumers').count).toBe(1);
    expect(selectedZooms()).toEqual([3]);
  }, 30_000);
});
