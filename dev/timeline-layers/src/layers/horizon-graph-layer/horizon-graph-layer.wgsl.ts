// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** WebGPU shaders for floating-point horizon graphs. */
export default /* wgsl */ `
struct HorizonLayerUniforms {
  dataTextureSize: f32,
  dataTextureSizeInv: f32,
  dataTextureCount: f32,
  bands: f32,
  bandsInv: f32,
  yAxisScaleInv: f32,
  positiveColor: vec3<f32>,
  negativeColor: vec3<f32>,
};

@group(0) @binding(auto) var<uniform> horizonLayer: HorizonLayerUniforms;
@group(0) @binding(auto) var dataTexture: texture_2d<f32>;

struct HorizonAttributes {
  @location(0) positions: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct HorizonVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vertexMain(attributes: HorizonAttributes) -> HorizonVaryings {
  geometry.worldPosition = attributes.positions;
  let commonPosition = project_position_vec4_f32(vec4<f32>(attributes.positions.xy, 0.0, 1.0));
  geometry.position = commonPosition;

  var varyings: HorizonVaryings;
  varyings.position = project_common_position_to_clipspace(commonPosition);
  varyings.uv = attributes.uv;
  return varyings;
}

@fragment
fn fragmentMain(varyings: HorizonVaryings) -> @location(0) vec4<f32> {
  let index = clamp(
    floor(varyings.uv.x * horizonLayer.dataTextureCount),
    0.0,
    max(horizonLayer.dataTextureCount - 1.0, 0.0)
  );
  let row = floor(index * horizonLayer.dataTextureSizeInv);
  let column = index - row * horizonLayer.dataTextureSize;
  let value = textureLoad(dataTexture, vec2<i32>(i32(column), i32(row)), 0).r *
    horizonLayer.yAxisScaleInv;
  let scaledBand = abs(value) * horizonLayer.bands;
  let bandIndex = clamp(floor(scaledBand), 0.0, horizonLayer.bands - 1.0);
  let bandFraction = fract(scaledBand);
  let positive = value >= 0.0;
  let baseColor = select(horizonLayer.negativeColor, horizonLayer.positiveColor, positive);
  let currentPosition = select(varyings.uv.y, 1.0 - varyings.uv.y, positive);
  let band = bandIndex + select(0.0, 1.0, currentPosition <= bandFraction);
  let whiten = 1.0 - band * horizonLayer.bandsInv;
  return vec4<f32>(mix(baseColor, vec3<f32>(1.0), whiten), 1.0);
}
`;
