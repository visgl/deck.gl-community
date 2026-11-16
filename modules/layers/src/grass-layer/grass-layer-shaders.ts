// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

type GrassUniforms = {bladeCount: number; wind: [number, number, number, number]};

const glslUniforms = /* glsl */ `
layout(std140) uniform grassUniforms {
  float bladeCount;
  vec4 wind;
} grass;
`;

export const grassUniforms = {
  name: 'grass',
  vs: glslUniforms,
  source: /* wgsl */ `
struct GrassUniforms {
  bladeCount: f32,
  wind: vec4<f32>,
};
@group(0) @binding(auto) var<uniform> grass: GrassUniforms;
`,
  uniformTypes: {bladeCount: 'f32', wind: 'vec4<f32>'}
} satisfies ShaderModule<GrassUniforms>;

// The camera-independent blade curve and taper come from the original field grass renderer.
export const grassVertex = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec3 instancePositions;
in vec3 instancePositions64Low;
in vec2 instanceSizes;
in float instanceHeights;
in float instanceBladeWidths;
in vec4 instanceColors;
in float instanceDensities;
in float instanceSeeds;

out vec4 bladeColor;

float grassHash(uint value) {
  value = (value ^ (value >> 16u)) * 0x7feb352du;
  value = (value ^ (value >> 15u)) * 0x846ca68bu;
  return float((value ^ (value >> 16u)) >> 8u) / 16777216.0;
}

