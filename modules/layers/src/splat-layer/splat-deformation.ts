// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Trunk sway around the downwind lean, as a fraction of the lean: the bend stays in [0.75, 1.25]. */
const WIND_TRUNK_SWAY = 0.25;
/** Crown mode amplitude per unit strength. */
const WIND_BRANCH = 0.5;
/** Leaf flutter amplitude per unit strength, in object heights. */
const WIND_FLUTTER = 0.5;
/** Spatial frequency of the flutter phase, in radians per object height: branch-sized patches. */
const WIND_FLUTTER_WAVENUMBER = [7, 9, 5] as const;
/** Random flutter phase spread per Gaussian, in radians. */
const WIND_FLUTTER_SPREAD = 1.2;
/** Largest flutter offset for unit amplitude: `|axis w₁ + 0.4 across w₂, 0.5 w₂|` with |axis| = 1.097. */
const WIND_FLUTTER_REACH = Math.hypot(Math.hypot(1, 0.45) * Math.hypot(1, 0.4), 0.5);

/** Conservative radius around the undeformed transformed center, including covariance shear.
 * Every shader wave has unit amplitude and the trunk factor peaks at `1 + WIND_TRUNK_SWAY`. The
 * branch-mode operator norm is bounded by its Frobenius norm; derivatives vanish above the bend
 * height and below zero. Leaf flutter translates each Gaussian rigidly by at most
 * `WIND_FLUTTER × strength × height × reach`. Wind direction rotates the axis, mode and flutter
 * without changing their norms. `strength` is the peak, including any gust; `turbulence` scales the
 * crown mode and the flutter.
 */
export function getSplatDeformationRadius(
  center: number[],
  radius: number,
  height: number,
  strength: number,
  turbulence = 1
): number {
  if (!strength || center[2] + radius <= 0) return radius;
  const bendHeight = Math.max(height, 0.001);
  const u = Math.min(1, Math.max(0, (center[2] + radius) / bendHeight));
  const v = Math.max((u - 0.3) / 0.7, 0);
  const f = 0.5 * u * u * (3 - u);
  const g = v * v;
  const lateral = Math.hypot(center[0], center[1]) + radius;
  const bend = Math.hypot(1, 0.45) * (1 + WIND_TRUNK_SWAY);
  const branch = WIND_BRANCH * turbulence * Math.hypot(0.65, 0.25, 0.3, 0.8);
  const derivatives = center[2] - radius < bendHeight;
  const shear = derivatives ? bend * 1.5 + (branch * 2 * v * lateral) / (0.7 * bendHeight) : 0;
  const flutter = WIND_FLUTTER * turbulence * WIND_FLUTTER_REACH * bendHeight;
  return (
    radius +
    Math.abs(strength) *
      (bend * bendHeight * f + branch * g * lateral + radius * (branch * g + shear) + flutter)
  );
}

/** Per-Gaussian hash in [0, 1), exact in float32 so the GPU and the CPU sort agree. */
export function getSplatLeafHash(x: number, y: number, z: number): number {
  const qx = Math.floor(x * 64) + 65536,
    qy = Math.floor(y * 64) + 65536,
    qz = Math.floor(z * 64) + 65536;
  let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) >>> 0;
  h = (Math.imul(h, 747796405) + 2891336453) >>> 0;
  h = Math.imul(((h >>> ((h >>> 28) + 4)) ^ h) >>> 0, 277803737) >>> 0;
  return (((h >>> 22) ^ h) >>> 8) / 16777216;
}

/** `wind` module uniforms the CPU twin reads. */
export type SplatWindUniforms = {
  wave: readonly number[];
  mode: readonly number[];
  flutter: readonly number[];
  axis: readonly number[];
};

