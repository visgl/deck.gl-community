// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {loadSpriteAtlases} from '../src/sprite';
import type {SpriteAtlas} from '../src/sprite';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** A sprite with one image, `square`: a solid red 16x16 square. */
async function loadSquareSprite(): Promise<SpriteAtlas[]> {
  const canvas = new OffscreenCanvas(16, 16);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 16, 16);
  const png = await canvas.convertToBlob({type: 'image/png'});
  const json = {square: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 1}};
  const fetchFn = (async (url: string) =>
    url.endsWith('.json')
      ? new Response(JSON.stringify(json), {status: 200})
      : new Response(png, {status: 200})) as typeof fetch;
  return loadSpriteAtlases('https://sprites.test/sprite', {fetch: fetchFn, pixelRatio: 1});
}

/**
 * Renders one point label at longitude/latitude 0, 0, which a `GlobeView` centered there draws at
 * the canvas center, and returns the frame.
 */
function renderGlobeLabel(
  layout: Record<string, unknown>,
  spriteAtlases: SpriteAtlas[] | null = null
): Promise<ImageData> {
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
      views: new GlobeView({id: 'globe-label-test'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'labels',
          config: {labels: true},
          mode: 'globe',
          zoom: 1,
          styleLayer: {layout, paint: {}},
          textColor: [0, 0, 0, 255],
          spriteAtlases,
          data: [{type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}}]
        } as any)
      ],
      onAfterRender: () => {
        const layers = (deck as any)?.layerManager?.getLayers() || [];
        if (!layers.length || layers.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
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

/** Number of opaque pixels for which `match(r, g, b)` holds. */
function countPixels(image: ImageData, match: (r: number, g: number, b: number) => boolean) {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] > 200 && match(image.data[i], image.data[i + 1], image.data[i + 2])) {
      count++;
    }
  }
  return count;
}

describe('labels on a globe in the browser', () => {
  test('a point label draws in GlobeView', async () => {
    const image = await renderGlobeLabel({'text-field': 'MMMM', 'text-size': 16});
    expect(countPixels(image, (r, g, b) => r < 80 && g < 80 && b < 80)).toBeGreaterThan(20);
  });

  test('a sprite icon draws in GlobeView', async () => {
    const image = await renderGlobeLabel({'icon-image': 'square'}, await loadSquareSprite());
    expect(countPixels(image, (r, g, b) => r > 200 && g < 60 && b < 60)).toBeGreaterThan(100);
  });
});

/** Resolves once `condition` holds, polling every animation frame, or rejects after 10 seconds. */
function waitFor(condition: () => boolean): Promise<void> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (condition()) {
        resolve();
      } else if (performance.now() - start > 10_000) {
        reject(new Error('Timed out waiting'));
      } else {
        requestAnimationFrame(poll);
      }
    };
    poll();
  });
}

describe('vector tiles across a switch between map and globe views', () => {
  // Tiles decode to tile coordinates on a map and to longitude/latitude on a globe. A view switch
  // that keeps the tile layer must load its tiles again, or they draw in the wrong place.
  test('switching from MapView to GlobeView reloads the loaded tiles', async () => {
    // The tiles are empty and fail to decode; only their requests matter here.
    const requested: string[] = [];
    const fetchFn = (async (url: string) => {
      requested.push(String(url));
      return new Response(new ArrayBuffer(0), {status: 200});
    }) as typeof fetch;
    const getLayers = (mode: 'map' | 'globe') =>
      getBasemapLayers({
        idPrefix: 'switch',
        mode,
        zoom: 0,
        loadOptions: {fetch: fetchFn, core: {fetch: fetchFn}, worker: false} as any,
        styleDefinition: {
          version: 8,
          sources: {tiles: {type: 'vector', tiles: ['https://tiles.test/{z}/{x}/{y}.mvt']}},
          layers: [{id: 'fill', type: 'fill', source: 'tiles', 'source-layer': 'water'}]
        } as any
      });
    const isTileLayerLoaded = () =>
      Boolean(
        (deck as any)?.layerManager?.getLayers().find((layer: any) => layer.id === 'switch-tiles')
          ?.isLoaded
      );

    parent = document.createElement('div');
    document.body.append(parent);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new MapView({id: 'map'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 0},
      layers: getLayers('map')
    });
    await waitFor(() => requested.length > 0 && isTileLayerLoaded());
    const mapRequests = [...requested];

    deck.setProps({
      views: new GlobeView({id: 'globe'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 0},
      layers: getLayers('globe')
    });
    // The globe at zoom 0 shows the whole world, so it needs the same tile as the map did.
    await waitFor(() => requested.length > mapRequests.length && isTileLayerLoaded());
    expect(requested.slice(mapRequests.length)).toEqual(expect.arrayContaining(mapRequests));
  });
});
