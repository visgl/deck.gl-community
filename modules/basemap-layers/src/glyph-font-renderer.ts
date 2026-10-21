// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import TinySDF from '@mapbox/tiny-sdf';
import type {TextLayerProps} from '@deck.gl/layers';
import {GLYPH_BORDER, GLYPH_EM} from './glyph-pbf';
import type {Glyph} from './glyph-pbf';
import {isLocalGlyph} from './glyph-store';
import type {GlyphStore} from './glyph-store';

type GetFontRenderer = NonNullable<TextLayerProps['_getFontRenderer']>;
type FontRenderer = ReturnType<GetFontRenderer>;

/**
 * `TextLayer`'s font settings for glyphs from a style's `glyphs` URL: distance fields one em of
 * {@link GLYPH_EM} pixels high, reaching 8 pixels, with the edge at 0.75, as MapLibre GL JS draws
 * them. Cells are packed `buffer` pixels apart, the border of the glyph bitmaps.
 */
export const GLYPH_FONT_SETTINGS = {
  sdf: true,
  fontSize: GLYPH_EM,
  buffer: GLYPH_BORDER,
  radius: 8,
  cutoff: 0.25,
  smoothing: 0.1
};

/**
 * MapLibre GL JS sets each line's glyphs this many pixels below the line's top, at one em of
 * {@link GLYPH_EM} pixels (`SHAPING_DEFAULT_OFFSET`, negated).
 */
const LINE_GLYPH_OFFSET = 17;

/**
 * MapLibre GL JS's alignment of a glyph drawn with the browser's fonts (see `isLocalGlyph`) with
 * the glyphs of glyph ranges, whose `top` is measured from above the em box.
 */
const LOCAL_GLYPH_TOP = 27.5;
const LOCAL_GLYPH_LEFT = 0.5;

/** The font-weight MapLibre GL JS draws local glyphs in, from the font stack's names. */
function getLocalGlyphWeight(fontStack: string): string {
  if (/bold/i.test(fontStack)) return '900';
  if (/medium/i.test(fontStack)) return '500';
  if (/light/i.test(fontStack)) return '200';
  return '400';
}

const LOCAL_GLYPH_SDFS = new Map<string, TinySDF>();

/**
 * A glyph that MapLibre GL JS draws with the browser's fonts, as a glyph of a glyph range. MapLibre
 * draws these at twice the resolution; here they share the one-em atlas of the other glyphs.
 */
function getLocalGlyph(fontStack: string, codePoint: number): Glyph | null {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
    return null;
  }
  const fontWeight = getLocalGlyphWeight(fontStack);
  let sdf = LOCAL_GLYPH_SDFS.get(fontWeight);
  if (!sdf) {
    sdf = new TinySDF({
      fontSize: GLYPH_EM,
      buffer: GLYPH_BORDER,
      radius: GLYPH_FONT_SETTINGS.radius,
      cutoff: GLYPH_FONT_SETTINGS.cutoff,
      fontFamily: 'sans-serif',
      fontWeight
    });
    LOCAL_GLYPH_SDFS.set(fontWeight, sdf);
  }
  const drawn = sdf.draw(String.fromCodePoint(codePoint));
  const width = drawn.glyphWidth;
  const height = drawn.glyphHeight;
  return {
    id: codePoint,
    // TinySDF draws `glyphWidth + 2 * buffer` by `glyphHeight + 2 * buffer`, as a glyph range does.
    bitmap: width && height ? drawn.data : new Uint8Array(0),
    width: width && height ? width : 0,
    height: width && height ? height : 0,
    left: drawn.glyphLeft + LOCAL_GLYPH_LEFT,
    top: drawn.glyphTop - LOCAL_GLYPH_TOP,
    advance: drawn.glyphAdvance
  };
}

/**
 * The glyph a character of `fontStack` is drawn with: from the store's ranges, or with the browser's
 * fonts for the characters MapLibre GL JS draws so. Null while its range loads, and when the range
 * has none: the character is then not drawn, as in MapLibre.
 */
export function getStyleGlyph(
  store: GlyphStore,
  fontStack: string,
  character: string
): Glyph | null {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return null;
  }
  if (isLocalGlyph(codePoint)) {
    return getLocalGlyph(fontStack, codePoint);
  }
  return store.getGlyph(fontStack, codePoint) ?? null;
}

/**
 * A function giving a character's advance in ems: the glyph's advance, as MapLibre GL JS lays text
 * out. A character without a glyph advances nothing.
 */
export function getGlyphCharacterMeasurer(
  store: GlyphStore,
  fontStack: string
): (character: string) => number {
  const widths = new Map<string, number>();
  return character => {
    let width = widths.get(character);
    if (width === undefined) {
      const glyph = getStyleGlyph(store, fontStack, character);
      width = (glyph?.advance ?? 0) / GLYPH_EM;
      // A character whose range is still loading is measured again once it has loaded.
      if (glyph || store.hasGlyphs(fontStack, character)) {
        widths.set(character, width);
      }
    }
    return width;
  };
}

/**
 * `TextLayer`'s font renderer for the glyphs of a font stack. With
 * {@link GLYPH_FONT_SETTINGS}, `TextLayer` lays each character's glyph out as MapLibre GL JS does:
 * the line's baseline offset puts it {@link LINE_GLYPH_OFFSET} pixels below the line's top, and the
 * glyph's bitmap is drawn `top` pixels below that and `left` pixels right of the pen.
 */
export function getGlyphFontRenderer(store: GlyphStore, fontStack: string): FontRenderer {
  return {
    measure(character?: string) {
      if (character === undefined) {
        // `TextLayer` sets the baseline `(ascent - descent) / 2` from the middle of the line.
        return {advance: 0, width: 0, ascent: 0, descent: 2 * LINE_GLYPH_OFFSET};
      }
      const glyph = getStyleGlyph(store, fontStack, character);
      if (!glyph) {
        return {advance: 0, width: 0, ascent: 0, descent: 0};
      }
      return {
        advance: glyph.advance,
        width: glyph.width,
        ascent: glyph.top,
        descent: glyph.height - glyph.top
      };
    },
    draw(character: string) {
      const glyph = getStyleGlyph(store, fontStack, character);
      if (!glyph || !glyph.bitmap.length) {
        return {data: new ImageData(1, 1), left: 0, top: 0};
      }
      const width = glyph.width + 2 * GLYPH_BORDER;
      const height = glyph.height + 2 * GLYPH_BORDER;
      const data = new ImageData(width, height);
      for (let i = 0; i < glyph.bitmap.length; i++) {
        data.data[4 * i + 3] = glyph.bitmap[i];
      }
      return {data, left: GLYPH_BORDER - glyph.left, top: GLYPH_BORDER};
    }
  };
}
