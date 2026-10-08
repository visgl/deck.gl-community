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
function renderLabel(layout: Record<string, unknown>, props: Record<string, unknown> = {}) {
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
          styleLayer: {layout, paint: {}},
          textColor: [0, 0, 0, 255],
          ...props,
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

/** Number of pixels that differ between two frames. */
function differingPixels(a: ImageData, b: ImageData): number {
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i + 3] - b.data[i + 3]) > 64 || Math.abs(a.data[i] - b.data[i]) > 64) {
      count++;
    }
  }
  return count;
}

describe('text-font in the browser', () => {
  test('a label whose fonts are not installed draws in the generic family', async () => {
    const image = await renderLabel({
      'text-field': 'MMMM',
      'text-size': 16,
      'text-font': ['No Such Font Regular', 'Another Missing Font Regular']
    });
    expect(textPixels(image)).toBeGreaterThan(20);
  });

  test('a Bold font draws heavier text than a Regular one', async () => {
    const layout = {'text-field': 'MMMM', 'text-size': 16};
    const regular = textPixels(await renderLabel({...layout, 'text-font': ['Noto Sans Regular']}));
    deck?.finalize();
    parent?.remove();
    const bold = textPixels(await renderLabel({...layout, 'text-font': ['Noto Sans Bold']}));
    expect(bold).toBeGreaterThan(regular * 1.2);
  });

  test('an Italic font draws slanted text', async () => {
    const layout = {'text-field': 'IIII', 'text-size': 24};
    const upright = await renderLabel({...layout, 'text-font': ['Noto Sans Regular']});
    deck?.finalize();
    parent?.remove();
    const italic = await renderLabel({...layout, 'text-font': ['Noto Sans Italic']});
    expect(differingPixels(upright, italic)).toBeGreaterThan(20);
  });
});
