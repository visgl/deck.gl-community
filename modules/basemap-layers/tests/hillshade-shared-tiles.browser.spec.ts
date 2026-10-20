// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  MapView,
  _GlobeView as GlobeView,
  _GlobeViewport as GlobeViewport
} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';
import {HillshadeTileLayer} from '../src/hillshade-layer';
import {toFixtureUrl} from './reference-render/fixtures';

// The decoded tiles of a raster-dem source are shared by its hillshade layers, and kept through a
// switch between a map and a globe: each tile is fetched and decoded once.

const SIZE = 256;
const VIEW_STATE = {
  longitude: -121.81640625,
  latitude: 46.8000594467873,
  zoom: 10 + Math.log2(300 / 256),
  pitch: 0,
  bearing: 0
};

/** Two hillshade layers over one raster-dem source, as a style with a shadow and a highlight. */
const STYLE = {
  version: 8,
  sources: {
    terrain: {
      type: 'raster-dem',
      tiles: [
        toFixtureUrl('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png')
      ],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 11
    }
  },
  layers: [
    {id: 'background', type: 'background', paint: {'background-color': '#f2efe9'}},
    {
      id: 'hillshade-shadow',
      type: 'hillshade',
      source: 'terrain',
      paint: {'hillshade-highlight-color': 'rgba(0, 0, 0, 0)'}
    },
    {
      id: 'hillshade-highlight',
      type: 'hillshade',
      source: 'terrain',
      paint: {'hillshade-shadow-color': 'rgba(0, 0, 0, 0)'}
    }
  ]
};

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
  vi.restoreAllMocks();
});

function getHillshadeLayers(): HillshadeTileLayer[] {
  const layers = (deck as any)?.layerManager?.getLayers() || [];
  return layers.filter((layer: any) => layer instanceof HillshadeTileLayer);
}

/** The tiles a hillshade layer selected for the view. */
function getSelectedTiles(layer: HillshadeTileLayer): any[] {
  return [...layer.state.tilesetViews.values()].flatMap(view => view.selectedTiles || []);
}

/** Resolves once both hillshade layers have drawn every tile they selected, on a globe if set. */
function waitForTiles(globe: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out loading tiles')), 30_000);
    const check = () => {
      const hillshades = getHillshadeLayers();
      const layers = (deck as any)?.layerManager?.getLayers() || [];
      const ready =
        hillshades.length === 2 &&
        hillshades.every(
          layer =>
            layer.context.viewport instanceof GlobeViewport === globe &&
            getSelectedTiles(layer).length > 0 &&
            layer.isLoaded
        ) &&
        layers.every((layer: any) => layer.isLoaded);
      if (ready && settled++ >= 2) {
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      deck?.redraw('wait for tiles');
      window.requestAnimationFrame(check);
    };
    window.requestAnimationFrame(check);
  });
}

describe('hillshade layers of one raster-dem source', () => {
  test('fetch and decode each tile once, also through a switch between map and globe', async () => {
    // Fetches by DEM tile URL, and the tiles found. A globe also asks for tiles of lower zooms,
    // which have no fixture.
    const fetches = new Map<string, number>();
    const found = new Set<string>();
    const fetchTile = async (url: string, init?: RequestInit) => {
      if (url.includes('/terrarium/')) {
        fetches.set(url, (fetches.get(url) ?? 0) + 1);
      }
      const response = await fetch(url, init);
      if (response.ok) {
        found.add(url);
      }
      return response;
    };
    // Tiles without a fixture are logged as failed loads.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Every DEM tile is decoded from an image bitmap.
    const decode = vi.spyOn(globalThis, 'createImageBitmap');
    const style = structuredClone(STYLE) as any;
    const loadOptions = {fetch: fetchTile} as any;

    parent = document.createElement('div');
    document.body.append(parent);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new MapView({id: 'view'}),
      viewState: VIEW_STATE as any,
      layers: [new BasemapLayer({id: 'basemap', mode: 'map', style, loadOptions})]
    });

    // (a) Two hillshade layers over one source.
    await waitForTiles(false);
    const [shadow, highlight] = getHillshadeLayers();
    expect(shadow.id).toBe('basemap-hillshade-shadow');
    expect(highlight.id).toBe('basemap-hillshade-highlight');
    // Both layers draw every tile they selected.
    for (const layer of [shadow, highlight]) {
      expect(layer.getSubLayers().length).toBeGreaterThan(0);
    }
    const mapUrls = [...found];
    // The four recorded tiles.
    expect(mapUrls.length).toBe(4);
    expect(
      [...fetches.values()].every(count => count === 1),
      JSON.stringify([...fetches])
    ).toBe(true);
    expect(decode).toHaveBeenCalledTimes(4);

    // (b) The same basemap, switched to a globe.
    deck.setProps({
      views: new GlobeView({id: 'view'}),
      layers: [new BasemapLayer({id: 'basemap', mode: 'globe', style, loadOptions})]
    });
    await waitForTiles(true);
    for (const layer of getHillshadeLayers()) {
      // The globe draws the recorded tiles the map loaded. (It also selects tiles beyond the
      // horizon, which have no fixture.)
      const tiles = getSelectedTiles(layer).filter(tile => tile.index.z === 11);
      expect(tiles.map(tile => tile.id).sort()).toEqual([
        '330-721-11',
        '330-722-11',
        '331-721-11',
        '331-722-11'
      ]);
      expect(tiles.every(tile => tile.content)).toBe(true);
      expect(layer.getSubLayers().length).toBeGreaterThan(0);
    }
    for (const url of mapUrls) {
      expect(fetches.get(url), url).toBe(1);
    }
    expect(
      [...fetches.values()].every(count => count === 1),
      JSON.stringify([...fetches])
    ).toBe(true);
    expect(decode).toHaveBeenCalledTimes(found.size);
  }, 60_000);
});
