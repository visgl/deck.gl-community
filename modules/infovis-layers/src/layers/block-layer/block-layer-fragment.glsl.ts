// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export default `\
#version 300 es
#define SHADER_NAME block-layer-fragment-shader

precision highp float;

in vec2 unitPosition;
flat in vec4 vFillColor;
flat in vec4 vLineColor;
flat in float lineWidth;
flat in vec2 size;

out vec4 fragColor;

void main(void) {
  if (lineWidth > 0.0) {
    vec2 relPosition = unitPosition * size;
    float distToBorder =
      min(
        min(
          min(relPosition.x, relPosition.y),
          size.x - relPosition.x
        ),
        size.y - relPosition.y
      );
    if (distToBorder <= lineWidth) {
      fragColor = vLineColor;
    } else {
      fragColor = vFillColor;
    }
  } else {
    fragColor = vFillColor;
  }

  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
