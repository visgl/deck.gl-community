// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Reduced cantilever motion: a clamped cubic bending shape plus a spatial crown
 * mode at twice the fundamental frequency. It is an animation approximation,
 * not a structural solver. The analytic Jacobian keeps meshes, splat covariance,
 * shading normals, picking and light-space coverage on the same deformation.
 */
export const SPLAT_DEFORMATION_GLSL = `
mat3 splatDeform(inout vec3 position, float height, float strength, vec2 wave) {
  float u = clamp(position.z / height, 0.0, 1.0);
  float f = 0.5 * u * u * (3.0 - u);
  float v = max((u - 0.3) / 0.7, 0.0);
  float g = v * v;
  vec2 bend = vec2(1.0, 0.45) * strength * wave.x;
  float branch = 0.35 * strength * wave.y;
  mat2 mode = mat2(0.65, -0.25, 0.3, 0.8);
  vec2 lateral = mode * position.xy;
  mat2 xy = mat2(1.0) + branch * g * mode;
  float df = position.z > 0.0 && position.z < height ? 3.0 * u - 1.5 * u * u : 0.0;
  float dg = position.z > height * 0.3 && position.z < height ? 2.0 * v / (0.7 * height) : 0.0;
  vec2 dz = bend * df + branch * dg * lateral;
  position.xy += bend * height * f + branch * g * lateral;
  return mat3(vec3(xy[0], 0.0), vec3(xy[1], 0.0), vec3(dz, 1.0));
}
vec3 splatDeformNormal(mat3 jacobian, vec3 normal) {
  float determinant = jacobian[0].x * jacobian[1].y - jacobian[1].x * jacobian[0].y;
  vec2 xy = vec2(jacobian[1].y * normal.x - jacobian[0].y * normal.y,
    jacobian[0].x * normal.y - jacobian[1].x * normal.x) / determinant;
  return vec3(xy, normal.z - dot(xy, jacobian[2].xy));
}`;

export const SPLAT_DEFORMATION_WGSL = `
struct SplatDeformation {position: vec3<f32>, jacobian: mat3x3<f32>};
fn splatDeform(position: vec3<f32>, height: f32, strength: f32, wave: vec2<f32>) -> SplatDeformation {
  let u = clamp(position.z / height, 0.0, 1.0);
  let f = 0.5 * u * u * (3.0 - u);
  let v = max((u - 0.3) / 0.7, 0.0);
  let g = v * v;
  let bend = vec2<f32>(1.0, 0.45) * strength * wave.x;
  let branch = 0.35 * strength * wave.y;
  let mode = mat2x2<f32>(vec2<f32>(0.65, -0.25), vec2<f32>(0.3, 0.8));
  let lateral = mode * position.xy;
  let xy = mat2x2<f32>(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0)) + branch * g * mode;
  let df = select(0.0, 3.0 * u - 1.5 * u * u, position.z > 0.0 && position.z < height);
  let dg = select(0.0, 2.0 * v / (0.7 * height), position.z > height * 0.3 && position.z < height);
  let dz = bend * df + branch * dg * lateral;
  return SplatDeformation(vec3<f32>(position.xy + bend * height * f + branch * g * lateral, position.z),
    mat3x3<f32>(vec3<f32>(xy[0], 0.0), vec3<f32>(xy[1], 0.0), vec3<f32>(dz, 1.0)));
}
fn splatDeformNormal(jacobian: mat3x3<f32>, normal: vec3<f32>) -> vec3<f32> {
  let determinant = jacobian[0].x * jacobian[1].y - jacobian[1].x * jacobian[0].y;
  let xy = vec2<f32>(jacobian[1].y * normal.x - jacobian[0].y * normal.y,
    jacobian[0].x * normal.y - jacobian[1].x * normal.x) / determinant;
  return vec3<f32>(xy, normal.z - dot(xy, jacobian[2].xy));
}`;
