// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension} from '@deck.gl/core';
import type {Layer, UpdateParameters} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';

export type LineBlurExtensionOptions = {
  /**
   * Reads `getBlur` per path, from an attribute. Otherwise `getBlur` must be a constant, which a
   * uniform carries: a `PathLayer` with `PathStyleExtension`'s path dashes and offsets already
   * uses all 16 vertex attributes that WebGL2 guarantees, and does not link with one more.
   */
  perFeature: boolean;
};

type LineBlurProps = {
  blur: number;
  gapOffset: number;
  gapSide: number;
};

const UNIFORMS = `\
layout(std140) uniform lineBlurUniforms {
  float blur;
  float gapOffset;
  float gapSide;
} lineBlur;
`;

/**
 * Adds `getBlur` to the `PathLayer`s of a layer drawn with `antialiasing` (for a `GeoJsonLayer`,
 * `lineAntialiasing`): per path, the CSS pixels over which the edges fade out, as MapLibre GL JS
 * draws `line-blur`, and, with a blur of 0, every line's antialiasing. MapLibre fades each edge
 * linearly from the edge, which its antialiasing moves out by half a device pixel, to `blur` plus
 * one device pixel inside it. On deck.gl's antialiased stroke alone, that fade leaves a line
 * narrower than a pixel too faint, so lines without an offset (which is measured in widths) are
 * drawn half a device pixel wider on each side, with their dashes scaled back to the line's width,
 * and faded from their own edge. The fade follows round caps and joins, as in MapLibre. Other
 * sublayers, and
 * layers drawn without `antialiasing`, are left unchanged. WebGL only; on WebGPU lines draw
 * without blur.
 *
 * `blurGapSide` serves the two lines of a `line-gap-width`, drawn with `PathStyleExtension`'s
 * offsets: 1 or -1, the side of the gap's center that this line is on (as `getLineOffset`'s
 * `side`), with `blurGapOffset` the CSS pixels of the gap's center from the path (`line-offset`).
 * The line draws nothing past the gap's center, so that where a blur wider than half the gap makes
 * the two lines overlap, their fades do not draw over each other. MapLibre draws the gap as one
 * stroke whose fade is symmetric about its center, so each line draws its half. The default 0
 * clips nothing, and neither does a path whose gap is 0: its one line is centered on the gap's
 * center (`getLineOffset`), which the shader tells per path from the offset and width it already
 * has, so a gap that is 0 at a zoom or for a feature needs no attribute of its own.
 */
export class LineBlurExtension extends LayerExtension<LineBlurExtensionOptions> {
  static extensionName = 'LineBlurExtension';
  static defaultProps = {
    getBlur: {type: 'accessor', value: 0},
    blurGapSide: 0,
    blurGapOffset: 0
  };

  constructor({perFeature = false}: Partial<LineBlurExtensionOptions> = {}) {
    super({perFeature});
  }

  initializeState(this: Layer, context: unknown, extension: this) {
    if (!isBlurredPathLayer(this) || !extension.opts.perFeature) {
      return;
    }
    this.getAttributeManager()?.addInstanced({
      instanceLineBlur: {size: 1, accessor: 'getBlur', defaultValue: 0}
    });
  }

  updateState(this: Layer<any>, params: UpdateParameters<Layer<any>>, extension: this) {
    if (!isBlurredPathLayer(this)) {
      return;
    }
    const {getBlur, blurGapSide, blurGapOffset} = this.props;
    const lineBlur: LineBlurProps = {
      blur: extension.opts.perFeature ? 0 : Math.max(0, Number(getBlur) || 0),
      gapOffset: Number(blurGapOffset) || 0,
      gapSide: Math.sign(Number(blurGapSide) || 0)
    };
    this.setShaderModuleProps({lineBlur});
  }

