// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// A view moves away from the only tiles with features of a symbol layer and back. Its label layer
// is kept, hidden, meanwhile: it keeps its state, and draws the same labels when they return.

const SIZE = 256;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;
let onFrame: ((image: ImageData) => void) | null = null;

function cleanup() {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
  onFrame = null;
}

afterEach(cleanup);

/** Every tile has a road; only tiles with an odd `x` have a place. */
const fetchTile = async (url: string) => {
  const [z, x, y] = url
    .match(/(\d+)\/(\d+)\/(\d+)\.mvt/)!
    .slice(1)
    .map(Number);
  return [
    {
      type: 'Feature',
      properties: {layerName: 'road', name: `R${z}${x}${y}`},
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.1, 0.9],
          [0.9, 0.98]
        ]
      }
    },
    ...(x % 2
      ? [
          {
            type: 'Feature',
            properties: {layerName: 'place', name: `P${z}${x}${y}`},
            // Near the tile's bottom edge, which the view shows at latitude 0.
            geometry: {type: 'Point', coordinates: [0.5, 0.95]}
          }
        ]
      : [])
  ];
};

const STYLE = {
  version: 8,
  sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
  layers: [
    {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
    {
      id: 'road',
      type: 'line',
      source: 'tiles',
      'source-layer': 'road',
      paint: {'line-color': '#888888', 'line-width': 2}
    },
    {
      id: 'place',
      type: 'symbol',
      source: 'tiles',
      'source-layer': 'place',
      layout: {'text-field': ['get', 'name'], 'text-size': 20},
      paint: {'text-color': '#000000'}
    }
  ]
} as any;

/** Resolves with the frame drawn once every sublayer has loaded and the frame stops changing. */
function nextFrame(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let previous: ImageData | null = null;
    let same = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 30_000);
    onFrame = image => {
      same = previous && countDifferent(previous, image) === 0 ? same + 1 : 0;
      previous = image;
      if (same < 10) {
        window.setTimeout(() => window.requestAnimationFrame(() => deck?.redraw('settle')), 20);
        return;
      }
      onFrame = null;
      window.clearTimeout(timeout);
      resolve(image);
    };
    window.requestAnimationFrame(() => deck?.redraw('frame'));
  });
}

function countDifferent(a: ImageData, b: ImageData): number {
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2]
    ) {
      count++;
    }
  }
  return count;
}

function createDeck(longitude: number): Promise<ImageData> {
  parent = document.createElement('div');
  document.body.append(parent);
  const frame = nextFrame();
  deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: new MapView({id: 'map'}),
    viewState: {longitude, latitude: 0, zoom: 2} as any,
    layers: [new BasemapLayer({id: 'basemap', mode: 'map', fetch: fetchTile, style: STYLE})],
    onAfterRender: () => {
      const layers = (deck as any)?.layerManager?.getLayers() || [];
      if (!onFrame || layers.length < 2 || layers.some((l: any) => !l.isLoaded)) {
        return;
      }
      const copy = document.createElement('canvas');
      copy.width = SIZE;
      copy.height = SIZE;
      const context = copy.getContext('2d')!;
      context.drawImage(deck!.getCanvas()!, 0, 0);
      onFrame(context.getImageData(0, 0, SIZE, SIZE));
    },
    onError: error => {
      throw error;
    }
  });
  return frame;
}

function moveTo(longitude: number): Promise<ImageData> {
  const frame = nextFrame();
  deck!.setProps({viewState: {longitude, latitude: 0, zoom: 2} as any});
  return frame;
}

/** The label layer of the `place` style layer, if any. */
function placeLabels(): any {
  return ((deck as any).layerManager.getLayers() as any[]).find(
    layer => layer.constructor.layerName === 'MVTLabelLayer' && layer.id.endsWith('"place"')
  );
}

// At zoom 2 a 512 pixel tile spans 90 degrees of longitude, and the 256 pixel view 45 degrees.
/** The middle of tile x = 1, which has places. */
const WITH_PLACES = -45;
/** The middle of tile x = 0: the view shows no tile with places. */
const WITHOUT_PLACES = -135;

describe('a label layer whose features leave the view', () => {
  test('is kept, hidden, and draws the same labels when they return', async () => {
    const before = await createDeck(WITH_PLACES);
    const drawn = placeLabels();
    expect(drawn).toBeTruthy();
    expect(drawn.state.labelData.length).toBeGreaterThan(0);
    const state = drawn.state;
    const rows = drawn.state.labelData;

    const away = await moveTo(WITHOUT_PLACES);
    const kept = placeLabels();
    expect(kept?.props.visible).toBe(false);
    expect(kept.state).toBe(state);
    expect(countDifferent(away, before)).toBeGreaterThan(0);

    const back = await moveTo(WITH_PLACES);
    const again = placeLabels();
    expect(again.props.visible).not.toBe(false);
    // The same layer state, not a new layer, with the same rows: hiding it changed no data.
    expect(again.state).toBe(state);
    expect(again.state.labelData).toBe(rows);
    expect(countDifferent(back, before)).toBe(0);
  }, 90_000);
});
