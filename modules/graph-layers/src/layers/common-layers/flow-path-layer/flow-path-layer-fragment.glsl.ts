// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME flow-path-layer-fragment-shader

precision highp float;

in vec4 vColor;
in float segmentIndex;
in float speed;
in float flowOffset;
in float pathLength;
in float tailLength;

out vec4 fragColor;

void main(void) {
  fragColor = vColor;

  // use highlight color if this fragment belongs to the selected object.
  fragColor = picking_filterHighlightColor(fragColor);

  // use picking color if rendering to picking FBO.
  fragColor = picking_filterPickingColor(fragColor);

  if (speed == 0.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 0.0);
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
    float startSegmentIndex = mod(flowOffset, 60.0) / 60.0;
    // the end offset, cap to 1.0 (end of the line)
    float endSegmentIndex = min(startSegmentIndex + segFragment, 1.0);
    if (segmentIndex < startSegmentIndex || segmentIndex > endSegmentIndex) {
      fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
      // fading tail
      float portion = (segmentIndex - startSegmentIndex) / segFragment;
      fragColor[3] = portion;
    }
  }
}
`;