/**
 * CPU twin of the shaders' `splatDeform` plus `splatFlutter` displacement, for depth sorting and
 * tests. Writes the offset of a local point into `out` and returns it.
 * @param out - Receives `[dx, dy, dz]`.
 * @param position - Undeformed point relative to the owner's anchor, in metres.
 * @param seed - The Gaussian's template centre, which seeds its flutter; null for wood and meshes.
 * @param height - Bend height in metres.
 * @param strength - Bend strength: the gust-modulated uniform times the owner's flex.
 * @param phase - Owner `[sin φ, cos φ, sin 2φ, cos 2φ]`.
 * @param uniforms - The `wind` module uniforms.
 */
export function getSplatWindOffset(
  out: number[],
  position: readonly number[],
  seed: readonly number[] | null,
  height: number,
  strength: number,
  phase: readonly number[],
  uniforms: SplatWindUniforms
): number[] {
  const {wave, mode, flutter, axis} = uniforms;
  const [x, y, z] = position;
  const bendHeight = Math.max(height, 0.001);
  const u = Math.max(0, Math.min(1, z / bendHeight));
  const f = 0.5 * u * u * (3 - u),
    g = Math.max((u - 0.3) / 0.7, 0) ** 2;
  const trunkWave = wave[0] * phase[1] + wave[1] * phase[0];
  const crownWave = wave[2] * phase[3] + wave[3] * phase[2];
  const bend =
    strength * (1 + WIND_TRUNK_SWAY * (0.75 * trunkWave + 0.25 * crownWave)) * bendHeight * f;
  const branch = WIND_BRANCH * strength * crownWave * g;
  out[0] = bend * axis[0] + branch * (mode[0] * x + mode[2] * y);
  out[1] = bend * axis[1] + branch * (mode[1] * x + mode[3] * y);
  out[2] = 0;
  if (seed) {
    const [kx, ky, kz] = WIND_FLUTTER_WAVENUMBER;
    const crown =
      Math.max(0, Math.min(1, (u - 0.15) / 0.35)) *
      (0.4 + 0.6 * Math.min(Math.hypot(x, y) / (0.2 * bendHeight), 1));
    const leaf =
      (kx * x + ky * y + kz * z) / bendHeight +
      WIND_FLUTTER_SPREAD * getSplatLeafHash(seed[0], seed[1], seed[2]);
    const sinLeaf = Math.sin(leaf),
      cosLeaf = Math.cos(leaf);
    // Add the owner phase, so trees sharing a template flutter apart.
    const sin1 = sinLeaf * phase[1] + cosLeaf * phase[0],
      cos1 = cosLeaf * phase[1] - sinLeaf * phase[0];
    const w1 = flutter[0] * cos1 + flutter[1] * sin1;
    const w2 = flutter[2] * (cos1 * cos1 - sin1 * sin1) + flutter[3] * 2 * sin1 * cos1;
    const amount = WIND_FLUTTER * strength * bendHeight * crown;
    out[0] += amount * (axis[0] * w1 - 0.4 * axis[1] * w2);
    out[1] += amount * (axis[1] * w1 + 0.4 * axis[0] * w2);
    out[2] = amount * 0.5 * w2;
  }
  return out;
}

/**
 * Reduced cantilever motion: a clamped cubic bending shape plus a spatial crown
 * mode at twice the fundamental frequency. The trunk leans downwind by the mean drag and
 * sways around that lean on two harmonics (`wave.x`, `wave.y`), so it never swings upwind. It is
 * an animation approximation, not a structural solver. The analytic Jacobian keeps meshes, splat
 * covariance, shading normals and picking on the same deformation. `axis` and `mode` (the bend
 * direction and crown mode) come from the `wind` shader module.
 *
 * `splatFlutter` adds leaf flutter for foliage Gaussians: each one moves rigidly along the wind,
 * across it and up and down, faster than the trunk and further toward the crown's edge and top.
 * Its phase is coherent over branch-sized patches, jittered per Gaussian and offset per owner.
 */
