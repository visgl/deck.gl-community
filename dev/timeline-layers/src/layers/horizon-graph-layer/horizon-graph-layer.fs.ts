// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export default `#version 300 es
#define SHADER_NAME horizon-graph-layer-fragment-shader

precision highp float;
precision highp int;

/******* UNIFORM *******/

uniform sampler2D dataTexture;

/******* IN *******/

in vec2 v_uv;

/******* OUT *******/

out vec4 fragColor;


/******* MAIN *******/

void main(void) {
  // horizontal position to sample index
  float idx = v_uv.x * horizonLayer.dataTextureCount;
  // idx = clamp(idx, 0.0, horizonLayer.dataTextureCount - 1.0); // NEEDED???

  // fetch single data point & normalize (-1,+1)
  float fy = floor(idx * horizonLayer.dataTextureSizeInv);
  float fx = idx - fy * horizonLayer.dataTextureSize;
  float val = texelFetch(dataTexture, ivec2(int(fx), int(fy)), 0).r;
  val *= horizonLayer.yAxisScaleInv;

  // band layering
  float fband    = abs(val) * horizonLayer.bands;
  float bandIdx  = clamp(floor(fband), 0.0, horizonLayer.bands - 1.0);
  float bandFrac = fract(fband);

  // calc our position value and find out color (using mix+step instead of if...else)
  float positive = step(0.0, val);  // 1 if pos, else 0
  vec3  baseCol  = mix(horizonLayer.negativeColor, horizonLayer.positiveColor, positive);
  float curPos   = mix(v_uv.y, 1.0 - v_uv.y, positive);
  float addOne   = step(curPos, bandFrac);

  float band = bandIdx + addOne;
  float whiten = 1.0 - band * horizonLayer.bandsInv;

  fragColor = vec4(mix(baseCol, vec3(1.0), whiten), 1.0);
}
`;
