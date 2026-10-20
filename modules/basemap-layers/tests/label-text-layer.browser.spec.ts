// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {
  LabelCharactersLayer,
  LabelTextLayer,
  LINE_GLYPH_ATTRIBUTE_STATS
} from '../src/label-text-layer';

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

/**
 * `TextLayer` with `LabelTextLayer`'s glyph layer, which antialiases edges as MapLibre GL JS: what
 * `LabelTextLayer` draws, but for its letter spacing, justification and shared font atlas texture.
 */
function referenceTextLayer(props: Record<string, unknown>): any {
  return new TextLayer({
    id: 'text',
    ...props,
    _subLayerProps: {
      characters: {type: LabelCharactersLayer, sdfRadius: (props as any).fontSettings.radius}
    }
  } as any);
}

describe('LabelTextLayer in the browser', () => {
  test('draws exactly what TextLayer draws with its glyph layer', async () => {
    const expected = await renderPixels(referenceTextLayer(PROPS));
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
      referenceTextLayer({...props, data: [{position: [0, 0], text}]})
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

  test('two views at different zooms keep their own glyphs, placed and uploaded once', async () => {
    // A main view and a smaller-scale view beside it, as a minimap. The glyphs are drawn at the
    // main view's zoom and hidden at the other's.
    const placed: string[] = [];
    const layer = new LabelTextLayer({
      id: 'text',
      ...PROPS,
      getLineGlyphs: (d: any, viewport: any) => {
        placed.push(viewport.id);
        const glyphs = new Float32Array(Array.from(d.text as string).length * 4);
        for (let i = 3; i < glyphs.length; i += 4) {
          glyphs[i] = viewport.zoom === 0 ? 0 : -1;
        }
        return glyphs;
      },
      getLineGlyphKey: (viewport: any) => String(viewport.zoom)
    } as any);
    parent = document.createElement('div');
    document.body.append(parent);
    // Pixels with ink in each view, read as a frame is drawn.
    const readInk = (): [number, number] => {
      const copy = document.createElement('canvas');
      copy.width = WIDTH * 2;
      copy.height = HEIGHT;
      const context = copy.getContext('2d')!;
      context.drawImage(deck!.getCanvas()!, 0, 0);
      return [0, WIDTH].map(x0 => {
        const {data} = context.getImageData(x0, 0, WIDTH, HEIGHT);
        let count = 0;
        for (let i = 3; i < data.length; i += 4) {
          count += data[i] > 128 ? 1 : 0;
        }
        return count;
      }) as [number, number];
    };
    const drawn = () =>
      new Promise<[number, number]>(resolve => {
        deck!.setProps({onAfterRender: () => resolve(readInk())});
        deck!.redraw('two views');
      });
    const first = await new Promise<[number, number]>((resolve, reject) => {
      deck = new Deck({
        parent: parent!,
        width: WIDTH * 2,
        height: HEIGHT,
        useDevicePixels: false,
        deviceProps: {adapters: [webgl2Adapter]},
        views: [
          new OrthographicView({id: 'main', x: 0, width: WIDTH}),
          new OrthographicView({id: 'mini', x: WIDTH, width: WIDTH})
        ],
        viewState: {
          main: {target: [0, 0, 0], zoom: 0},
          mini: {target: [0, 0, 0], zoom: -1}
        },
        layers: [layer],
        onAfterRender: () => {
          const layers = (deck as any)?.layerManager?.getLayers() || [];
          if (layers.length && layers.every((l: any) => l.isLoaded)) {
            resolve(readInk());
          }
        },
        onError: reject
      });
    });
    // Each view draws its own glyphs from the first frame: the main view's label, none in the other.
    expect(first[0]).toBeGreaterThan(20);
    expect(first[1]).toBe(0);
    await drawn();
    // Steady frames: neither view's glyphs are placed or uploaded again.
    placed.length = 0;
    const refreshes = LINE_GLYPH_ATTRIBUTE_STATS.refreshes;
    let ink: [number, number] = [0, 0];
    for (let frame = 0; frame < 4; frame++) {
      ink = await drawn();
    }
    expect(placed).toEqual([]);
    expect(LINE_GLYPH_ATTRIBUTE_STATS.refreshes).toBe(refreshes);
    expect(ink[0]).toBeGreaterThan(20);
    expect(ink[1]).toBe(0);

    // The other view zooms in to the main view's zoom: its glyphs are placed again, and drawn.
    deck!.setProps({
      viewState: {
        main: {target: [0, 0, 0], zoom: 0},
        mini: {target: [0, 0, 0], zoom: 0}
      }
    });
    ink = await drawn();
    expect(ink[0]).toBeGreaterThan(20);
    expect(ink[1]).toBeGreaterThan(20);

    // New rows, with the same text, whose glyphs are drawn straight (mode 0) or hidden (mode -1) at
    // every zoom. Deck updates layers in its animation frame, which `redraw` skips: the frame it
    // draws next is awaited instead.
    const updateRows = (mode: number) => {
      const updated = new Promise<[number, number]>(resolve => {
        deck!.setProps({onAfterRender: () => resolve(readInk())});
      });
      deck!.setProps({
        layers: [
          new LabelTextLayer({
            id: 'text',
            ...PROPS,
            data: [{position: [0, 0], text: PROPS.data[0].text}],
            getLineGlyphs: (d: any) => {
              const glyphs = new Float32Array(Array.from(d.text as string).length * 4);
              for (let i = 3; i < glyphs.length; i += 4) {
                glyphs[i] = mode;
              }
              return glyphs;
            },
            getLineGlyphKey: (viewport: any) => String(viewport.zoom)
          } as any)
        ]
      });
      return updated;
    };
    // The glyph attribute holds the view the layer was updated in, the other its own buffer: drawn
    // rows first, so that each view holds glyphs of the old rows when they are hidden. Neither view
    // draws them, from the frame that updates the layer.
    ink = await updateRows(0);
    expect(ink[0]).toBeGreaterThan(20);
    expect(ink[1]).toBeGreaterThan(20);
    ink = await updateRows(-1);
    expect(ink).toEqual([0, 0]);
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
