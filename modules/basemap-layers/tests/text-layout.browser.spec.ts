// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {getCharacterWidthMeasurer} from '../src/text-layout';

const SIZE = 256;

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

/** Returns the spans of rows and columns containing any ink. */
function inkSpan(image: ImageData): {rows: number; columns: number} {
  let left = SIZE;
  let right = -1;
  let top = SIZE;
  let bottom = -1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (image.data[(y * SIZE + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return {rows: Math.max(0, bottom - top + 1), columns: Math.max(0, right - left + 1)};
}

describe('text layout in the browser', () => {
  test('measures actual glyph advances', () => {
    const measure = getCharacterWidthMeasurer('400', 'sans-serif');
    expect(measure('W')).toBeGreaterThan(measure('i'));
  });

  test('wrapped labels draw taller and narrower than unwrapped labels', async () => {
    const layout = {'text-field': 'Lorem ipsum dolor sit amet consectetur', 'text-size': 12};
    const wrapped = inkSpan(await renderLabel({...layout, 'text-max-width': 5}));
    deck?.finalize();
    parent?.remove();
    const unwrapped = inkSpan(await renderLabel({...layout, 'text-max-width': 100}));
    expect(unwrapped.rows).toBeGreaterThan(0);
    expect(wrapped.columns).toBeGreaterThan(0);
    expect(wrapped.rows).toBeGreaterThan(unwrapped.rows * 2);
    expect(wrapped.columns).toBeLessThan(unwrapped.columns * 0.6);
  });
});