void main() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  bladeColor = vec4(0.0);
  int blade = gl_VertexID / 15;
  if (!(instanceSizes.x > 0.0 && instanceSizes.y > 0.0 && instanceHeights > 0.0 &&
        instanceBladeWidths > 0.0 && float(blade) < floor(grass.bladeCount * clamp(instanceDensities, 0.0, 1.0)))) return;

  int corner = gl_VertexID % 15;
  int quadCorner = corner % 6;
  bool tip = corner >= 12;
  int row = tip ? (quadCorner == 2 ? 3 : 2) :
    corner / 6 + ((quadCorner == 2 || quadCorner == 3 || quadCorner == 5) ? 1 : 0);
  float side = (quadCorner == 1 || (!tip && (quadCorner == 4 || quadCorner == 5))) ? 1.0 : -1.0;
  float t = float(row) / 3.0;

  uint seed = instanceSeeds >= 0.0 && instanceSeeds <= 16777215.0 ? uint(instanceSeeds) : 0u;
  uint bladeSeed = uint(blade) + seed * 4099u;
  vec2 shift = vec2(grassHash(seed + 31u), grassHash(seed + 79u));
  // A low-discrepancy sequence keeps every density prefix spread through the patch.
  vec2 base = (fract(vec2(0.754877666, 0.569840296) * (float(blade) + 0.5) + shift) - 0.5) * instanceSizes;
  float angle = grassHash(bladeSeed + 5u) * 6.283185307;
  vec2 toward = vec2(cos(angle), sin(angle));
  vec2 across = vec2(-toward.y, toward.x);
  float variation = grassHash(bladeSeed + 9u);
  float height = instanceHeights * mix(0.65, 1.35, variation);
  float gust = 0.72 + 0.28 * sin(dot(base, grass.wind.xy) * 0.9 - grass.wind.w * 2.6 + float(seed % 251u));
  vec2 bend = toward * mix(0.15, 0.43, variation) + grass.wind.xy * grass.wind.z * gust * 1.25;
  float taper = pow(1.0 - t, 0.6) * (0.65 + 0.35 * min(t * 6.0, 1.0));
  vec2 xy = base + bend * height * t * t + across * side * instanceBladeWidths * taper * 0.5;
  float z = height * t * (1.0 - 0.12 * t) / sqrt(1.0 + dot(bend, bend));

  geometry.worldPosition = instancePositions;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec3 offset = project_size(vec3(xy, z));
  DECKGL_FILTER_SIZE(offset, geometry);
  gl_Position = project_position_to_clipspace(instancePositions, instancePositions64Low, offset, geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  float shade = mix(0.57, 1.1, t) * mix(0.84, 1.16, variation);
  bladeColor = vec4(instanceColors.rgb * shade, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(bladeColor, geometry);
}
`;

export const grassFragment = /* glsl */ `#version 300 es
precision highp float;
in vec4 bladeColor;
out vec4 fragColor;
void main() {
  if (bladeColor.a <= 0.0) discard;
  fragColor = bladeColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

export const grassWgsl = /* wgsl */ `
struct Inputs {
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
  @location(0) instancePositions: vec3<f32>,
  @location(1) instancePositions64Low: vec3<f32>,
  @location(2) instanceSizes: vec2<f32>,
  @location(3) instanceHeights: f32,
  @location(4) instanceBladeWidths: f32,
  @location(5) instanceColors: vec4<f32>,
  @location(6) instanceDensities: f32,
  @location(7) instanceSeeds: f32,
};

struct Varyings {
  @builtin(position) position: vec4<f32>,
  @location(0) bladeColor: vec4<f32>,
  @location(1) @interpolate(flat) pickingColor: vec3<f32>,
};

fn grassHash(input: u32) -> f32 {
  var value = (input ^ (input >> 16u)) * 0x7feb352du;
  value = (value ^ (value >> 15u)) * 0x846ca68bu;
  return f32((value ^ (value >> 16u)) >> 8u) / 16777216.0;
}

@vertex
fn vertexMain(input: Inputs) -> Varyings {
  var output: Varyings;
  output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  let blade = input.vertexIndex / 15u;
  if (!(input.instanceSizes.x > 0.0 && input.instanceSizes.y > 0.0 && input.instanceHeights > 0.0 &&
        input.instanceBladeWidths > 0.0 && f32(blade) < floor(grass.bladeCount * clamp(input.instanceDensities, 0.0, 1.0)))) {
    return output;
  }

  let corner = input.vertexIndex % 15u;
  let quadCorner = corner % 6u;
  let tip = corner >= 12u;
  let quadRow = corner / 6u + select(0u, 1u, quadCorner == 2u || quadCorner == 3u || quadCorner == 5u);
  let row = select(quadRow, select(2u, 3u, quadCorner == 2u), tip);
  let side = select(-1.0, 1.0, quadCorner == 1u || (!tip && (quadCorner == 4u || quadCorner == 5u)));
  let t = f32(row) / 3.0;

  let seed = select(0u, u32(input.instanceSeeds), input.instanceSeeds >= 0.0 && input.instanceSeeds <= 16777215.0);
  let bladeSeed = blade + seed * 4099u;
  let shift = vec2<f32>(grassHash(seed + 31u), grassHash(seed + 79u));
  let base = (fract(vec2<f32>(0.754877666, 0.569840296) * (f32(blade) + 0.5) + shift) - 0.5) * input.instanceSizes;
  let angle = grassHash(bladeSeed + 5u) * 6.283185307;
  let toward = vec2<f32>(cos(angle), sin(angle));
  let across = vec2<f32>(-toward.y, toward.x);
  let variation = grassHash(bladeSeed + 9u);
  let height = input.instanceHeights * mix(0.65, 1.35, variation);
  let gust = 0.72 + 0.28 * sin(dot(base, grass.wind.xy) * 0.9 - grass.wind.w * 2.6 + f32(seed % 251u));
  let bend = toward * mix(0.15, 0.43, variation) + grass.wind.xy * grass.wind.z * gust * 1.25;
  let taper = pow(1.0 - t, 0.6) * (0.65 + 0.35 * min(t * 6.0, 1.0));
  let xy = base + bend * height * t * t + across * side * input.instanceBladeWidths * taper * 0.5;
  let z = height * t * (1.0 - 0.12 * t) / sqrt(1.0 + dot(bend, bend));

  geometry.worldPosition = input.instancePositions;
  let offset = project_size_vec3(vec3<f32>(xy, z));
  output.position = project_position_to_clipspace(input.instancePositions, input.instancePositions64Low, offset);
  output.pickingColor = picking_getPickingColorFromIndex(input.instanceIndex);
  let shade = mix(0.57, 1.1, t) * mix(0.84, 1.16, variation);
  output.bladeColor = vec4<f32>(input.instanceColors.rgb * shade, input.instanceColors.a * layer.opacity);
  return output;
}

@fragment
fn fragmentMain(input: Varyings) -> @location(0) vec4<f32> {
  var result = input.bladeColor;
  if (result.a <= 0.0) { discard; }
  if (picking.isActive > 0.5) {
    if (!picking_isColorValid(input.pickingColor)) { discard; }
    return vec4<f32>(input.pickingColor, 1.0);
  }
  if (picking.isHighlightActive > 0.5 &&
      picking_isColorZero(abs(input.pickingColor - picking_normalizeColor(picking.highlightedObjectColor)))) {
    let alpha = picking.highlightColor.a + result.a * (1.0 - picking.highlightColor.a);
    result = vec4<f32>(mix(result.rgb, picking.highlightColor.rgb, picking.highlightColor.a / alpha), alpha);
  }
  return deckgl_premultiplied_alpha(result);
}
`;
