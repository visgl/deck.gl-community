// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// While the map rotates, tiles come into view at its corners, and the label layers' rows change
// with them. No frame may lose the labels placed before the rows changed.

// Wider than a tile, which is 512 pixels at a whole zoom, so that tiles above and below come into
// view as it turns.
const WIDTH = 640;
const HEIGHT = 96;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;
let onFrame: ((image: ImageData) => void) | null = null;
/** Whether frames drawn while tiles load are read too, as they are once the map has settled. */
let readLoadingFrames = false;

function cleanup() {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
  onFrame = null;
  readLoadingFrames = false;
}

afterEach(cleanup);

/** Each tile holds one labelled point at its center, in tile-local coordinates. */
const fetchTile = async (url: string) => {
  const [z, x, y] = url
    .match(/(\d+)\/(\d+)\/(\d+)\.mvt/)!
    .slice(1)
    .map(Number);
  return [
    {
      type: 'Feature',
      properties: {layerName: 'place', name: `T${z}${x}${y}`},
      geometry: {type: 'Point', coordinates: [0.5, 0.5]}
    }
  ];
};

const STYLE = {
  version: 8,
  sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
  layers: [
    {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
    {
      id: 'place',
      type: 'symbol',
      source: 'tiles',
      'source-layer': 'place',
      layout: {'text-field': ['get', 'name'], 'text-size': 16},
      paint: {'text-color': '#000000'}
    }
  ]
} as any;

/** The next frame drawn once every sublayer has loaded. */
function nextFrame(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 30_000);
    onFrame = image => {
      onFrame = null;
      window.clearTimeout(timeout);
      resolve(image);
    };
  });
}

/** The frame drawn once it has stopped changing: a style resolves, and fonts load, over frames. */
async function settledFrame(): Promise<ImageData> {
  let previous: ImageData | null = null;
  for (let same = 0; same < 10; ) {
    window.setTimeout(() => window.requestAnimationFrame(() => deck?.redraw('settle')), 20);
    const image = await nextFrame();
    same = previous && countDifferent(previous, image) === 0 ? same + 1 : 0;
    previous = image;
  }
  return previous!;
}

function createDeck(layer: unknown, viewState: Record<string, number>): void {
  parent = document.createElement('div');
  document.body.append(parent);
  deck = new Deck({
    parent,
    width: WIDTH,
    height: HEIGHT,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: new MapView({id: 'map'}),
    viewState: viewState as any,
    layers: [layer as any],
    onAfterRender: () => {
      const layers = (deck as any)?.layerManager?.getLayers() || [];
      // A basemap draws no sublayers until its style resolves.
      if (
        !onFrame ||
        layers.length < 2 ||
        (!readLoadingFrames && layers.some((l: any) => !l.isLoaded))
      ) {
        return;
      }
      // Read the frame back in the render callback, before the drawing buffer is cleared.
      const copy = document.createElement('canvas');
      copy.width = WIDTH;
      copy.height = HEIGHT;
      const context = copy.getContext('2d')!;
      context.drawImage(deck!.getCanvas()!, 0, 0);
      onFrame(context.getImageData(0, 0, WIDTH, HEIGHT));
    },
    onError: error => {
      throw error;
    }
  });
}

/** The number of pixels whose channels differ by more than 8. */
function countDifferent(a: ImageData, b: ImageData): number {
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > 8 ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 8
    ) {
      count++;
    }
  }
  return count;
}

/** The number of dark (text-colored) pixels within `radius` pixels of the canvas center. */
function centerTextPixels(image: ImageData, radius = 24): number {
  let count = 0;
  for (let y = HEIGHT / 2 - radius; y < HEIGHT / 2 + radius; y++) {
    for (let x = WIDTH / 2 - radius; x < WIDTH / 2 + radius; x++) {
      const i = (y * WIDTH + x) * 4;
      if (image.data[i] < 80 && image.data[i + 1] < 80 && image.data[i + 2] < 80) {
        count++;
      }
    }
  }
  return count;
}

describe('labels while the map rotates', () => {
  test('no frame loses its labels when tiles come into view across a bearing step', async () => {
    const basemap = new BasemapLayer({
      id: 'basemap',
      mode: 'map',
      fetch: fetchTile,
      style: STYLE,
      // Placed only once the view rests: every frame of the rotation draws the placement made
      // before it, unless the labels' slots change.
      labelPlacementInterval: 60_000
    } as any);
    // The center of tile 2-1-1, at the center of the view: its label stays there as the map turns.
    // The view draws the tiles of its whole zoom.
    const latitude = (360 / Math.PI) * Math.atan(Math.exp(0.25 * Math.PI)) - 90;
    const view = {longitude: -90 + 45, latitude, zoom: 2, pitch: 0, bearing: 0};
    createDeck(basemap, view);
    const first = await settledFrame();
    expect(centerTextPixels(first)).toBeGreaterThan(20);
    const getRows = () =>
      (deck as any).layerManager
        .getLayers()
        .filter((layer: any) => layer.state?.placementHandle)
        .map((layer: any) => layer.state.labelData);
    const firstRows = getRows();
    let rowsChanged = 0;
    const lost: number[] = [];
    // Every frame drawn from here on is read, those drawn while tiles load included.
    readLoadingFrames = true;
    let bearing = 0;
    let moving = true;
    onFrame = image => {
      if (centerTextPixels(image) < 20) {
        lost.push(bearing);
      }
      const rows = getRows();
      if (moving && rows.some((row: unknown, i: number) => row !== firstRows[i])) {
        rowsChanged++;
      }
    };
    // Turned half a degree a frame, across the 5 degree steps at which line labels turn upright,
    // until tiles that were out of view come in at the corners.
    while (bearing < 90) {
      bearing += 0.5;
      deck!.setProps({viewState: {...view, bearing} as any});
      await new Promise(resolve => window.requestAnimationFrame(resolve));
    }
    moving = false;
    await new Promise(resolve => window.setTimeout(resolve, 200));
    onFrame = null;
    // Tiles came into view, and with them new label rows, while the view moved.
    expect(rowsChanged).toBeGreaterThan(0);
    expect(lost).toEqual([]);
  }, 60_000);
});
