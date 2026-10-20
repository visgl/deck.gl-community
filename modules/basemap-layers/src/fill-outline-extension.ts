// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';

/**
 * Draws the `PathLayer`s of a fill's outline (`fill-outline-color`) as MapLibre GL JS draws it: as
 * `gl.LINES`, which draw each segment on its own, one pixel across the axis it crosses most
 * steeply. deck.gl's 1 pixel stroke covers more pixels than that on diagonals, and its joins draw
 * past the corners of short segments, so outlines came out darker and wider than MapLibre's. The
 * stroke, drawn without antialiasing, is cut to the pixels a line draws: those within half a pixel
 * of the segment along that axis, and not in the joins. MapLibre's shader also fades each pixel
 * with its distance from the line (`fill_outline.fragment.glsl`); its outlines in Chrome have the
 * colors of unfaded pixels, and so do these. Other sublayers are left unchanged. WebGL only; on
 * WebGPU the outline draws as a stroke.
 */
export class FillOutlineExtension extends LayerExtension {
  static extensionName = 'FillOutlineExtension';

  getShaders(this: Layer) {
    if (!isOutlinePathLayer(this)) {
      return {};
    }
    // `vPathPosition.x` runs from -1 to 1 across the stroke. Its screen gradient gives the
    // distance to the path in device pixels, and the direction across the line; the gradient is
    // taken before any fragment of the quad is discarded. Picking draws the same pixels.
    const fillOutline: ShaderModule = {
      name: 'fillOutline',
      inject: {
        // Drawn 1.5 device pixels to each side of the path, so that with multisampling every pixel
        // the line keeps, whose center is within half a pixel of the path, is covered whole.
        'vs:DECKGL_FILTER_SIZE': `
  if (size.x > 0.0) {
    vec2 fillOutline_size = vec2(1.5 / project.devicePixelRatio);
    size.xy = path.billboard ? fillOutline_size : project_pixel_size(fillOutline_size);
  }
`,
        'fs:#main-start': `
  vec2 fillOutline_gradient = vec2(dFdx(vPathPosition.x), dFdy(vPathPosition.x));
`,
        'fs:#main-end': `
  // Each segment draws on its own, as a line does: not in the joins between segments, and not at
  // its end, where the next segment starts.
  if (vPathPosition.y < 0.0 || vPathPosition.y >= vPathLength) {
    discard;
  }
  float fillOutline_gradientLength = max(length(fillOutline_gradient), 1e-6);
  float fillOutline_distance = abs(vPathPosition.x) / fillOutline_gradientLength;
  vec2 fillOutline_normal = abs(fillOutline_gradient) / fillOutline_gradientLength;
  // The distance along the axis the line crosses most steeply: a line draws one pixel there.
  if (fillOutline_distance / max(fillOutline_normal.x, fillOutline_normal.y) > 0.5) {
    discard;
  }
`
      }
    };
    return {modules: [fillOutline]};
  }
}

function isOutlinePathLayer(layer: Layer): boolean {
  return layer.context.device.type !== 'webgpu' && 'pathTesselator' in (layer.state || {});
}
