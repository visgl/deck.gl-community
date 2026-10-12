// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';

/**
 * Adds `getBlur` to the `PathLayer`s of a layer drawn with `antialiasing` (for a `GeoJsonLayer`,
 * `lineAntialiasing`): per path, the CSS pixels over which the edges fade out, as MapLibre GL JS
 * draws `line-blur`. MapLibre fades each edge linearly from the edge, which its antialiasing moves
 * out by half a device pixel, to `blur` plus one device pixel inside it. deck.gl's antialiasing
 * adds the same half pixel and ramps across one device pixel, so with a blur of 0 the line is
 * drawn as by deck.gl. The fade follows round caps and joins, as in MapLibre. Other sublayers, and
 * layers drawn without `antialiasing`, are left unchanged. WebGL only; on WebGPU lines draw
 * without blur.
 */
export class LineBlurExtension extends LayerExtension {
  static extensionName = 'LineBlurExtension';
  static defaultProps = {getBlur: {type: 'accessor', value: 0}};

  initializeState(this: Layer) {
    if (!isBlurredPathLayer(this)) {
      return;
    }
    this.getAttributeManager()?.addInstanced({
      instanceLineBlur: {size: 1, accessor: 'getBlur', defaultValue: 0}
    });
  }

  getShaders(this: Layer) {
    if (!isBlurredPathLayer(this)) {
      return {};
    }
    // deck.gl appends these to the layer's and other extensions' code for the same hooks.
    // `edgePixels` is PathLayer's signed distance to the stroke's edge in device pixels, and
    // `fragColor.a` already carries its `smoothedge(0.0, edgePixels)` coverage, which this
    // replaces with MapLibre's linear fade. `smoothedge` is 0 only where MapLibre's fade is 0.
    return {
      inject: {
        'vs:#decl': 'in float instanceLineBlur;\nout float lineBlur_blur;',
        // In device pixels.
        'vs:#main-end': 'lineBlur_blur = instanceLineBlur * project.devicePixelRatio;',
        'fs:#decl': 'in float lineBlur_blur;',
        'fs:#main-end': `
#ifdef ANTIALIASING
  float lineBlur_coverage = smoothedge(0.0, edgePixels);
  // Picking colors keep the coverage PathLayer gave them.
  if (lineBlur_coverage > 0.0 && !bool(picking.isActive)) {
    fragColor.a *= clamp(
      (edgePixels + 0.5) / (lineBlur_blur + 1.0), 0.0, 1.0
    ) / lineBlur_coverage;
  }
#endif
`
      }
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
