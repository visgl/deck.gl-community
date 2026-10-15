// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {LabelTextLayer} from '../src/label-text-layer';

const WIDTH = 320;
const HEIGHT = 64;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/**
 * Renders `layer` and returns the RGBA pixels of the frame. With `next`, renders `layer`, then
 * replaces it with `next` and returns the pixels of `next`.
 */
function renderPixels(layer: any, next?: any): Promise<Uint8ClampedArray> {
  let pending = next;
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
        if (pending) {
          deck!.setProps({layers: [pending]});
          pending = null;
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
  // Large enough that the atlas is sampled from its own two levels only: `LabelTextLayer` keeps no
  // smaller ones (see `LABEL_ATLAS_MIP_LEVELS`), `TextLayer` the full chain.
  getSize: 40,
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

  test('draws the glyphs of an atlas that grows with new characters', async () => {
    // Font settings of their own, so that no other test has cached an atlas with these characters.
    const props = {...PROPS, fontSettings: {...PROPS.fontSettings, fontSize: 60}};
    const text = 'Qj Wz';
    const actual = await renderPixels(
      new LabelTextLayer({id: 'text', ...props, data: [{position: [0, 0], text: 'Qj'}]} as any),
      new LabelTextLayer({id: 'text', ...props, data: [{position: [0, 0], text}]} as any)
    );
    deck?.finalize();
    parent?.remove();
    const expected = await renderPixels(
      new TextLayer({id: 'text', ...props, data: [{position: [0, 0], text}]} as any)
    );
    expect(actual.some(value => value > 0)).toBe(true);
    expect([...actual]).toEqual([...expected]);
  });

  test('draws no glyph of a label that getLineGlyphs hides, and all of one it draws straight', async () => {
    const withMode = (mode: number) => ({
      ...PROPS,
      getLineGlyphs: (d: any) => {
        const glyphs = new Float32Array(Array.from(d.text as string).length * 4);
        for (let i = 3; i < glyphs.length; i += 4) {
          glyphs[i] = mode;
        }
        return glyphs;
      },
      getLineGlyphKey: () => String(mode)
    });
    const hidden = await renderPixels(new LabelTextLayer({id: 'text', ...withMode(-1)} as any));
    deck?.finalize();
    parent?.remove();
    const straight = await renderPixels(new LabelTextLayer({id: 'text', ...withMode(0)} as any));
    expect(straight.some(value => value > 0)).toBe(true);
    expect(hidden.some(value => value > 0)).toBe(false);
  });

  test('a label whose glyphs are placed along a line is picked by its glyphs, not its box', async () => {
    // The glyphs right of the anchor, 8 pixels apart, off the left half of the straight label's box.
    const props = {
      ...PROPS,
      pickable: true,
      getLineGlyphs: (d: any) => {
        const count = Array.from(d.text as string).length;
        const glyphs = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
          glyphs.set([50 + i * 8, 0, 0, 1], i * 4);
        }
        return glyphs;
      },
      getLineGlyphKey: () => 'right'
    };
    const pixels = await renderPixels(new LabelTextLayer({id: 'text', ...props} as any));
    // Ink right of the middle; the left half of the straight label's box is empty.
    let inkRight = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = WIDTH / 2 + 20; x < WIDTH; x++) {
        inkRight += pixels[(y * WIDTH + x) * 4 + 3] > 128 ? 1 : 0;
      }
    }
    expect(inkRight).toBeGreaterThan(20);
    const pick = (x: number) =>
      (deck as any).pickObject({x, y: HEIGHT / 2, radius: 0})?.object ?? null;
    expect(pick(WIDTH / 2 - 30)).toBe(null);
    let picked = null;
    for (let x = WIDTH / 2 + 20; x < WIDTH && !picked; x++) {
      picked = pick(x);
    }
    expect(picked).toBe(props.data[0]);
  });
});
