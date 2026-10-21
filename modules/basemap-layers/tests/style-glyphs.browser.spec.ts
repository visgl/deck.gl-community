// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Labels drawn with the style's `glyphs`: a layer's labels wait for the glyph ranges of their text,
 * and are then drawn from those glyphs. `reference-render` compares the glyphs drawn with MapLibre
 * GL JS's; this checks the loading.
 */

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {GlyphStore} from '../src/glyph-store';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const SIZE = 128;
const RANGE_URL = new URL(
  './reference-render/fixtures/tiles.openfreemap.org/fonts/Noto Sans Regular/0-255.pbf',
  import.meta.url
).href;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** Dark pixels of the last frame drawn, on white, or -1 before the first. */
let ink = -1;

/** Counts the dark pixels of the frame just drawn, read while the drawing buffer holds it. */
function measureInk(): number {
  const copy = document.createElement('canvas');
  copy.width = SIZE;
  copy.height = SIZE;
  const context = copy.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, SIZE, SIZE);
  context.drawImage(deck!.getCanvas()!, 0, 0);
  const {data} = context.getImageData(0, 0, SIZE, SIZE);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] < 384) count++;
  }
  return count;
}

/** Resolves when `predicate` holds, checked after each frame, or rejects after `timeout` ms. */
function waitFor(predicate: () => boolean, timeout = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const check = () => {
      if (predicate()) {
        resolve();
      } else if (performance.now() - start > timeout) {
        reject(new Error(`Timed out: ink ${ink}`));
      } else {
        deck?.redraw('test');
        window.setTimeout(check, 50);
      }
    };
    check();
  });
}

const getLabelLayer = () =>
  ((deck as any)?.layerManager?.getLayers() || []).find((layer: any) => layer.id === 'labels');

describe('labels with the style glyphs', () => {
  test('wait for their glyph range, then draw from it', async () => {
    const requests: string[] = [];
    let release!: () => void;
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    const glyphs = new GlyphStore({
      url: 'https://glyphs.example.com/{fontstack}/{range}.pbf',
      fetch: (async (url: string) => {
        requests.push(url);
        await released;
        return fetch(RANGE_URL);
      }) as typeof fetch
    });

    parent = document.createElement('div');
    document.body.append(parent);
    ink = -1;
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
          glyphs,
          styleLayer: {
            layout: {'text-field': 'Glyphs', 'text-font': ['Noto Sans Regular'], 'text-size': 24},
            paint: {}
          },
          textColor: [0, 0, 0, 255],
          data: [{type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}}]
        } as any)
      ],
      onAfterRender: () => {
        ink = measureInk();
      }
    });

    // The range is requested, and the label waits for it: its layer is not loaded, nothing drawn.
    await waitFor(() => requests.length > 0 && ink >= 0);
    expect(requests).toEqual(['https://glyphs.example.com/Noto%20Sans%20Regular/0-255.pbf']);
    expect(getLabelLayer()?.isLoaded).toBe(false);
    expect(ink).toBe(0);

    release();
    await waitFor(() => getLabelLayer()?.isLoaded && ink > 50);
    expect(requests).toHaveLength(1);
  }, 60_000);
});
