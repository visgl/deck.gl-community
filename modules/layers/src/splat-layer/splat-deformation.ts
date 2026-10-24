// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Trunk sway around the downwind lean, as a fraction of the lean: the bend stays in [0.75, 1.25]. */
const WIND_TRUNK_SWAY = 0.25;
/** Crown mode amplitude per unit strength. */
const WIND_CROWN = 0.35;
/** Branch sway amplitude per unit strength, in object heights, for a branch `WIND_BRANCH_SPAN` out. */
const WIND_BRANCH = 0.5;
/** Lateral distance, in object heights, at which branch sway reaches most of its amplitude. */
const WIND_BRANCH_SPAN = 0.3;
/** Branch phase change per object height, so crown tiers sway out of step. */
const WIND_BRANCH_TIER = 5;
/** Leaf flutter amplitude per unit strength, in object heights: a shimmer on top of the branches. */
const WIND_FLUTTER = 0.08;
/** `|axis w₁ + 0.4 across w₂|` for unit waves, with |axis| = |across| = 1.097. */
const WIND_SWAY_REACH = Math.hypot(1, 0.45) * Math.hypot(1, 0.4);
/** `|axis w₁′ + 0.4 across w₂′|` with |w₁′| ≤ 1 and |w₂′| ≤ 2. */
const WIND_SWAY_SLOPE = Math.hypot(1, 0.45) * Math.hypot(1, 0.8);

/** Smooth, saturating branch reach `q² / (1 + q²/4)` for `q` branch spans out: 0 at the trunk axis. */
function getBranchReach(lateral: number, height: number): number {
  const q2 = (lateral / (WIND_BRANCH_SPAN * height)) ** 2;
  return q2 / (1 + 0.25 * q2);
}

/**
 * Largest branch sway, per unit strength, of a point up to `lateral` metres from the trunk axis.
 * Owner bounds add it to the trunk and crown terms.
 */
export function getSplatBranchSwayRadius(lateral: number, height: number, turbulence = 1): number {
  const bendHeight = Math.max(height, 0.001);
  return (
    WIND_BRANCH * bendHeight * getBranchReach(lateral, bendHeight) * WIND_SWAY_REACH * turbulence
  );
}

