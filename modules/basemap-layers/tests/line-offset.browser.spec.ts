// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';

const SIZE = 128;
const CENTER = SIZE / 2;
const ZOOM = 18;
/** Degrees of longitude per pixel at `ZOOM`; near the equator, also of latitude. */
const DEGREES_PER_PIXEL = 360 / (512 * 2 ** ZOOM);

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** The deck.gl sublayers that one line style layer draws for one tile of features. */
function styleSublayers(paint: Record<string, unknown>, features: unknown[]) {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: ZOOM,
    styleDefinition: {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: [
        {
          id: 'path',
          type: 'line',
          source: 'tiles',
          'source-layer': 'land',
          paint: {'line-color': '#000000', ...paint}
        }
      ]
    } as any
  });
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  // Tile sublayers receive the tile layer's base props, defaults included.
  return vectorLayer.props
    .renderSubLayers({
      pickable: false,
      visible: true,
      opacity: 1,
      modelMatrix: null,
      coordinateSystem: 'default',
      coordinateOrigin: [0, 0, 0],
      extensions: [],
      highlightedObjectIndex: -1,
      highlightColor: [0, 0, 128, 128],
      wrapLongitude: false,
      id: 'test-tiles-tile',
      data: features,
      tile: {index: {x: 0, y: 0, z: ZOOM}}
    })
    .flat();
}

/** A feature from pixel offsets east (x) and north (y) of the map center. */
function feature(type: string, pixels: number[][] | number[][][]) {
  const toLngLat = (point: any) => point.map((value: number) => value * DEGREES_PER_PIXEL);
  return {
    type: 'Feature',
    geometry: {
      type,
      coordinates:
        type === 'Polygon'
          ? (pixels as number[][][]).map(ring => ring.map(toLngLat))
          : pixels.map(toLngLat)
    },
    properties: {layerName: 'land'}
  };
}

/** Renders layers on a white canvas and returns the first frame drawn after they load. */
function render(layers: unknown[]) {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise<ImageData>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new MapView({id: 'map'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: ZOOM},
      layers: layers as any,
      onAfterRender: () => {
        const loaded = (deck as any)?.layerManager?.getLayers() || [];
        if (!loaded.length || loaded.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, SIZE, SIZE);
        context.drawImage(deck!.getCanvas()!, 0, 0);
        window.clearTimeout(timeout);
        resolve(context.getImageData(0, 0, SIZE, SIZE));
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

/** Whether a pixel is drawn, i.e. darker than the white background. */
function isInked(image: ImageData, x: number, y: number): boolean {
  const i = (y * SIZE + x) * 4;
  return image.data[i] + image.data[i + 1] + image.data[i + 2] < 600;
}

/** The inked runs along a column (`axis: 'y'`) or row (`axis: 'x'`), as [first, last] pixels. */
function inkedRuns(image: ImageData, axis: 'x' | 'y', at: number): [number, number][] {
  const runs: [number, number][] = [];
  for (let i = 0; i < SIZE; i++) {
    if (isInked(image, axis === 'y' ? at : i, axis === 'y' ? i : at)) {
      const last = runs[runs.length - 1];
      if (last && last[1] === i - 1) {
        last[1] = i;
      } else {
        runs.push([i, i]);
      }
    }
  }
  return runs;
}

/** Expects one run per expected [first, last], each edge within a pixel. */
function expectRuns(runs: [number, number][], expected: [number, number][]) {
  expect(runs).toHaveLength(expected.length);
  runs.forEach(([first, last], index) => {
    expect(Math.abs(first - expected[index][0])).toBeLessThanOrEqual(1);
    expect(Math.abs(last - expected[index][1])).toBeLessThanOrEqual(1);
  });
}

const EASTWARD = [
  [-40, 0],
  [40, 0]
];

describe('line-offset in the browser', () => {
  test('a positive offset draws to the right of the direction of travel', async () => {
    // Travelling east, the right is south: down the screen.
    const image = await render(
      styleSublayers({'line-width': 4, 'line-offset': 12}, [feature('LineString', EASTWARD)])
    );
    expectRuns(inkedRuns(image, 'y', CENTER), [[CENTER + 10, CENTER + 13]]);
  });

  test('a negative offset draws to the left', async () => {
    const image = await render(
      styleSublayers({'line-width': 4, 'line-offset': -12}, [feature('LineString', EASTWARD)])
    );
    expectRuns(inkedRuns(image, 'y', CENTER), [[CENTER - 14, CENTER - 11]]);
  });

  test('a positive offset insets a polygon outline, as in MapLibre', async () => {
    // Vector tiles wind exterior rings clockwise on screen, and loaders.gl keeps that winding: they
    // are clockwise in longitude and latitude too.
    const square = [
      [
        [-40, -40],
        [-40, 40],
        [40, 40],
        [40, -40],
        [-40, -40]
      ]
    ];
    const image = await render(
      styleSublayers({'line-width': 4, 'line-offset': 10}, [feature('Polygon', square)])
    );
    // The west edge is at CENTER - 40; inset by 10 pixels, its line spans 8 to 12 pixels inside.
    const [west, east] = inkedRuns(image, 'x', CENTER);
    expectRuns([west], [[CENTER - 32, CENTER - 29]]);
    expectRuns([east], [[CENTER + 28, CENTER + 31]]);
  });
});

describe('line-gap-width in the browser', () => {
  test('draws a line of line-width on either side of the gap', async () => {
    const image = await render(
      styleSublayers({'line-width': 4, 'line-gap-width': 16}, [feature('LineString', EASTWARD)])
    );
    // Lines 4 pixels wide, their inner edges 8 pixels either side of the center.
    expectRuns(inkedRuns(image, 'y', CENTER), [
      [CENTER - 12, CENTER - 9],
      [CENTER + 8, CENTER + 11]
    ]);
  });

  test('moves the gap with line-offset', async () => {
    const image = await render(
      styleSublayers({'line-width': 4, 'line-gap-width': 16, 'line-offset': 20}, [
        feature('LineString', EASTWARD)
      ])
    );
    expectRuns(inkedRuns(image, 'y', CENTER), [
      [CENTER + 8, CENTER + 11],
      [CENTER + 28, CENTER + 31]
    ]);
  });
});
