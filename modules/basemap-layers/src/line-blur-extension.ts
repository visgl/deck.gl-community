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
 * draws `line-blur`. MapLibre fades each edge linearly from the edge, which its antialiasing moves
 * out by half a device pixel, to `blur` plus one device pixel inside it. deck.gl's antialiasing
 * adds the same half pixel and ramps across one device pixel, so with a blur of 0 the line is
 * drawn as by deck.gl. The fade follows round caps and joins, as in MapLibre. Other sublayers, and
 * layers drawn without `antialiasing`, are left unchanged. WebGL only; on WebGPU lines draw
 * without blur.
 *
 * `blurGapSide` serves the two lines of a `line-gap-width`, drawn with `PathStyleExtension`'s
 * offsets: 1 or -1, the side of the gap's center that this line is on (as `getLineOffset`'s
 * `side`), with `blurGapOffset` the CSS pixels of the gap's center from the path (`line-offset`).
 * The line draws nothing past the gap's center, so that where a blur wider than half the gap makes
 * the two lines overlap, their fades do not draw over each other. MapLibre draws the gap as one
 * stroke whose fade is symmetric about its center, so each line draws its half. The default 0
 * clips nothing.
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
    // A blur wider than the line keeps its middle from becoming opaque, as in MapLibre, which
    // `edgePixels` does not show: there `fwidth(abs(vPathPosition.x))` falls to 0 across the
    // middle of the stroke. The fade measures the stroke's body from `fwidth(vPathPosition.x)`,
    // taken before any fragment of the quad is discarded.
    const lineBlur: ShaderModule<LineBlurProps> = {
      name: 'lineBlur',
      inject: {
        'vs:#decl': `${UNIFORMS}
#ifdef LINE_BLUR_PER_FEATURE
in float instanceLineBlur;
#endif
out float lineBlur_blur;
out float lineBlur_gapCenter;
`,
        'vs:#main-end': `
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
#ifdef PATH_STYLE_OFFSET
  if (widthPixels.x > 0.0) {
    lineBlur_gapCenter = 2.0 * instanceOffsets - lineBlur.gapOffset / widthPixels.x;
  }
#endif
`,
        'fs:#decl': `${UNIFORMS}
in float lineBlur_blur;
in float lineBlur_gapCenter;
`,
        'fs:#main-start': `
  float lineBlur_pixelWidth = max(fwidth(vPathPosition.x), 1e-6);
`,
        'fs:#main-end': `
#ifdef ANTIALIASING
  // The gap's other line draws past its center.
  if (lineBlur.gapSide * (vPathPosition.x - lineBlur_gapCenter) > 0.0) {
    discard;
  }
  float lineBlur_coverage = smoothedge(0.0, edgePixels);
  // Round caps and joins keep their distance, which is never more than the body's.
  float lineBlur_edgePixels = min(
    edgePixels, (1.0 - abs(vPathPosition.x)) / lineBlur_pixelWidth
  );
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
