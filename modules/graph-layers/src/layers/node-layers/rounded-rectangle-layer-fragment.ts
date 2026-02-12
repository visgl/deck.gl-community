// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const fs = /* glsl */ `\
#define SHADER_NAME rounded-rectangle-layer-fragment-shader

precision highp float;

varying vec4 vFillColor;
varying vec2 unitPosition;

void main(void) {

  float distToCenter = length(unitPosition);

  /* Calculate the cutoff radius for the rounded corners */
  float threshold = sqrt(2.0) * (1.0 - roundedRectangle.cornerRadius) + 1.0 * roundedRectangle.cornerRadius;
  if (distToCenter <= threshold) {
    gl_FragColor = vFillColor;
  } else {
    discard;
  }

  gl_FragColor = picking_filterHighlightColor(gl_FragColor);

  gl_FragColor = picking_filterPickingColor(gl_FragColor);
}
`;
