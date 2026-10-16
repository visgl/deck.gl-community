// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// Fills and lines whose paint depends on zoom take it from a texture that is rewritten at each
// style zoom step. After zooming across steps, they draw as a fresh basemap of the same view.

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

const ring = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0]
];

/** Each tile holds overlapping polygons and crossing lines, in tile-local coordinates. */
const fetchTile = async () => [
  {
    type: 'Feature',
    properties: {layerName: 'land', kind: 'park'},
    geometry: {type: 'Polygon', coordinates: [ring(0.1, 0.1, 0.6, 0.6)]}
  },
  {
    type: 'Feature',
    properties: {layerName: 'land', kind: 'water'},
    geometry: {type: 'Polygon', coordinates: [ring(0.4, 0.4, 0.9, 0.9)]}
  },
  ...[0.2, 0.5, 0.8].map((v, index) => ({
    type: 'Feature',
    properties: {layerName: 'road', rank: index},
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.05, v],
        [0.95, 1 - v]
      ]
    }
  }))
];

const STYLE_LAYERS = [
  {
    id: 'park',
    type: 'fill',
    'source-layer': 'land',
    filter: ['==', ['get', 'kind'], 'park'],
    paint: {
      'fill-color': ['interpolate', ['linear'], ['zoom'], 0, '#33aa33', 8, '#aa33aa'],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 0.2]
    }
  },
  {
    id: 'water',
    type: 'fill',
    'source-layer': 'land',
    filter: ['==', ['get', 'kind'], 'water'],
    paint: {'fill-color': '#3366ff', 'fill-opacity': 0.7}
  },
  {
    id: 'casing',
    type: 'line',
    'source-layer': 'road',
    paint: {
      'line-color': ['interpolate', ['linear'], ['zoom'], 0, '#222222', 8, '#aa6600'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2, 8, 18]
    }
  },
  {
    id: 'road',
    type: 'line',
    'source-layer': 'road',
    paint: {
      'line-color': ['match', ['get', 'rank'], 0, '#ffcc00', '#ffffff'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 9]
    }
  }
];

function makeStyle(styleLayers: any[]) {
  return {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
      ...styleLayers.map(layer => ({...layer, source: 'tiles'}))
    ]
  } as any;
}

const STYLE = makeStyle(STYLE_LAYERS);

/**
 * `STYLE_LAYERS` with the paint they evaluate to at the 3.75 style zoom step, as constants, which
 * do not depend on the zoom the paint texture is written for.
 */
const t = 3.75 / 8;
const mix = (a: number, b: number) => a + (b - a) * t;
const STYLE_AT_3_75 = makeStyle(
  STYLE_LAYERS.map(layer => {
    const paint: Record<string, unknown> = {...layer.paint};
    if (layer.id === 'park') {
      paint['fill-color'] = `rgb(${mix(51, 170)}, ${mix(170, 51)}, ${mix(51, 170)})`;
      paint['fill-opacity'] = mix(1, 0.2);
    } else if (layer.id === 'casing') {
      paint['line-color'] = `rgb(${mix(34, 170)}, ${mix(34, 102)}, ${mix(34, 0)})`;
      paint['line-width'] = mix(2, 18);
    } else if (layer.id === 'road') {
      paint['line-width'] = mix(1, 9);
    }
    return {...layer, paint};
  })
);

/** Resolves with the frame drawn once every sublayer has loaded and the frame stops changing. */
function nextFrame(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let previous: ImageData | null = null;
    let same = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 30_000);
    onFrame = image => {
      same = previous && countDifferent(previous, image) === 0 ? same + 1 : 0;
      previous = image;
      if (same < 5) {
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

function createDeck(zoom: number, style = STYLE): Promise<ImageData> {
  cleanup();
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
    viewState: {longitude: 0, latitude: 0, zoom} as any,
    layers: [new BasemapLayer({id: 'basemap', mode: 'map', fetch: fetchTile, style})],
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

function zoomTo(zoom: number): Promise<ImageData> {
  const frame = nextFrame();
  deck!.setProps({viewState: {longitude: 0, latitude: 0, zoom} as any});
  return frame;
}

function countDifferent(a: ImageData, b: ImageData): number {
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > 2 ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > 2 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 2
    ) {
      count++;
    }
  }
  return count;
}

describe('zoom-dependent fill and line paint', () => {
  test('after zooming across style zoom steps, draws as a fresh basemap of the view', async () => {
    const first = await createDeck(4.45);
    // Across the 4.25 and 4 steps within one tile zoom: the tiles and their sublayers stay, and
    // the paint texture changes.
    await zoomTo(4.2);
    const stepped = await zoomTo(3.9);
    const fresh = await createDeck(3.9);
    // The paint differs at every step.
    expect(countDifferent(first, fresh)).toBeGreaterThan(1000);
    expect(countDifferent(stepped, fresh)).toBe(0);
    // Both draw the paint at the 3.75 step.
    const constant = await createDeck(3.9, STYLE_AT_3_75);
    expect(countDifferent(stepped, constant)).toBe(0);
  }, 60_000);
});
