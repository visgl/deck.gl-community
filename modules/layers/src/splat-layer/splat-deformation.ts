// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * What a bend does, for `splatDeform`: the axis it follows, and how much of it is steady and how much
 * moves with the wave, as fractions of the strength.
 */
export type SplatDeformationWind = readonly [
  axisX: number,
  axisY: number,
  steady: number,
  wave: number
];

/** With no wind direction, a source sways to and fro along one fixed axis. */
const SPLAT_SWAY: SplatDeformationWind = [1, 0.45, 0, 1];

/**
 * A bend's square, as a fraction of height, below which a sway does not come down at all, which is up to
 * a strength of 0.5: a sway is too brief to read as a stretch.
 */
const SPLAT_SWAY_RIGID_ARC = 0.3;

/**
 * The bend of wind blowing toward a unit vector: as far as `strength` says on average, and half as much
 * again either way as gusts pass. `null` is the sway of a source with no wind direction.
 */
export function getSplatDeformationWind(
  direction?: ArrayLike<number> | null
): SplatDeformationWind {
  return direction ? [direction[0], direction[1], 1, 0.5] : SPLAT_SWAY;
}

/** Conservative radius around the undeformed transformed center, including covariance shear.
 * Both shader waves have unit amplitude. The branch-mode operator norm is bounded
 * by its Frobenius norm; derivatives vanish above the bend height and below zero.
 */
export function getSplatDeformationRadius(
  center: number[],
  radius: number,
  height: number,
  strength: number,
  wind: SplatDeformationWind = SPLAT_SWAY
): number {
  if (!strength || center[2] + radius <= 0) return radius;
  const bendHeight = Math.max(height, 0.001);
  const u = Math.min(1, Math.max(0, (center[2] + radius) / bendHeight));
  const v = Math.max((u - 0.3) / 0.7, 0);
  const f = 0.5 * u * u * (3 - u);
  const g = v * v;
  const lateral = Math.hypot(center[0], center[1]) + radius;
  const bend = Math.hypot(wind[0], wind[1]) * (Math.abs(wind[2]) + Math.abs(wind[3]));
  const branch = 0.35 * Math.hypot(0.65, 0.25, 0.3, 0.8);
  const derivatives = center[2] - radius < bendHeight;
  const shear = derivatives ? bend * 1.5 + (branch * 2 * v * lateral) / (0.7 * bendHeight) : 0;
  // How far the top comes down: u^3 never exceeds f, so this is at most the same shape as the bend.
  const reach = bend * strength;
  const arc = Math.max(reach * reach - (wind[2] > 0 ? 0 : SPLAT_SWAY_RIGID_ARC), 0);
  return (
    radius +
    Math.abs(strength) *
      (bend * bendHeight * f + branch * g * lateral + radius * (branch * g + shear)) +
    (2 / 3) * arc * bendHeight * f
  );
}

/**
 * Reduced cantilever motion: a clamped cubic bending shape plus a spatial crown
 * mode at twice the fundamental frequency. It is an animation approximation,
 * not a structural solver. The analytic Jacobian keeps meshes, splat covariance,
 * shading normals and picking on the same deformation.
 *
 * `wind` is a `SplatDeformationWind`. What bends far over also comes down, so a gale does not stretch
 * an owner: a position stays above its base, and the small change of scale this makes along z stays out
 * of the Jacobian.
 */
export const SPLAT_DEFORMATION_GLSL = `
mat3 splatDeform(inout vec3 position, float height, float strength, vec2 wave, vec4 wind) {
  float u = clamp(position.z / height, 0.0, 1.0);
  float f = 0.5 * u * u * (3.0 - u);
  float v = max((u - 0.3) / 0.7, 0.0);
  float g = v * v;
  vec2 bend = wind.xy * strength * (wind.z + wind.w * wave.x);
  float branch = 0.35 * strength * wave.y;
  mat2 mode = mat2(0.65, -0.25, 0.3, 0.8);
  vec2 lateral = mode * position.xy;
  mat2 xy = mat2(1.0) + branch * g * mode;
  float df = position.z > 0.0 && position.z < height ? 3.0 * u - 1.5 * u * u : 0.0;
  float dg = position.z > height * 0.3 && position.z < height ? 2.0 * v / (0.7 * height) : 0.0;
  vec2 dz = bend * df + branch * dg * lateral;
  position.xy += bend * height * f + branch * g * lateral;
  float arc = max(dot(bend, bend) - (wind.z > 0.0 ? 0.0 : ${SPLAT_SWAY_RIGID_ARC}), 0.0);
  position.z = max(position.z - 2.0 / 3.0 * arc * height * u * u * u, min(position.z, 0.0));
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
fn splatDeform(position: vec3<f32>, height: f32, strength: f32, wave: vec2<f32>, wind: vec4<f32>) -> SplatDeformation {
  let u = clamp(position.z / height, 0.0, 1.0);
  let f = 0.5 * u * u * (3.0 - u);
  let v = max((u - 0.3) / 0.7, 0.0);
  let g = v * v;
  let bend = wind.xy * strength * (wind.z + wind.w * wave.x);
  let branch = 0.35 * strength * wave.y;
  let mode = mat2x2<f32>(vec2<f32>(0.65, -0.25), vec2<f32>(0.3, 0.8));
  let lateral = mode * position.xy;
  let xy = mat2x2<f32>(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0)) + branch * g * mode;
  let df = select(0.0, 3.0 * u - 1.5 * u * u, position.z > 0.0 && position.z < height);
  let dg = select(0.0, 2.0 * v / (0.7 * height), position.z > height * 0.3 && position.z < height);
  let dz = bend * df + branch * dg * lateral;
  let arc = max(dot(bend, bend) - select(${SPLAT_SWAY_RIGID_ARC}, 0.0, wind.z > 0.0), 0.0);
  let fallen = max(position.z - 2.0 / 3.0 * arc * height * u * u * u, min(position.z, 0.0));
  return SplatDeformation(vec3<f32>(position.xy + bend * height * f + branch * g * lateral, fallen),
    mat3x3<f32>(vec3<f32>(xy[0], 0.0), vec3<f32>(xy[1], 0.0), vec3<f32>(dz, 1.0)));
}
fn splatDeformNormal(jacobian: mat3x3<f32>, normal: vec3<f32>) -> vec3<f32> {
  let determinant = jacobian[0].x * jacobian[1].y - jacobian[1].x * jacobian[0].y;
  let xy = vec2<f32>(jacobian[1].y * normal.x - jacobian[0].y * normal.y,
    jacobian[0].x * normal.y - jacobian[1].x * normal.x) / determinant;
  return vec3<f32>(xy, normal.z - dot(xy, jacobian[2].xy));
}`;
