// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME flow-path-layer-fragment-shader

precision highp float;

in vec4 vColor;
in vec2 uv;
in float segmentIndex;
in float speed;
in float flowOffset;
in float pathLength;
in float tailLength;

out vec4 fragColor;

void main(void) {
  geometry.uv = uv;

  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);

  fragColor = picking_filterHighlightColor(fragColor);
  fragColor = picking_filterPickingColor(fragColor);

  if (speed == 0.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    float segFragment;
    if (tailLength <= 1.0) {
      segFragment = clamp(tailLength, 0.0, 1.0);
    } else if (pathLength > 0.0) {
      segFragment = clamp(tailLength / pathLength, 0.0, 1.0);
    } else {
      segFragment = 1.0;
    }

    if (segFragment <= 0.0) {
      fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
      float startSegmentIndex = mod(flowOffset, 60.0) / 60.0;
      float endSegmentIndex = min(startSegmentIndex + segFragment, 1.0);
      if (segmentIndex < startSegmentIndex || segmentIndex > endSegmentIndex) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
      } else {
        float portion = (segmentIndex - startSegmentIndex) / segFragment;
        fragColor[3] = clamp(portion, 0.0, 1.0);
      }
    }
  }
}
`;
