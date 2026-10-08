// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {loadSpriteAtlases} from '../src/sprite';
import type {SpriteAtlas} from '../src/sprite';

const SIZE = 64;
const SPRITE_URL = 'https://sprites.test/sprite?token=secret';

/** A one-image sprite: `fallback`, a solid red 16x16 square. */
async function createSpriteFiles(): Promise<{json: object; png: Blob}> {
  const canvas = new OffscreenCanvas(16, 16);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 16, 16);
  return {
    json: {fallback: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 1}},
    png: await canvas.convertToBlob({type: 'image/png'})
  };
}

/** A fetch that serves the sprite only where the token stays in the query string. */
async function createSpriteFetch() {
  const {json, png} = await createSpriteFiles();
  const requested: string[] = [];
  const fetchFn = (async (url: string) => {
    requested.push(url);
    if (url === 'https://sprites.test/sprite.json?token=secret') {
      return new Response(JSON.stringify(json), {status: 200});
    }
    if (url === 'https://sprites.test/sprite.png?token=secret') {
      return new Response(png, {status: 200});
    }
    return new Response('forbidden', {status: 403});
  }) as typeof fetch;
  return {fetchFn, requested};
}

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** Renders one point label with `layout` and returns the RGBA of the center pixel. */
function renderCenterPixel(
  layout: Record<string, unknown>,
  spriteAtlases: SpriteAtlas[]
): Promise<number[]> {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'sprite-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'labels',
          config: {labels: true},
          zoom: 8,
          styleLayer: {layout, paint: {}},
          spriteAtlases,
          data: [{type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}}]
        } as any)
      ],
      onAfterRender: () => {
        const layers = (deck as any)?.layerManager?.getLayers() || [];
        if (!layers.length || layers.some(layer => !layer.isLoaded)) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        window.clearTimeout(timeout);
        resolve([...context.getImageData(SIZE / 2, SIZE / 2, 1, 1).data]);
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

describe('sprite icons in the browser', () => {
  test('loads a sprite whose URL has a query string and decodes its image', async () => {
    const {fetchFn, requested} = await createSpriteFetch();
    const atlases = await loadSpriteAtlases(SPRITE_URL, {fetch: fetchFn, pixelRatio: 1});
    expect(requested).toEqual([
      'https://sprites.test/sprite.json?token=secret',
      'https://sprites.test/sprite.png?token=secret'
    ]);
    expect(atlases).toHaveLength(1);
    expect(atlases[0].image).toBeInstanceOf(ImageBitmap);
  });

  test('draws the image a coalesce falls through to', async () => {
    const {fetchFn} = await createSpriteFetch();
    const atlases = await loadSpriteAtlases(SPRITE_URL, {fetch: fetchFn, pixelRatio: 1});
    const [red, green, blue, alpha] = await renderCenterPixel(
      {'icon-image': ['coalesce', ['image', 'missing'], ['image', 'fallback']], 'icon-size': 2},
      atlases
    );
    expect({red, green, blue, alpha}).toEqual({red: 255, green: 0, blue: 0, alpha: 255});
  });

  test('draws nothing for an image the sprite does not hold', async () => {
    const {fetchFn} = await createSpriteFetch();
    const atlases = await loadSpriteAtlases(SPRITE_URL, {fetch: fetchFn, pixelRatio: 1});
    const pixel = await renderCenterPixel({'icon-image': 'missing', 'icon-size': 2}, atlases);
    expect(pixel[3]).toBe(0);
  });
});
