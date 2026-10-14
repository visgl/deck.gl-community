// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import TinySDF from '@mapbox/tiny-sdf';
import type {TextLayerProps} from '@deck.gl/layers';

type GetFontRenderer = NonNullable<TextLayerProps['_getFontRenderer']>;
type FontRenderer = ReturnType<GetFontRenderer>;
type FontSettings = Parameters<GetFontRenderer>[0];

/** `TextLayer`'s font metrics where `measureText` gives no bounding box, as shares of the size. */
const DEFAULT_ASCENT = 0.9;
const DEFAULT_DESCENT = 0.3;

/**
 * Splits `TextLayer`'s `fontWeight`, which may carry a style in front of the weight (`italic 400`,
 * see `getTextLayerFontWeight`), into a CSS font style and weight.
 */
function getFontStyle(fontWeight: string | number): {fontStyle: string; fontWeight: string} {
  const match = /^(italic|oblique)\s+(.*)$/.exec(String(fontWeight));
  return match
    ? {fontStyle: match[1], fontWeight: match[2]}
    : {fontStyle: 'normal', fontWeight: String(fontWeight)};
}

/**
 * TinySDF's drawing context, through which every glyph that reaches left of its origin is drawn
 * `shift` whole pixels to the right and measured as if it did not: TinySDF then keeps all its ink,
 * whatever its version. `shift` is set by `getLabelFontRenderer` before each glyph.
 */
function getShiftingContext(context: CanvasRenderingContext2D, shift: {pixels: number}) {
  return new Proxy(context, {
    get(target, property) {
      if (property === 'measureText') {
        return (text: string) => {
          const metrics = target.measureText(text);
          const pixels =
            metrics.actualBoundingBoxLeft > 0 ? Math.ceil(metrics.actualBoundingBoxLeft) : 0;
          shift.pixels = pixels;
          return {
            width: metrics.width,
            actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
            actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
            actualBoundingBoxLeft: metrics.actualBoundingBoxLeft - pixels,
            actualBoundingBoxRight: metrics.actualBoundingBoxRight + pixels,
            fontBoundingBoxAscent: metrics.fontBoundingBoxAscent,
            fontBoundingBoxDescent: metrics.fontBoundingBoxDescent
          };
        };
      }
      if (property === 'fillText') {
        return (text: string, x: number, y: number) => target.fillText(text, x + shift.pixels, y);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    }
  });
}

/**
 * The signed distance field font renderer of label text: `TextLayer`'s own, with the same TinySDF,
 * but keeping the part of a glyph left of its origin. `TextLayer` takes a glyph's origin at the left
 * edge of the distance field TinySDF draws: TinySDF 2.0 cuts off the left of `f`, `j`, `y` and other
 * italic glyphs that reach behind their origin, and TinySDF 2.2 and later draw every glyph from the
 * left edge of its ink (`glyphLeft`), which `TextLayer` then draws off its origin.
 *
 * `TextLayer` leaves `fontSettings.buffer` atlas pixels before each glyph's origin, so the distance
 * field left of a glyph is cut by the length of its overhang: a glyph keeps all its ink, and a halo
 * reaches `buffer` minus the overhang atlas pixels left of it (9 of 18 for Noto Sans Italic `j` in
 * a 64 px atlas, 1.7 px on 12 px text).
 */
export function getLabelFontRenderer(settings: FontSettings): FontRenderer {
  const {fontSize, buffer, radius, cutoff, fontFamily} = settings;
  const {fontStyle, fontWeight} = getFontStyle(settings.fontWeight);
  const tinySDF: any = new TinySDF({
    fontSize,
    buffer,
    radius,
    cutoff,
    fontFamily,
    fontWeight,
    fontStyle
  });
  const shift = {pixels: 0};
  tinySDF.ctx = getShiftingContext(tinySDF.ctx, shift);
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

  return {
    // As `TextLayer` measures, but for the width of a glyph that reaches left of its origin.
    measure(char?: string) {
      if (char === undefined) {
        const metrics = context.measureText('A');
        return metrics.fontBoundingBoxAscent
          ? {
              advance: 0,
              width: 0,
              ascent: Math.ceil(metrics.fontBoundingBoxAscent),
              descent: Math.ceil(metrics.fontBoundingBoxDescent)
            }
          : {
              advance: 0,
              width: 0,
              ascent: fontSize * DEFAULT_ASCENT,
              descent: fontSize * DEFAULT_DESCENT
            };
      }
      const metrics = context.measureText(char);
      if (!metrics.actualBoundingBoxAscent) {
        return {
          advance: metrics.width,
          width: metrics.width,
          ascent: fontSize * DEFAULT_ASCENT,
          descent: fontSize * DEFAULT_DESCENT
        };
      }
      // `TextLayer` takes `right - left`, which for a glyph reaching left of its origin (`left` > 0)
      // is short of its ink by twice the overhang. The cell must also hold what `draw` returns from
      // TinySDF 2.0, which sizes the shifted glyph from its rounded shift: `right - left + shift`.
      const {actualBoundingBoxLeft: inkLeft, actualBoundingBoxRight: inkRight} = metrics;
      const width =
        inkLeft > 0
          ? Math.max(
              Math.ceil(inkRight + inkLeft),
              Math.ceil(inkRight - inkLeft + Math.ceil(inkLeft))
            )
          : Math.ceil(inkRight - inkLeft);
      return {
        advance: metrics.width,
        width,
        ascent: Math.ceil(metrics.actualBoundingBoxAscent),
        descent: Math.ceil(metrics.actualBoundingBoxDescent)
      };
    },
    draw(char: string) {
      const glyph = tinySDF.draw(char);
      // The glyph's origin is `shift.pixels` right of the buffer (and `glyphLeft` left of it, from
      // TinySDF 2.2); that many columns of distance field are cut from the left.
      const cut = Math.min(shift.pixels, Math.max(0, glyph.width - 1));
      const width = Math.max(1, glyph.width - cut);
      const height = Math.max(1, glyph.height);
      const data = new ImageData(width, height);
      for (let y = 0; y < glyph.height; y++) {
        for (let x = 0; x < width; x++) {
          data.data[4 * (y * width + x) + 3] = glyph.data[y * glyph.width + x + cut];
        }
      }
      return {data, left: buffer + shift.pixels - (glyph.glyphLeft || 0) - cut, top: buffer};
    }
  };
}
