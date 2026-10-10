// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** Renders one collision-filtered point label at the canvas center and returns the frame. */
function renderLabel(layout: Record<string, unknown>, paint: Record<string, unknown> = {}) {
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
      views: new OrthographicView({id: 'label-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'labels',
          config: {labels: true},
          zoom: 8,
          styleLayer: {layout, paint},
          textColor: [0, 0, 0, 255],
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

/** Number of opaque, dark (text-colored) pixels in rows `[top, bottom)`. */
function textPixels(image: ImageData, top = 0, bottom = SIZE): number {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (image.data[i + 3] > 200 && image.data[i] < 80) {
        count++;
      }
    }
  }
  return count;
}

describe('collision-filtered labels in the browser', () => {
  test('a centered label draws at full opacity', async () => {
    const image = await renderLabel({'text-field': 'MMMM', 'text-size': 16});
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a label moved off its anchor by text-offset still draws', async () => {
    const image = await renderLabel({
      'text-field': 'MMMM',
      'text-size': 16,
      'text-anchor': 'top',
      'text-offset': [0, 1.5]
    });
    // The text starts 24 pixels below the anchor at the canvas center.
    expect(textPixels(image, SIZE / 2 + 20, SIZE)).toBeGreaterThan(20);
  });

  test('a label anchored at its top edge draws at full opacity', async () => {
    const image = await renderLabel({'text-field': 'MMMM', 'text-size': 16, 'text-anchor': 'top'});
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a label anchored at its left edge draws at full opacity', async () => {
    const image = await renderLabel({'text-field': 'MMMM', 'text-size': 16, 'text-anchor': 'left'});
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a haloed label moved off its anchor still draws', async () => {
    const image = await renderLabel(
      {'text-field': 'MMMM', 'text-size': 16, 'text-anchor': 'top', 'text-offset': [0, 1.5]},
      {'text-halo-color': '#ffffff', 'text-halo-width': 2}
    );
    expect(textPixels(image, SIZE / 2 + 20, SIZE)).toBeGreaterThan(20);
  });
});

/** Whether the pixel at `[x, y]` is opaque and dark (text-colored). */
function isTextPixel(image: ImageData, x: number, y: number): boolean {
  const i = (y * SIZE + x) * 4;
  return image.data[i + 3] > 200 && image.data[i] < 80;
}

/** Pixels of the halo color: opaque and red. */
function haloPixels(image: ImageData): Array<[number, number]> {
  const pixels: Array<[number, number]> = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (image.data[i + 3] > 200 && image.data[i] > 200 && image.data[i + 1] < 80) {
        pixels.push([x, y]);
      }
    }
  }
  return pixels;
}

/** Whether a text-colored pixel lies within `radius` pixels of `[x, y]`. */
function isNearText(image: ImageData, [x, y]: [number, number], radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && py >= 0 && px < SIZE && py < SIZE && isTextPixel(image, px, py)) {
        return true;
      }
    }
  }
  return false;
}

describe('label halos in the browser', () => {
  const layout = {'text-field': 'MM', 'text-size': 16};
  const RED_HALO = {'text-halo-color': '#ff0000'};

  test('a halo outlines the glyphs instead of filling a box', async () => {
    const image = await renderLabel(layout, {...RED_HALO, 'text-halo-width': 2});
    const halo = haloPixels(image);
    expect(halo.length).toBeGreaterThan(50);
    // Every halo pixel is next to the text; a box would also fill the space around the letters.
    expect(halo.filter(pixel => !isNearText(image, pixel, 3))).toEqual([]);
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a halo is as wide as text-halo-width', async () => {
    const widths: number[] = [];
    for (const width of [1, 2, 4]) {
      const image = await renderLabel(
        {...layout, 'text-size': 32},
        {...RED_HALO, 'text-halo-width': width}
      );
      // Halo pixels left of the first letter, on the row through the label's center.
      let run = 0;
      for (let x = 0; x < SIZE && !isTextPixel(image, x, SIZE / 2); x++) {
        const i = ((SIZE / 2) * SIZE + x) * 4;
        run += image.data[i + 3] > 128 && image.data[i] > 128 && image.data[i + 1] < 128 ? 1 : 0;
      }
      widths.push(run);
      deck?.finalize();
      deck = null;
      parent?.remove();
      parent = null;
    }
    expect(widths).toEqual([1, 2, 4]);
  });

  test('a text-halo-width of 0 draws no halo', async () => {
    const image = await renderLabel(layout, {...RED_HALO, 'text-halo-width': 0});
    expect(haloPixels(image)).toEqual([]);
    expect(textPixels(image)).toBeGreaterThan(20);
  });
});
