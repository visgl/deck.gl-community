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
} textHaloBlur;
`,
  uniformTypes: {gamma: 'f32'}
} as const;

/**
 * deck.gl's `MultiIconLayer` (the characters of a `TextLayer`) sets the alpha of an SDF outline
 * with this statement. The halo pass outlines inside the glyph's buffer distance; the pass that
 * draws the glyphs on top sets the outline at the glyph edge, and stays as it is.
 */
const OUTLINE_ALPHA_STATEMENT = 'alpha = inBorder;';

const injection = {
  [OUTLINE_ALPHA_STATEMENT]: /* glsl */ `
      if (textHaloBlur.gamma > 0.0 && sdf.outlineBuffer < sdf.buffer) {
        // Fades the halo over the wider edge. Capped so that the halo is transparent where the
        // distance field ends, at the edge of the glyph's quad: the font atlas stores a few
        // 1/255 steps of distance there.
        float haloGamma = max(
          sdf.gamma,
          min(sdf.gamma + textHaloBlur.gamma, sdf.outlineBuffer - 4.0 / 255.0)
        );
        alpha = smoothstep(sdf.outlineBuffer - haloGamma, sdf.outlineBuffer + haloGamma, distance);
      }
`
};

type TextHaloBlurExtensionProps = {
  /** Distance by which the halo edge fades on each side, see {@link getHaloBlurGamma}. */
  textHaloBlurGamma?: number;
};

/**
 * Blurs the SDF outline of a `TextLayer`, as MapLibre GL JS draws `text-halo-blur`: the halo edge
 * fades over `textHaloBlurGamma` more distance on each side. The glyphs stay as sharp as without
 * the extension. The edge keeps `TextLayer`'s own antialiasing (`fontSettings.smoothing`, a share
 * of the text size), where MapLibre adds `0.84 / devicePixelRatio` pixels; the two are close for
 * 12 to 24 pixel text. WebGL only; on WebGPU the halo draws without blur.
 */
export class TextHaloBlurExtension extends LayerExtension {
  static extensionName = 'TextHaloBlurExtension';
  static defaultProps = {textHaloBlurGamma: 0};

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
    this.setShaderModuleProps({textHaloBlur: {gamma: this.props.textHaloBlurGamma ?? 0}});
  }
}