/** Conservative radius around the undeformed transformed center, including covariance shear.
 * Every shader wave has unit amplitude and the trunk factor peaks at `1 + WIND_TRUNK_SWAY`. The
 * crown-mode operator norm is bounded by its Frobenius norm; derivatives vanish above the bend
 * height and below zero. Branch sway grows with the saturating reach, and its gradient stays below
 * `4.9 × turbulence` across and `6.5 × reach × turbulence` up the crown, per unit strength. Leaf
 * flutter translates each Gaussian rigidly. Wind direction rotates the axis, mode and sway without
 * changing their norms. `strength` is the peak, including any gust; `turbulence` scales the crown
 * mode, the branch sway and the flutter.
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
  const crown = WIND_CROWN * turbulence * Math.hypot(0.65, 0.25, 0.3, 0.8);
  const derivatives = center[2] - radius < bendHeight;
  const shear = derivatives ? bend * 1.5 + (crown * 2 * v * lateral) / (0.7 * bendHeight) : 0;
  const reach = getBranchReach(lateral, bendHeight);
  const branch = getSplatBranchSwayRadius(lateral, bendHeight, turbulence);
  // |∂reach/∂r| ≤ 1.3 / span and reach·|∇θ| ≤ 1 / span across; the tier ramp rises 1.5 per
  // 0.3 H and the phase 5 per H up the crown.
  const branchShear =
    WIND_BRANCH *
    turbulence *
    Math.max(
      (1.3 * WIND_SWAY_REACH + WIND_SWAY_SLOPE) / WIND_BRANCH_SPAN,
      reach * ((1.5 / 0.3) * WIND_SWAY_REACH + WIND_BRANCH_TIER * WIND_SWAY_SLOPE)
    );
  const flutter = WIND_FLUTTER * bendHeight * Math.hypot(WIND_SWAY_REACH, 0.6) * turbulence;
  return (
    radius +
    Math.abs(strength) *
      (bend * bendHeight * f +
        crown * g * lateral +
        branch +
        flutter +
        radius * (crown * g + shear + branchShear))
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
  branch: readonly number[];
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
 * @param phase - Owner `[sin φ, cos φ, sin ψ, cos ψ]`: the trunk and the crown-mode phase.
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
  const {wave, mode, branch, flutter, axis} = uniforms;
  const [x, y, z] = position;
  const bendHeight = Math.max(height, 0.001);
  const u = Math.max(0, Math.min(1, z / bendHeight));
  const f = 0.5 * u * u * (3 - u),
    g = Math.max((u - 0.3) / 0.7, 0) ** 2;
  const trunkWave = wave[0] * phase[1] + wave[1] * phase[0];
  const crownWave = wave[2] * phase[3] + wave[3] * phase[2];
  const bend =
    strength * (1 + WIND_TRUNK_SWAY * (0.75 * trunkWave + 0.25 * crownWave)) * bendHeight * f;
  const crown = WIND_CROWN * strength * crownWave * g;
  // Branch sway: rooted at the trunk axis, coherent along each branch, out of step around the
  // crown (azimuth) and up it (tier).
  const r = Math.hypot(x, y);
  const t = Math.max(0, Math.min(1, (u - 0.1) / 0.3));
  const tier = t * t * (3 - 2 * t);
  const rise = (WIND_BRANCH_TIER * z) / bendHeight;
  const sinBeta = Math.sin(rise) * phase[1] + Math.cos(rise) * phase[0],
    cosBeta = Math.cos(rise) * phase[1] - Math.sin(rise) * phase[0];
  const [cosAzimuth, sinAzimuth] = r > 0 ? [x / r, y / r] : [1, 0];
  const sinTheta = sinAzimuth * cosBeta + cosAzimuth * sinBeta,
    cosTheta = cosAzimuth * cosBeta - sinAzimuth * sinBeta;
  const w1 = branch[0] * cosTheta + branch[1] * sinTheta;
  const w2 =
    branch[2] * (cosTheta * cosTheta - sinTheta * sinTheta) + branch[3] * 2 * sinTheta * cosTheta;
  const sway = WIND_BRANCH * strength * bendHeight * tier * getBranchReach(r, bendHeight);
  out[0] =
    bend * axis[0] +
    crown * (mode[0] * x + mode[2] * y) +
    sway * (axis[0] * w1 - 0.4 * axis[1] * w2);
  out[1] =
    bend * axis[1] +
    crown * (mode[1] * x + mode[3] * y) +
    sway * (axis[1] * w1 + 0.4 * axis[0] * w2);
  out[2] = 0;
  if (seed) {
    const shelter = Math.min(0.3 + r / (WIND_BRANCH_SPAN * bendHeight), 1);
    const leaf = 2 * Math.PI * getSplatLeafHash(seed[0], seed[1], seed[2]);
    const sinLeaf = Math.sin(leaf),
      cosLeaf = Math.cos(leaf);
    // Add the owner phase, so trees sharing a template flutter apart.
    const sin1 = sinLeaf * phase[1] + cosLeaf * phase[0],
      cos1 = cosLeaf * phase[1] - sinLeaf * phase[0];
    const l1 = flutter[0] * cos1 + flutter[1] * sin1;
    const l2 = flutter[2] * (cos1 * cos1 - sin1 * sin1) + flutter[3] * 2 * sin1 * cos1;
    const amount = WIND_FLUTTER * strength * bendHeight * tier * shelter;
    out[0] += amount * (axis[0] * l1 - 0.4 * axis[1] * l2);
    out[1] += amount * (axis[1] * l1 + 0.4 * axis[0] * l2);
    out[2] = amount * 0.6 * l2;
  }
  return out;
}

/**
 * Tree motion in three levels, each carried by the one below:
 *
 * - **Trunk.** A clamped cubic cantilever leans downwind by the mean drag and sways around that
 *   lean on two harmonics (`wave.x`, `wave.y`): it never swings upwind.
 * - **Crown and branches.** A small crown mode at twice the trunk frequency, plus branch sway: a
 *   continuous field that is zero on the trunk axis and grows toward the branch tips. It is coherent
 *   along each branch (its phase follows the azimuth around the trunk and the height, not the
 *   distance out), so branches swing out of step around and up the crown and carry their leaves.
 *   Wood, crops and foliage share it.
 * - **Leaves.** `splatFlutter` adds a small, fast shimmer to each foliage Gaussian, rigidly.
 *
 * It is an animation approximation, not a structural solver. The analytic Jacobian keeps meshes,
 * splat covariance, shading normals and picking on the same deformation: the sway is horizontal,
 * so the Jacobian keeps a unit z row. `axis`, `mode`, `branch` and `flutter` come from the `wind`
 * shader module; `phase` is the owner's `(sin φ, cos φ)`. Neither the offset nor its gradient
 * divides by the distance to the axis (`reach / r² = kappa`).
 */