export const SPLAT_DEFORMATION_GLSL = `
mat3 splatDeform(inout vec3 position, float height, float strength, vec2 wave, vec2 axis, mat2 mode) {
  float u = clamp(position.z / height, 0.0, 1.0);
  float f = 0.5 * u * u * (3.0 - u);
  float v = max((u - 0.3) / 0.7, 0.0);
  float g = v * v;
  vec2 bend = axis * strength * (1.0 + 0.25 * (0.75 * wave.x + 0.25 * wave.y));
  float branch = 0.5 * strength * wave.y;
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
}
float splatLeafHash(vec3 seed) {
  uvec3 q = uvec3(floor(seed * 64.0) + 65536.0);
  uint h = (q.x * 73856093u) ^ (q.y * 19349663u) ^ (q.z * 83492791u);
  h = h * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return float(((h >> 22u) ^ h) >> 8u) / 16777216.0;
}
vec3 splatFlutter(vec3 position, vec3 seed, float height, float strength, vec2 phase, vec2 axis, vec4 flutter) {
  float u = clamp(position.z / height, 0.0, 1.0);
  float crown = clamp((u - 0.15) / 0.35, 0.0, 1.0) * (0.4 + 0.6 * min(length(position.xy) / (0.2 * height), 1.0));
  float leaf = dot(position, vec3(7.0, 9.0, 5.0)) / height + 1.2 * splatLeafHash(seed);
  float sinLeaf = sin(leaf);
  float cosLeaf = cos(leaf);
  float sin1 = sinLeaf * phase.y + cosLeaf * phase.x;
  float cos1 = cosLeaf * phase.y - sinLeaf * phase.x;
  float w1 = flutter.x * cos1 + flutter.y * sin1;
  float w2 = flutter.z * (cos1 * cos1 - sin1 * sin1) + flutter.w * 2.0 * sin1 * cos1;
  float amount = 0.5 * strength * height * crown;
  return amount * vec3(axis * w1 + vec2(-axis.y, axis.x) * 0.4 * w2, 0.5 * w2);
}`;

export const SPLAT_DEFORMATION_WGSL = `
struct SplatDeformation {position: vec3<f32>, jacobian: mat3x3<f32>};
fn splatDeform(position: vec3<f32>, height: f32, strength: f32, wave: vec2<f32>, axis: vec2<f32>, mode: mat2x2<f32>) -> SplatDeformation {
  let u = clamp(position.z / height, 0.0, 1.0);
  let f = 0.5 * u * u * (3.0 - u);
  let v = max((u - 0.3) / 0.7, 0.0);
  let g = v * v;
  let bend = axis * strength * (1.0 + 0.25 * (0.75 * wave.x + 0.25 * wave.y));
  let branch = 0.5 * strength * wave.y;
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
}
fn splatLeafHash(seed: vec3<f32>) -> f32 {
  let q = vec3<u32>(floor(seed * 64.0) + 65536.0);
  var h = (q.x * 73856093u) ^ (q.y * 19349663u) ^ (q.z * 83492791u);
  h = h * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32(((h >> 22u) ^ h) >> 8u) / 16777216.0;
}
fn splatFlutter(position: vec3<f32>, seed: vec3<f32>, height: f32, strength: f32, phase: vec2<f32>, axis: vec2<f32>, flutter: vec4<f32>) -> vec3<f32> {
  let u = clamp(position.z / height, 0.0, 1.0);
  let crown = clamp((u - 0.15) / 0.35, 0.0, 1.0) * (0.4 + 0.6 * min(length(position.xy) / (0.2 * height), 1.0));
  let leaf = dot(position, vec3<f32>(7.0, 9.0, 5.0)) / height + 1.2 * splatLeafHash(seed);
  let sinLeaf = sin(leaf);
  let cosLeaf = cos(leaf);
  let sin1 = sinLeaf * phase.y + cosLeaf * phase.x;
  let cos1 = cosLeaf * phase.y - sinLeaf * phase.x;
  let w1 = flutter.x * cos1 + flutter.y * sin1;
  let w2 = flutter.z * (cos1 * cos1 - sin1 * sin1) + flutter.w * 2.0 * sin1 * cos1;
  let amount = 0.5 * strength * height * crown;
  return amount * vec3<f32>(axis * w1 + vec2<f32>(-axis.y, axis.x) * 0.4 * w2, 0.5 * w2);
}`;
