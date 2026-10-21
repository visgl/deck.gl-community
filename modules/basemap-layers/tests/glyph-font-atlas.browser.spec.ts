// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test} from 'vitest';
// The font atlas manager `TextLayer` draws with, which `@deck.gl/layers` does not export.
// eslint-disable-next-line import/no-relative-packages
import FontAtlasManager from '../../../node_modules/@deck.gl/layers/dist/text-layer/font-atlas-manager.js';
import type {Glyph} from '../src/glyph-pbf';
import {GlyphStore} from '../src/glyph-store';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const URL_TEMPLATE = 'https://glyphs.example/{fontstack}/{range}.pbf';
const STYLE_LAYER = {layout: {'text-field': 'A', 'text-font': ['literal', ['Noto Sans Regular']]}};

/**
 * A glyph store at {@link URL_TEMPLATE} whose every glyph is a square of `size` pixels of the
 * distance `value`, advancing `advance` pixels, as if its ranges had loaded.
 */
class FixedGlyphStore extends GlyphStore {
  constructor(
    private readonly advance: number,
    private readonly size: number,
    private readonly value: number
  ) {
    super({url: URL_TEMPLATE});
  }

  override getGlyph(_fontStack: string, codePoint: number): Glyph {
    const side = this.size + 6;
    return {
      id: codePoint,
      bitmap: new Uint8Array(side * side).fill(this.value),
      width: this.size,
      height: this.size,
      left: 0,
      top: 0,
      advance: this.advance
    };
  }
}

/** The atlas `TextLayer` draws a label layer's text `A` with, of the layer's font props. */
function getAtlas(glyphs: GlyphStore) {
  const layer = new MVTLabelLayer({id: 'labels', styleLayer: STYLE_LAYER, glyphs} as any);
  const manager = new FontAtlasManager();
  manager.setProps({...(layer.getFontProps() as any), characterSet: new Set(['A'])});
  const {atlas} = manager;
  const frame = atlas!.mapping.A;
  const pixel = (atlas!.data as HTMLCanvasElement)
    .getContext('2d')!
    .getImageData(frame.x + frame.width / 2, frame.y + frame.height / 2, 1, 1).data[3];
  return {atlas, layer, advance: frame.advance, width: frame.width, pixel};
}

describe('the font atlas of a glyph store', () => {
  test('is drawn again for a new store at the same URL', () => {
    const first = getAtlas(new FixedGlyphStore(10, 8, 100));
    const second = getAtlas(new FixedGlyphStore(20, 16, 200));

    expect(first.advance).toBe(10);
    expect(second.advance).toBe(20);
    expect(second.width).toBeGreaterThan(first.width);
    expect(first.pixel).toBe(100);
    expect(second.pixel).toBe(200);
    expect(second.atlas).not.toBe(first.atlas);
    // The text is measured again with the new store too.
    expect(second.layer.getFontKey()).not.toBe(first.layer.getFontKey());
  });

  test('is shared by the layers of one store', () => {
    const glyphs = new FixedGlyphStore(10, 8, 100);
    const first = getAtlas(glyphs);
    const second = getAtlas(glyphs);

    expect(second.atlas).toBe(first.atlas);
    expect(second.layer.getFontKey()).toBe(first.layer.getFontKey());
  });
});
