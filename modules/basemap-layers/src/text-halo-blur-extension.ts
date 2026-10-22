// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';

/**
 * MapLibre GL JS's symbol shader widens the halo edge by `text-halo-blur * 1.19` pixels on each
 * side of the halo edge, on top of the edge's own antialiasing.
 */
const MAPLIBRE_HALO_BLUR_SCALE = 1.19;

/**
 * Converts a `text-halo-blur`, in pixels, to the signed distance by which `TextLayer`'s halo edge
 * fades on each side, beyond the edge's own smoothing, for text of `textSize` pixels drawn from a
 * font atlas of `fontSize` pixels whose distance field reaches `radius` atlas pixels. As in
 * MapLibre, the fade is `1.19 * blur` screen pixels on each side of the halo edge; an atlas pixel
 * is `textSize / fontSize` screen pixels and `1 / radius` of the distance field.
 */
export function getHaloBlurGamma(
  haloBlur: number,
  textSize: number,
  {fontSize, radius}: {fontSize: number; radius: number}
): number {
  if (!(haloBlur > 0) || !(textSize > 0)) {
    return 0;
  }
  const atlasPixels = (MAPLIBRE_HALO_BLUR_SCALE * haloBlur * fontSize) / textSize;
  // Rounded so that labels whose blurs differ imperceptibly share one text sublayer.
  return Math.round((atlasPixels / radius) * 1000) / 1000;
}

const textHaloBlurModule = {
  name: 'textHaloBlur',
  fs: /* glsl */ `\
layout(std140) uniform textHaloBlurUniforms {
  float gamma;
  float capped;
} textHaloBlur;
`,
  uniformTypes: {gamma: 'f32', capped: 'f32'}
} as const;

/**
 * `LabelCharactersLayer` (the characters of a `LabelTextLayer`) sets the alpha of a halo with this
 * statement, from the halo edge's own antialiasing, `labelHaloGamma`. It runs in the halo pass
 * only: the pass that draws the glyphs on top draws no outline. `haloGamma`, the width the halo
 * fades over, is also the width of the ring's inner edge, which the layer draws next.
 */
const OUTLINE_ALPHA_STATEMENT = 'alpha = inBorder;';

const injection = {
  [OUTLINE_ALPHA_STATEMENT]: /* glsl */ `
      if (textHaloBlur.gamma > 0.0) {
        // Fades the halo over the wider edge. The blur widens by 1 / cos(pitch) on a pitched map,
        // as the edge's own antialiasing does: MapLibre divides both by its u_gamma_scale. With
        // 'capped', capped so that the halo is transparent where the distance field ends, at the
        // edge of the glyph's quad: the font atlas stores a few 1/255 steps of distance there.
        // Uncapped, as MapLibre draws its glyphs, the faintest part of a wide fade is cut there.
        haloGamma = labelHaloGamma + textHaloBlur.gamma / labelEdge.foreshortening;
        if (textHaloBlur.capped > 0.5) {
          haloGamma = max(labelHaloGamma, min(haloGamma, sdf.outlineBuffer - 4.0 / 255.0));
        }
        alpha = smoothstep(sdf.outlineBuffer - haloGamma, sdf.outlineBuffer + haloGamma, distance);
      }
`
};

type TextHaloBlurExtensionProps = {
  /** Distance by which the halo edge fades on each side, see {@link getHaloBlurGamma}. */
  textHaloBlurGamma?: number;
  /**
   * Whether the fade ends where the distance field does (default), or reaches past it and is cut
   * at the glyph's quad, as MapLibre GL JS draws its glyphs.
   */
  textHaloBlurCapped?: boolean;
};

/**
 * Blurs the halo of a `LabelTextLayer`, as MapLibre GL JS draws `text-halo-blur`: the halo edge
 * fades over `textHaloBlurGamma` more distance on each side, beyond its own antialiasing of 0.84
 * device pixels (see `LabelCharactersLayer`), as MapLibre's. Labels that lie on a pitched map fade
 * over 1 / cos(pitch) times that distance, blur and antialiasing alike, as MapLibre's (see
 * `getLabelForeshortening`). The glyphs stay as sharp as without the extension. WebGL only; on
 * WebGPU the halo draws without blur.
 */
export class TextHaloBlurExtension extends LayerExtension {
  static extensionName = 'TextHaloBlurExtension';
  static defaultProps = {textHaloBlurGamma: 0, textHaloBlurCapped: true};

  getShaders(this: Layer<TextHaloBlurExtensionProps>) {
    if (this.context.device.type === 'webgpu') {
      return {};
    }
    // The statement is only in the characters' shader, so the text background is unchanged.
    return {modules: [textHaloBlurModule], inject: injection};
  }

  draw(this: Layer<TextHaloBlurExtensionProps>) {
    if (this.context.device.type === 'webgpu') {
      return;
    }
    this.setShaderModuleProps({
      textHaloBlur: {
        gamma: this.props.textHaloBlurGamma ?? 0,
        capped: this.props.textHaloBlurCapped === false ? 0 : 1
      }
    });
  }
}
