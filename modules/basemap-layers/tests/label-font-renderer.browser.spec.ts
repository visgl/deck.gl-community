// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import '@fontsource/noto-sans/latin-400-italic.css';
import {Deck, OrthographicView} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, beforeAll, describe, expect, test} from 'vitest';
import {getLabelFontRenderer} from '../src/label-font-renderer';
import {LabelTextLayer} from '../src/label-text-layer';

const SETTINGS = {
  sdf: true,
  fontSize: 64,
  buffer: 18,
  radius: 24,
  cutoff: 0.24,
  smoothing: 0.1,
  fontFamily: '"Noto Sans"',
  fontWeight: 'italic 400',
  characterSet: [],
  // Only for the label layer below: a size of its own, so that no other test has cached its atlas.
  _fontSize: 60
};

/** Glyphs of Noto Sans Italic that reach left of their origin, and some that do not. */
const TEXT = 'fjord yfx Jefferson';

/** Distance field value at the drawn glyph edge, 0.75 of 255. */
const EDGE = 192;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

beforeAll(async () => {
  await document.fonts.load('italic 400 16px "Noto Sans"');
});

/** A glyph's ink in each column, by column from its origin: the browser's coverage above half. */
function getInkColumns(char: string): Map<number, number> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 200;
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.font = 'italic 400 64px "Noto Sans"';
  context.fillText(char, 100, 120);
  const {data} = context.getImageData(0, 0, 200, 200);
  const columns = new Map<number, number>();
  for (let x = 0; x < 200; x++) {
    for (let y = 0; y < 200; y++) {
      if (data[(y * 200 + x) * 4 + 3] >= 128) {
        columns.set(x - 100, (columns.get(x - 100) || 0) + 1);
      }
    }
  }
  return columns;
}

/** The inside of a glyph's distance field in each column, by column from its reported origin. */
function getFieldColumns(image: ImageData, left: number): Map<number, number> {
  const columns = new Map<number, number>();
  for (let x = 0; x < image.width; x++) {
    for (let y = 0; y < image.height; y++) {
      if (image.data[(y * image.width + x) * 4 + 3] >= EDGE) {
        columns.set(x - left, (columns.get(x - left) || 0) + 1);
      }
    }
  }
  return columns;
}

/** The share of `a`'s pixels that `b` does not have in the same columns, and the reverse. */
function getColumnMismatch(a: Map<number, number>, b: Map<number, number>): number {
  let total = 0;
  let mismatch = 0;
  for (const x of new Set([...a.keys(), ...b.keys()])) {
    total += a.get(x) || 0;
    mismatch += Math.abs((a.get(x) || 0) - (b.get(x) || 0));
  }
  return mismatch / total;
}

/** Draws `TEXT` with `Layer` and returns the layer once its font atlas is drawn. */
function renderText(Layer: any, fontSize: number): Promise<any> {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise<any>((resolve, reject) => {
    deck = new Deck({
      parent: parent!,
      width: 64,
      height: 32,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'atlas-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new Layer({
          id: 'text',
          data: [{text: TEXT}],
          getPosition: () => [0, 0],
          getText: (d: any) => d.text,
          characterSet: 'auto',
          fontFamily: SETTINGS.fontFamily,
          fontWeight: SETTINGS.fontWeight,
          fontSettings: {...SETTINGS, fontSize}
        })
      ],
      onAfterRender: () => {
        const [text] = (deck as any).layerManager.getLayers({layerIds: ['text']});
        if (text?.state.fontAtlasManager.atlas) {
          resolve(text);
        }
      },
      onError: reject
    });
  });
}

/** Checks that each glyph cell of a layer's font atlas holds what `getLabelFontRenderer` draws. */
function expectAtlasDrawnByRenderer(layer: any, fontSize: number): void {
  const {atlas} = layer.state.fontAtlasManager;
  const context = (atlas.data as HTMLCanvasElement).getContext('2d')!;
  const renderer = getLabelFontRenderer({...SETTINGS, fontSize} as any);
  for (const char of new Set(TEXT)) {
    const frame = atlas.mapping[char];
    const expected = renderer.draw(char).data;
    const actual = context.getImageData(frame.x, frame.y, frame.width, frame.height);
    let differing = 0;
    for (let i = 3; i < actual.data.length; i += 4) {
      if (actual.data[i] !== expected.data[i]) {
        differing++;
      }
    }
    expect(differing, `${char}: pixels of its cell not as the renderer draws them`).toBe(0);
  }
}

