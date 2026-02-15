// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Ported from https://github.com/ubilabs/outlined-path-layer (MIT license)

export const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME outlined-path-layer-fragment-shader

precision highp float;

in vec4 vColorInner;
in vec4 vColorOutline;
in float vWidthRatio;
in vec2 vCornerOffset;
in float vMiterLength;
in vec2 vPathPosition;
in float vPathLength;
in float vJointType;
in float vIsCap;

out vec4 fragColor;

void main(void) {
  geometry.uv = vPathPosition;

  bool isCapOrJoint = vPathPosition.y < 0.0 || vPathPosition.y > vPathLength;
  bool isRound = vJointType > 0.5;

  if (isCapOrJoint) {
    if (isRound) {
        if (length(vCornerOffset) > 1.0) discard;
    } else {
        if (vMiterLength > path.miterLimit + 1.0) discard;
    }
  }

  float dist = mix(abs(vPathPosition.x), length(vCornerOffset), float(isRound && isCapOrJoint));

  vec4 baseColor = mix(vColorInner, vColorOutline, step(vWidthRatio, dist));

  float isSquareCap = float(vIsCap > 0.5 && isCapOrJoint && !isRound);

  fragColor = mix(baseColor, vColorOutline, isSquareCap);

  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