  getShaders(this: Layer, extension: this) {
    if (!isBlurredPathLayer(this)) {
      return {};
    }
    // deck.gl appends these to the layer's and other extensions' code for the same hooks.
    // `edgePixels` is PathLayer's signed distance to the stroke's edge in device pixels, and
    // `fragColor.a` already carries its `smoothedge(0.0, edgePixels)` coverage, which this
    // replaces with MapLibre's linear fade. `smoothedge` is 0 only where MapLibre's fade is 0.
    // The fade measures its own distances, as `edgePixels` does but in Euclidean pixels: the
    // length of the coordinate's screen gradient rather than `fwidth`, which is up to 1.41 times
    // longer on diagonal lines and round caps, where it would shorten the fade. The body uses
    // `vPathPosition.x` rather than its absolute value, whose gradient falls to 0 across the
    // middle of the stroke, where a blur wider than the line keeps it translucent in MapLibre.
    // Gradients are taken before any fragment of the quad is discarded.
    const lineBlur: ShaderModule<LineBlurProps> = {
      name: 'lineBlur',
      inject: {
        'vs:#decl': `${UNIFORMS}
#ifdef LINE_BLUR_PER_FEATURE
in float instanceLineBlur;
#endif
out float lineBlur_blur;
out float lineBlur_gapCenter;
out float lineBlur_gapSide;
out float lineBlur_padPixels;
// The line's width over the drawn stroke's (see DECKGL_FILTER_SIZE).
float lineBlur_widthRatio = 1.0;
`,
        // MapLibre's fade reaches half a device pixel past the line. The stroke is drawn that much
        // wider on each side, and the fade measured from the line's own edge, so that a line
        // narrower than a pixel draws as in MapLibre: with multisampling, the fade would otherwise
        // be cut at the stroke's edge. Dashes, measured in the drawn width, are scaled back in
        // #main-end. Offsets are measured in it too, so offset lines keep their width.
        'vs:DECKGL_FILTER_SIZE': `
  lineBlur_padPixels = 0.0;
#ifndef PATH_STYLE_OFFSET
  if (size.x > 0.0) {
    // \`size\` is half the stroke's width.
    vec2 lineBlur_pad = vec2(0.5 / project.devicePixelRatio);
    lineBlur_pad = path.billboard ? lineBlur_pad : project_pixel_size(lineBlur_pad);
    lineBlur_widthRatio = size.x / (size.x + lineBlur_pad.x);
    size.xy += lineBlur_pad;
    lineBlur_padPixels = 0.5;
  }
#endif
`,
        'vs:#main-end': `
#if defined(DASH_ENABLED) && !defined(PATH_STYLE_OFFSET)
  // PathStyleExtension measured the dashes in the drawn stroke's widths, MapLibre in the line's.
  // Offset lines are not widened, and keep the dash phase that the offset shader corrects.
  vDashArray *= lineBlur_widthRatio;
#ifdef HIGH_PRECISION_DASH
  float lineBlur_dashUnit = vDashArray.x + vDashArray.y;
  float lineBlur_dashPeriod = pathStyle.dashAlignMode == 0.0
    ? lineBlur_dashUnit
    : vDashPathLength / max(round(vDashPathLength / max(lineBlur_dashUnit, 0.0001)), 1.0);
  vDashOffset = lineBlur_dashPeriod > 0.0 ? mod(dashOffsetAndLength.x, lineBlur_dashPeriod) : 0.0;
#endif
#endif
#ifdef LINE_BLUR_PER_FEATURE
  lineBlur_blur = instanceLineBlur;
#else
  lineBlur_blur = lineBlur.blur;
#endif
  // In device pixels.
  lineBlur_blur *= project.devicePixelRatio;
  // The gap's center across the stroke, in the units of vPathPosition.x: half the drawn width
  // from the stroke's center. PathStyleExtension puts the path at 2 * instanceOffsets, and
  // vPathPosition.x runs the other way to the offset.
  lineBlur_gapCenter = 0.0;
  lineBlur_gapSide = 0.0;
#ifdef PATH_STYLE_OFFSET
  if (widthPixels.x > 0.0) {
    lineBlur_gapCenter = 2.0 * instanceOffsets - lineBlur.gapOffset / widthPixels.x;
    // A path without a gap draws one line, centered on the gap's center: it is not clipped. A
    // line of a gap is always off the center, by at least 0.01 pixels (MIN_GAP_LINE_CENTER).
    if (abs(lineBlur_gapCenter) * widthPixels.x > 0.001) {
      lineBlur_gapSide = lineBlur.gapSide;
    }
  }
#endif
`,
        'fs:#decl': `${UNIFORMS}
in float lineBlur_blur;
in float lineBlur_gapCenter;
in float lineBlur_gapSide;
in float lineBlur_padPixels;
`,
        'fs:#main-start': `
  float lineBlur_bodyGradient = max(
    length(vec2(dFdx(vPathPosition.x), dFdy(vPathPosition.x))), 1e-6
  );
  float lineBlur_cornerCoord = length(vCornerOffset);
  float lineBlur_cornerGradient = max(
    length(vec2(dFdx(lineBlur_cornerCoord), dFdy(lineBlur_cornerCoord))), 1e-6
  );
`,
        'fs:#main-end': `
#ifdef ANTIALIASING
  // The gap's other line draws past its center.
  if (lineBlur_gapSide * (vPathPosition.x - lineBlur_gapCenter) > 0.0) {
    discard;
  }
  float lineBlur_coverage = smoothedge(0.0, edgePixels);
  // In device pixels, as edgePixels. A round cap or join is bounded by both its circle and the
  // stroke's width, as PathLayer bounds it.
  float lineBlur_edgePixels = (1.0 - abs(vPathPosition.x)) / lineBlur_bodyGradient;
  if (isRound && isCorner) {
    lineBlur_edgePixels = min(
      lineBlur_edgePixels, (1.0 - lineBlur_cornerCoord) / lineBlur_cornerGradient
    );
  }
  lineBlur_edgePixels -= lineBlur_padPixels;
  // Picking colors keep the coverage PathLayer gave them.
  if (lineBlur_coverage > 0.0 && !bool(picking.isActive)) {
    fragColor.a *= clamp(
      (lineBlur_edgePixels + 0.5) / (lineBlur_blur + 1.0), 0.0, 1.0
    ) / lineBlur_coverage;
  }
#endif
`
      },
      uniformTypes: {blur: 'f32', gapOffset: 'f32', gapSide: 'f32'}
    };
    return {
      modules: [lineBlur],
      defines: extension.opts.perFeature ? {LINE_BLUR_PER_FEATURE: true} : {}
    };
  }
}

function isBlurredPathLayer(layer: Layer): boolean {
  return layer.context.device.type !== 'webgpu' && 'pathTesselator' in (layer.state || {});
}

/**
 * The width to draw each of a gap's two lines with, so that their fades fall where MapLibre's do:
 * MapLibre draws the two lines as one stroke whose inner edges fade into the gap and whose outer
 * edges fade inward, each over the same `blur`. Drawing each line `blur` wider, and `blur / 2`
 * closer to the gap (see `getLineOffset`), turns that into a fade inward from both of the line's
 * edges. Lines without a gap, or without width, keep their width.
 */
export function getBlurredLineWidth(width: number, gapWidth: number, blur: number): number {
  return width > 0 && gapWidth > 0 ? width + Math.max(0, blur) : width;
}
