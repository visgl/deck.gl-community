// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {LabelTextLayer} from '../src/label-text-layer';

const WIDTH = 160;
const HEIGHT = 48;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** Renders `layer` and returns the RGBA pixels of the frame. */
function renderPixels(layer: any): Promise<Uint8ClampedArray> {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: WIDTH,
      height: HEIGHT,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'text-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [layer],
      onAfterRender: () => {
        const layers = (deck as any)?.layerManager?.getLayers() || [];
        if (!layers.length || layers.some((l: any) => !l.isLoaded)) {
          return;
        }
        const copy = document.createElement('canvas');
        copy.width = WIDTH;
        copy.height = HEIGHT;
        const context = copy.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        window.clearTimeout(timeout);
        resolve(context.getImageData(0, 0, WIDTH, HEIGHT).data);
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

const PROPS = {
  data: [{position: [0, 0], text: 'Montrouge Sy'}],
  getPosition: (d: any) => d.position,
  getText: (d: any) => d.text,
  getSize: 20,
  characterSet: 'auto',
  fontSettings: {sdf: true, fontSize: 64, buffer: 18, radius: 24, cutoff: 0.24, smoothing: 0.1},
  outlineWidth: 2,
  outlineColor: [255, 255, 255, 255],
  background: true,
  getBackgroundColor: [0, 0, 0, 0]
};

describe('LabelTextLayer in the browser', () => {
  test('draws exactly what TextLayer draws', async () => {
    const expected = await renderPixels(new TextLayer({id: 'text', ...PROPS} as any));
    deck?.finalize();
    parent?.remove();
    const actual = await renderPixels(new LabelTextLayer({id: 'text', ...PROPS} as any));
    expect(actual.some(value => value > 0)).toBe(true);
    expect([...actual]).toEqual([...expected]);
  });
});
