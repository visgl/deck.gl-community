// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// Consecutive fill and line style layers drawn as one sublayer draw the same pixels as when each
// draws alone. A symbol layer without features between two style layers keeps them apart.

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
    paint: {'fill-color': '#33aa33'}
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
    paint: {'line-color': '#222222', 'line-width': 9}
  },
  {
    id: 'road',
    type: 'line',
    'source-layer': 'road',
    paint: {
      'line-color': ['match', ['get', 'rank'], 0, '#ffcc00', '#ffffff'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 6, 7]
    }
  },
  {
    id: 'rail',
    type: 'line',
    'source-layer': 'road',
    paint: {'line-color': '#aa0000', 'line-width': 2, 'line-dasharray': [2, 2]}
  }
];

/** The style, with a symbol layer without features after each style layer when `apart`. */
function style(apart: boolean) {
  const layers = STYLE_LAYERS.flatMap(layer => [
    {...layer, source: 'tiles'},
    ...(apart
      ? [
          {
            id: `apart-${layer.id}`,
            type: 'symbol',
            source: 'tiles',
            'source-layer': 'none',
            layout: {'text-field': 'x'}
          }
        ]
      : [])
  ]);
  return {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
      ...layers
    ]
  } as any;
}

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

async function render(apart: boolean): Promise<{image: ImageData; sublayers: number}> {
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
    viewState: {longitude: 0, latitude: 0, zoom: 4.6} as any,
    layers: [new BasemapLayer({id: 'basemap', mode: 'map', fetch: fetchTile, style: style(apart)})],
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
  const image = await frame;
  const sublayers = ((deck as any).layerManager.getLayers() as any[]).filter(
    layer => layer.constructor.layerName === 'StyledGeoJsonLayer'
  ).length;
  return {image, sublayers};
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

describe('style layers drawn in one sublayer', () => {
  test('draw the same pixels as when each draws alone, in fewer sublayers', async () => {
    const apart = await render(true);
    const batched = await render(false);
    // Per tile: two fills and three lines alone, one fill batch and one line batch together.
    expect(batched.sublayers).toBeLessThan(apart.sublayers);
    expect(batched.sublayers * 5).toBe(apart.sublayers * 2);
    expect(countDifferent(batched.image, apart.image)).toBe(0);
  }, 60_000);
});
