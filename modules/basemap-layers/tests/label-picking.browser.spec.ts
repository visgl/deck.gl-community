// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// A picked label reports its feature in longitude/latitude, and the tile it was placed for.

const SIZE = 256;

type ViewState = {longitude: number; latitude: number; zoom: number};

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
      layout: {'text-field': ['get', 'name'], 'text-size': 20},
      paint: {'text-color': '#000000'}
    }
  ]
} as any;

/**
 * Resolves with the frame drawn once every sublayer has loaded and the frame has stopped changing:
 * a style resolves, and fonts load, over several frames.
 */
function nextFrame(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let previous: ImageData | null = null;
    let same = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 30_000);
    onFrame = image => {
      same = previous && countDifferent(previous, image) === 0 ? same + 1 : 0;
      previous = image;
      if (same < 10) {
        // `redraw` draws at once, so wait for the browser's next frame first.
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

function createDeck(layer: unknown, viewState: ViewState): Promise<ImageData> {
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
    viewState: viewState as any,
    layers: [layer as any],
    onAfterRender: () => {
      const layers = (deck as any)?.layerManager?.getLayers() || [];
      // A basemap draws no sublayers until its style resolves.
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

/** A basemap whose vector tile layers are pickable, as an application can make them. */
class PickableBasemapLayer extends BasemapLayer {
  static layerName = 'PickableBasemapLayer';
  renderLayers(): any {
    return (super.renderLayers() as any[]).map(layer => layer.clone({pickable: true}));
  }
}

describe('a picked label', () => {
  test('reports its feature in longitude/latitude and its tile', async () => {
    const basemap = new PickableBasemapLayer({
      id: 'basemap',
      mode: 'map',
      fetch: fetchTile,
      style: STYLE
    } as any);
    // The center of tile 1-1-1, (0.75, 0.75) of the world, at the center of the view.
    const anchor = [90, (360 / Math.PI) * Math.atan(Math.exp(-0.5 * Math.PI)) - 90];
    await createDeck(basemap, {longitude: anchor[0], latitude: anchor[1], zoom: 1.2});
    const [x, y] = [SIZE / 2, SIZE / 2];
    const info: any = deck!.pickObject({x, y, radius: 4});
    expect(info).toBeTruthy();
    expect(info.object.properties.name).toBe('T111');
    expect(info.tile?.id).toBe('1-1-1');
    const [lng, lat] = info.object.geometry.coordinates;
    expect(lng).toBeCloseTo(anchor[0], 4);
    expect(lat).toBeCloseTo(anchor[1], 4);
  }, 60_000);
});