export const SPLAT_DEFORMATION_GLSL = `
mat3 splatDeform(inout vec3 position, float height, float strength, vec2 wave, vec2 axis, mat2 mode, vec2 phase, vec4 branch) {
  float u = clamp(position.z / height, 0.0, 1.0);
  float f = 0.5 * u * u * (3.0 - u);
  float v = max((u - 0.3) / 0.7, 0.0);
  float g = v * v;
  vec2 bend = axis * strength * (1.0 + 0.25 * (0.75 * wave.x + 0.25 * wave.y));
  float crown = 0.35 * strength * wave.y;
  vec2 lateral = mode * position.xy;
  mat2 xy = mat2(1.0) + crown * g * mode;
  float df = position.z > 0.0 && position.z < height ? 3.0 * u - 1.5 * u * u : 0.0;
  float dg = position.z > height * 0.3 && position.z < height ? 2.0 * v / (0.7 * height) : 0.0;
  vec2 dz = bend * df + crown * dg * lateral;
  float span = 0.3 * height;
  float r2 = dot(position.xy, position.xy);
  float q2 = r2 / (span * span);
  float kappa = 1.0 / (span * span * (1.0 + 0.25 * q2));
  float reach = kappa * r2;
  float t = clamp((u - 0.1) / 0.3, 0.0, 1.0);
  float tier = t * t * (3.0 - 2.0 * t);
  float dtier = position.z > 0.1 * height && position.z < 0.4 * height ? 6.0 * t * (1.0 - t) / (0.3 * height) : 0.0;
  float r = sqrt(r2);
  vec2 azimuth = r > 0.0 ? position.xy / r : vec2(1.0, 0.0);
  float rise = 5.0 * position.z / height;
  float sinBeta = sin(rise) * phase.y + cos(rise) * phase.x;
  float cosBeta = cos(rise) * phase.y - sin(rise) * phase.x;
  float sinTheta = azimuth.y * cosBeta + azimuth.x * sinBeta;
  float cosTheta = azimuth.x * cosBeta - azimuth.y * sinBeta;
  float cos2Theta = cosTheta * cosTheta - sinTheta * sinTheta;
  float sin2Theta = 2.0 * sinTheta * cosTheta;
  vec2 across = vec2(-axis.y, axis.x);
  vec2 sway = axis * (branch.x * cosTheta + branch.y * sinTheta) + across * 0.4 * (branch.z * cos2Theta + branch.w * sin2Theta);
  vec2 dsway = axis * (branch.y * cosTheta - branch.x * sinTheta) + across * 0.8 * (branch.w * cos2Theta - branch.z * sin2Theta);
  float amount = 0.5 * strength * height;
  vec2 dReach = 2.0 * kappa / (1.0 + 0.25 * q2) * position.xy;
  vec2 dTheta = kappa * vec2(-position.y, position.x);
  xy[0] += amount * tier * (dReach.x * sway + dTheta.x * dsway);
  xy[1] += amount * tier * (dReach.y * sway + dTheta.y * dsway);
  dz += amount * reach * (dtier * sway + tier * 5.0 / height * dsway);
  position.xy += bend * height * f + crown * g * lateral + amount * tier * reach * sway;
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
  float t = clamp((position.z / height - 0.1) / 0.3, 0.0, 1.0);
  float shelter = min(0.3 + length(position.xy) / (0.3 * height), 1.0);
  float leaf = 6.2831853 * splatLeafHash(seed);
  float sinLeaf = sin(leaf);
  float cosLeaf = cos(leaf);
  float sin1 = sinLeaf * phase.y + cosLeaf * phase.x;
  float cos1 = cosLeaf * phase.y - sinLeaf * phase.x;
  float l1 = flutter.x * cos1 + flutter.y * sin1;
  float l2 = flutter.z * (cos1 * cos1 - sin1 * sin1) + flutter.w * 2.0 * sin1 * cos1;
  float amount = 0.08 * strength * height * t * t * (3.0 - 2.0 * t) * shelter;
  return amount * vec3(axis * l1 + vec2(-axis.y, axis.x) * 0.4 * l2, 0.6 * l2);
}`;