describe('getLabelFontRenderer', () => {
  test('keeps the part of italic glyphs left of their origin, where it is drawn', () => {
    const renderer = getLabelFontRenderer(SETTINGS as any);
    for (const char of 'fjyxJQo') {
      const {data, left = 0} = renderer.draw(char);
      // Column by column from the origin, the distance field's inside holds the glyph's ink. TinySDF
      // 2.2 and later draw strokes about 9% heavier than 2.0 (7% and 16% of the ink elsewhere); a
      // glyph drawn off its origin puts most of its ink elsewhere.
      const mismatch = getColumnMismatch(getInkColumns(char), getFieldColumns(data, left));
      expect(mismatch, `${char}: ink in other columns`).toBeLessThan(0.25);
    }
  });

  test("fits every glyph's distance field in the atlas cell measured for it", () => {
    // `TextLayer` places a glyph's image `buffer - left` into a cell of `width + 2 * buffer`.
    for (const fontWeight of ['italic 400', '400']) {
      const renderer = getLabelFontRenderer({...SETTINGS, fontWeight} as any);
      for (let code = 33; code < 127; code++) {
        const char = String.fromCharCode(code);
        const {width} = renderer.measure(char);
        const {data, left = 0} = renderer.draw(char);
        const start = SETTINGS.buffer - left;
        expect(start, `${fontWeight} ${char}: starts before its cell`).toBeGreaterThanOrEqual(0);
        expect(
          start + data.width,
          `${fontWeight} ${char}: ends after its cell`
        ).toBeLessThanOrEqual(width + 2 * SETTINGS.buffer);
      }
    }
  });

  test('fits a glyph with a fractional overhang in its atlas cell', () => {
    // Metrics of a glyph reaching 0.2 px left of its origin and 10.8 px right of it, from either
    // kind of canvas (TinySDF 2.2 and later draw on an OffscreenCanvas).
    const contexts = [CanvasRenderingContext2D, OffscreenCanvasRenderingContext2D].map(
      Context => Context.prototype as any
    );
    const measures = contexts.map(context => context.measureText);
    contexts.forEach((context, index) => {
      context.measureText = function measure(this: any, text: string) {
        return stubMetrics(measures[index].call(this, text));
      };
    });
    function stubMetrics(metrics: TextMetrics): TextMetrics {
      return {
        width: 11,
        actualBoundingBoxLeft: 0.2,
        actualBoundingBoxRight: 10.8,
        actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
        actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
        fontBoundingBoxAscent: metrics.fontBoundingBoxAscent,
        fontBoundingBoxDescent: metrics.fontBoundingBoxDescent
      } as TextMetrics;
    }
    try {
      const renderer = getLabelFontRenderer(SETTINGS as any);
      const {width} = renderer.measure('l');
      const {data, left = 0} = renderer.draw('l');
      expect(SETTINGS.buffer - left + data.width).toBeLessThanOrEqual(width + 2 * SETTINGS.buffer);
    } finally {
      contexts.forEach((context, index) => {
        context.measureText = measures[index];
      });
    }
  });

  test('packs the font atlas so that no glyph overwrites another', async () => {
    const layer = await renderText(LabelTextLayer, SETTINGS._fontSize);
    expectAtlasDrawnByRenderer(layer, SETTINGS._fontSize);
  });

  test('draws its own font atlas where a TextLayer of the same font and settings drew one', async () => {
    // The stock layer draws the atlas first, with deck.gl's own renderer.
    const fontSize = SETTINGS._fontSize - 2;
    await renderText(TextLayer, fontSize);
    deck?.finalize();
    parent?.remove();
    const layer = await renderText(LabelTextLayer, fontSize);
    expectAtlasDrawnByRenderer(layer, fontSize);
  });
});
