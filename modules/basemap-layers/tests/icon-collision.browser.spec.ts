// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {getSpriteIconMapping} from '../src/sprite';
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

/**
 * A two-image sprite: `square`, a solid red 16x16 square, and `framed`, a 32x32 image whose red
 * 16x16 center has an 8-pixel transparent border.
 */
async function createSquareAtlas(): Promise<SpriteAtlas> {
  const canvas = new OffscreenCanvas(48, 32);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 16, 16);
  context.fillRect(24, 8, 16, 16);
  return {
    id: 'default',
    image: await createImageBitmap(canvas),
    mapping: getSpriteIconMapping({
      square: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 1},
      framed: {x: 16, y: 0, width: 32, height: 32, pixelRatio: 1}
    })
  };
}

/**
 * Renders one point symbol per entry of `features` (`[x, y]` in pixels from the canvas center,
 * and feature properties) with `layout`, and returns the frame.
 */
async function renderSymbols(
  layout: Record<string, unknown>,
  features: [number[], Record<string, unknown>][]
): Promise<ImageData> {
  const atlas = await createSquareAtlas();
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
      views: new OrthographicView({id: 'icon-collision-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'symbols',
          config: {labels: true},
          zoom: 8,
          styleLayer: {layout, paint: {}},
          textColor: [0, 0, 0, 255],
          spriteAtlases: [atlas],
          data: features.map(([coordinates, properties]) => ({
            type: 'Feature',
            geometry: {type: 'Point', coordinates},
            properties
          }))
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

/** Number of opaque pixels matching `isColor`. */
function countPixels(image: ImageData, isColor: (r: number, g: number, b: number) => boolean) {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] > 200 && isColor(image.data[i], image.data[i + 1], image.data[i + 2])) {
      count++;
    }
  }
  return count;
}

const iconPixels = (image: ImageData) =>
  countPixels(image, (r, g, b) => r > 200 && g < 80 && b < 80);
const textPixels = (image: ImageData) =>
  countPixels(image, (r, g, b) => r < 80 && g < 80 && b < 80);

/** Symbols whose icon and text come from feature properties, ordered by `rank`. */
const LAYOUT = {
  'icon-image': ['get', 'icon'],
  'icon-size': ['coalesce', ['get', 'iconSize'], 1],
  'text-field': ['coalesce', ['get', 'name'], ''],
  'text-size': 16,
  'symbol-sort-key': ['get', 'rank']
};

describe('icon collision in the browser', () => {
  test('a symbol alone draws its icon', async () => {
    const image = await renderSymbols(LAYOUT, [[[0, 0], {rank: 1, icon: 'square'}]]);
    // A 16x16 icon.
    expect(iconPixels(image)).toBeGreaterThan(200);
  });

  test('an icon whose symbol loses to a higher-priority label is hidden with it', async () => {
    const image = await renderSymbols(LAYOUT, [
      [[0, 0], {rank: 0, name: 'MMMM'}],
      [[8, 0], {rank: 1, icon: 'square', name: 'MMMM'}]
    ]);
    expect(textPixels(image)).toBeGreaterThan(20);
    expect(iconPixels(image)).toBe(0);
  });

  test('an icon box hides a lower-priority label whose anchor it covers', async () => {
    const image = await renderSymbols(LAYOUT, [
      [[0, 0], {rank: 0, icon: 'square', iconSize: 3}],
      [[12, 0], {rank: 1, name: 'MMMM'}]
    ]);
    expect(iconPixels(image)).toBeGreaterThan(1000);
    expect(textPixels(image)).toBe(0);
  });

  test("an icon's transparent border still hides a lower-priority label", async () => {
    // At icon-size 2 the image is 64 pixels wide: opaque within 16 pixels of its center,
    // transparent from 16 to 32. The label's anchor, 24 pixels away, is under the border only.
    const image = await renderSymbols(LAYOUT, [
      [[0, 0], {rank: 0, icon: 'framed', iconSize: 2}],
      [[24, 0], {rank: 1, name: 'MMMM'}]
    ]);
    expect(iconPixels(image)).toBeGreaterThan(500);
    expect(textPixels(image)).toBe(0);
  });

  test('an icon that ignores placement does not hide other labels', async () => {
    const image = await renderSymbols({...LAYOUT, 'icon-ignore-placement': true}, [
      [[0, 0], {rank: 0, icon: 'square', iconSize: 3}],
      [[12, 0], {rank: 1, name: 'MMMM'}]
    ]);
    expect(iconPixels(image)).toBeGreaterThan(500);
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('icons and text that allow overlap and ignore placement are all drawn', async () => {
    const image = await renderSymbols(
      {
        ...LAYOUT,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      [
        [[0, 0], {rank: 0, name: 'MMMM'}],
        [[8, 0], {rank: 1, icon: 'square'}],
        [[-40, 0], {rank: 2, icon: 'square'}]
      ]
    );
    expect(textPixels(image)).toBeGreaterThan(20);
    // Both icons, each 16x16, less what the text draws over the first.
    expect(iconPixels(image)).toBeGreaterThan(400);
  });

  test('an icon that allows overlap is drawn where it loses, and still hides later labels', async () => {
    // Pixel rows grow downwards from the center: the first label at y = 4, the second at -20.
    const image = await renderSymbols(
      {...LAYOUT, 'icon-allow-overlap': true, 'text-optional': true},
      [
        [[0, 0], {rank: 1, icon: 'square', iconSize: 4}],
        // Wins over the icon at the icon's anchor; the icon is drawn anyway.
        [[0, 4], {rank: 0, name: 'MMMM'}],
        // Its anchor is under the icon, so it is hidden.
        [[20, -20], {rank: 2, name: 'MMMM'}]
      ]
    );
    expect(iconPixels(image)).toBeGreaterThan(1000);
    expect(textPixels(cropRows(image, SIZE / 2 - 8, SIZE))).toBeGreaterThan(20);
    expect(textPixels(cropRows(image, 0, SIZE / 2 - 8))).toBe(0);
  });
});

/** The rows `[top, bottom)` of `image`, other pixels cleared. */
function cropRows(image: ImageData, top: number, bottom: number): ImageData {
  const data = new Uint8ClampedArray(image.data);
  data.fill(0, 0, top * image.width * 4);
  data.fill(0, bottom * image.width * 4);
  return new ImageData(data, image.width, image.height);
}
