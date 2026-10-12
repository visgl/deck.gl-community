// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;
const originalFetch = globalThis.fetch;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
  globalThis.fetch = originalFetch;
});

/** A solid red tile image. */
async function createTileImage(): Promise<Blob> {
  const canvas = new OffscreenCanvas(256, 256);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 256, 256);
  return canvas.convertToBlob({type: 'image/png'});
}

/** Number of pixels drawn red by the tiles. */
function countRedPixels(image: ImageData): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r, g, b, a] = image.data.slice(i, i + 4);
    if (a > 200 && r > 200 && g < 60 && b < 60) {
      count++;
    }
  }
  return count;
}

/**
 * Renders a raster source on a globe at `viewState` and returns the frame drawn once the tile
 * layer has loaded the tiles it selected (or has selected none).
 */
async function renderGlobe(viewState: Record<string, number>): Promise<ImageData> {
  const png = await createTileImage();
  globalThis.fetch = (async () => new Response(png, {status: 200})) as typeof fetch;
  const layers = getBasemapLayers({
    idPrefix: 'pyramid',
    mode: 'globe',
    zoom: viewState.zoom,
    styleDefinition: {
      version: 8,
      sources: {raster: {type: 'raster', tiles: ['https://tiles.test/{z}/{x}/{y}.png']}},
      layers: [{id: 'imagery', type: 'raster', source: 'raster'}]
    } as any
  });
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise<ImageData>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    let frames = 0;
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new GlobeView({id: 'globe'}),
      initialViewState: viewState,
      layers,
      onAfterRender: () => {
        const all = (deck as any)?.layerManager?.getLayers() || [];
        // Some frames in: a tile layer updates which tiles it shows in the frame after they load.
        if (++frames < 20 || !all.length || all.some((layer: any) => !layer.isLoaded)) {
          requestAnimationFrame(() => deck?.redraw('waiting'));
          return;
        }
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
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

describe('tile sources on a globe below zoom 0', () => {
  // `GlobeView` lowers the zoom with the latitude, so that the globe keeps its size on screen:
  // looking over a pole, a globe that fits the canvas has a zoom below 0.
  test('a globe over the north pole at a zoom below 0 draws its tiles', async () => {
    const image = await renderGlobe({longitude: 167.79, latitude: 76.15, zoom: -1.16, pitch: 30});
    expect(countRedPixels(image)).toBeGreaterThan(500);
  });

  test('the same globe at the equator, at zoom 0, draws its tiles', async () => {
    const image = await renderGlobe({longitude: 0, latitude: 0, zoom: 0});
    expect(countRedPixels(image)).toBeGreaterThan(500);
  });
});