export const SPLAT_DEFORMATION_WGSL = `
struct SplatDeformation {position: vec3<f32>, jacobian: mat3x3<f32>};
fn splatDeform(position: vec3<f32>, height: f32, strength: f32, wave: vec2<f32>, axis: vec2<f32>, mode: mat2x2<f32>, phase: vec2<f32>, branch: vec4<f32>) -> SplatDeformation {
  let u = clamp(position.z / height, 0.0, 1.0);
  let f = 0.5 * u * u * (3.0 - u);
  let v = max((u - 0.3) / 0.7, 0.0);
  let g = v * v;
  let bend = axis * strength * (1.0 + 0.25 * (0.75 * wave.x + 0.25 * wave.y));
  let crown = 0.35 * strength * wave.y;
  let lateral = mode * position.xy;
  var xy = mat2x2<f32>(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0)) + crown * g * mode;
  let df = select(0.0, 3.0 * u - 1.5 * u * u, position.z > 0.0 && position.z < height);
  let dg = select(0.0, 2.0 * v / (0.7 * height), position.z > height * 0.3 && position.z < height);
  var dz = bend * df + crown * dg * lateral;
  let span = 0.3 * height;
  let r2 = dot(position.xy, position.xy);
  let q2 = r2 / (span * span);
  let kappa = 1.0 / (span * span * (1.0 + 0.25 * q2));
  let reach = kappa * r2;
  let t = clamp((u - 0.1) / 0.3, 0.0, 1.0);
  let tier = t * t * (3.0 - 2.0 * t);
  let dtier = select(0.0, 6.0 * t * (1.0 - t) / (0.3 * height), position.z > 0.1 * height && position.z < 0.4 * height);
  let r = sqrt(r2);
  let azimuth = select(vec2<f32>(1.0, 0.0), position.xy / max(r, 1e-30), r > 0.0);
  let rise = 5.0 * position.z / height;
  let sinBeta = sin(rise) * phase.y + cos(rise) * phase.x;
  let cosBeta = cos(rise) * phase.y - sin(rise) * phase.x;
  let sinTheta = azimuth.y * cosBeta + azimuth.x * sinBeta;
  let cosTheta = azimuth.x * cosBeta - azimuth.y * sinBeta;
  let cos2Theta = cosTheta * cosTheta - sinTheta * sinTheta;
  let sin2Theta = 2.0 * sinTheta * cosTheta;
  let across = vec2<f32>(-axis.y, axis.x);
  let sway = axis * (branch.x * cosTheta + branch.y * sinTheta) + across * 0.4 * (branch.z * cos2Theta + branch.w * sin2Theta);
  let dsway = axis * (branch.y * cosTheta - branch.x * sinTheta) + across * 0.8 * (branch.w * cos2Theta - branch.z * sin2Theta);
  let amount = 0.5 * strength * height;
  let dReach = 2.0 * kappa / (1.0 + 0.25 * q2) * position.xy;
  let dTheta = kappa * vec2<f32>(-position.y, position.x);
  xy[0] += amount * tier * (dReach.x * sway + dTheta.x * dsway);
  xy[1] += amount * tier * (dReach.y * sway + dTheta.y * dsway);
  dz += amount * reach * (dtier * sway + tier * 5.0 / height * dsway);
  return SplatDeformation(vec3<f32>(position.xy + bend * height * f + crown * g * lateral + amount * tier * reach * sway, position.z),
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
  let t = clamp((position.z / height - 0.1) / 0.3, 0.0, 1.0);
  let shelter = min(0.3 + length(position.xy) / (0.3 * height), 1.0);
  let leaf = 6.2831853 * splatLeafHash(seed);
  let sinLeaf = sin(leaf);
  let cosLeaf = cos(leaf);
  let sin1 = sinLeaf * phase.y + cosLeaf * phase.x;
  let cos1 = cosLeaf * phase.y - sinLeaf * phase.x;
  let l1 = flutter.x * cos1 + flutter.y * sin1;
  let l2 = flutter.z * (cos1 * cos1 - sin1 * sin1) + flutter.w * 2.0 * sin1 * cos1;
  let amount = 0.08 * strength * height * t * t * (3.0 - 2.0 * t) * shelter;
  return amount * vec3<f32>(axis * l1 + vec2<f32>(-axis.y, axis.x) * 0.4 * l2, 0.6 * l2);
}`;
