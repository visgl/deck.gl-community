// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const fs = /* glsl */ `\
#define SHADER_NAME flow-path-layer-fragment-shader

precision highp float;

varying vec4 vColor;
varying float segmentIndex;
varying float speed;
varying float offset;
varying float pathLength;
varying float tailLength;

void main(void) {
  gl_FragColor = vColor;

  // use highlight color if this fragment belongs to the selected object.
  gl_FragColor = picking_filterHighlightColor(gl_FragColor);

  // use picking color if rendering to picking FBO.
  gl_FragColor = picking_filterPickingColor(gl_FragColor);

  if (speed == 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    // the portion of the visible segment (0 to 1) , ex: 0.3
    // edge cases: pathLength = 0 or tailLength > pathLength
    float segFragment = 0.0;
    if (pathLength != 0.0) {
      segFragment = tailLength / pathLength;
    }
    if (tailLength > pathLength) {
      segFragment = 1.0;
    }
    float startSegmentIndex = mod(offset, 60.0) / 60.0;
    // the end offset, cap to 1.0 (end of the line)
    float endSegmentIndex = min(startSegmentIndex + segFragment, 1.0);
    if (segmentIndex < startSegmentIndex || segmentIndex > endSegmentIndex) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
      // fading tail
      float portion = (segmentIndex - startSegmentIndex) / segFragment;
      gl_FragColor[3] = portion;
    }
  }
}
`;
