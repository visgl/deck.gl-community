// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {_GlobeViewport as GlobeViewport, type Viewport} from '@deck.gl/core';

/** deck.gl's sea-level globe radius in common units. */
const GLOBE_RADIUS = 256;
/** Below this horizontal length, an up vector is a pole and takes a fixed east. */
const POLE_EPSILON = 1e-7;

/**
 * Columns of the east-north-up frame at a common-space position on deck.gl's globe, or null in a
 * planar projection, whose common axes already point east, north and up. deck.gl's globe puts
 * longitude 0 on -y and the north pole on +z. Its own `project_get_orientation_matrix` turns this
 * frame half a turn about up, toward the west and south; owner metres keep true east-north-up so a
 * pose agrees with the Web Mercator view that GlobeView switches to above zoom 12.
 */
export function getSplatTangentFrame(
  common: ArrayLike<number>,
  viewport: Viewport
): number[] | null {
  if (!(viewport instanceof GlobeViewport)) return null;
  const length = Math.hypot(common[0], common[1], common[2]);
  const up = [common[0] / length, common[1] / length, common[2] / length];
  const horizontal = Math.hypot(up[0], up[1]);
  const east = horizontal > POLE_EPSILON ? [-up[1] / horizontal, up[0] / horizontal, 0] : [1, 0, 0];
  const north = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0]
  ];
  return [...east, ...north, ...up];
}

/** A common position offset by owner-local metres, scaled by `units` and turned by `frame`. */
export function offsetSplatCommonPosition(
  common: ArrayLike<number>,
  offset: ArrayLike<number>,
  units: ArrayLike<number>,
  frame: ArrayLike<number> | null
): number[] {
  const x = offset[0] * units[0],
    y = offset[1] * units[1],
    z = offset[2] * units[2];
  if (!frame) return [common[0] + x, common[1] + y, common[2] + z];
  return [0, 1, 2].map(
    axis => common[axis] + frame[axis] * x + frame[axis + 3] * y + frame[axis + 6] * z
  );
}

export type SplatHorizon = {
  /** Camera in common space. */
  camera: number[];
  /** Camera distance from the globe center. */
  distance: number;
  /** Angle at the globe center from the camera to its sea-level horizon. */
  angle: number;
};

/** The camera's sea-level horizon on deck.gl's globe, or null when the globe hides nothing. */
export function getSplatHorizon(viewport: Viewport): SplatHorizon | null {
  if (!(viewport instanceof GlobeViewport)) return null;
  const camera = viewport.cameraPosition;
  const distance = Math.hypot(camera[0], camera[1], camera[2]);
  if (!(distance > GLOBE_RADIUS)) return null;
  return {camera, distance, angle: Math.acos(GLOBE_RADIUS / distance)};
}

/** Angle at the globe center from a point at `radius` to its own sea-level horizon. */
function getSplatHorizonAngle(radius: number): number {
  return radius > GLOBE_RADIUS ? Math.acos(GLOBE_RADIUS / radius) : 0;
}

/**
 * Sphere/globe classification: -1 when the globe hides the whole sphere from the camera, 1 when no
 * part of it lies past the horizon, otherwise 0. A sightline clears the globe exactly when the
 * point's angle from the camera, at the globe center, is less than the sum of both horizon angles.
 */
export function classifySplatHorizon(
  center: ArrayLike<number>,
  radius: number,
  horizon: SplatHorizon
): -1 | 0 | 1 {
  const distance = Math.hypot(center[0], center[1], center[2]);
  if (!(distance > radius)) return 0;
  const [x, y, z] = horizon.camera;
  const cross = Math.hypot(
    center[1] * z - center[2] * y,
    center[2] * x - center[0] * z,
    center[0] * y - center[1] * x
  );
  const angle = Math.atan2(cross, center[0] * x + center[1] * y + center[2] * z);
  const spread = Math.asin(radius / distance);
  if (angle - spread > horizon.angle + getSplatHorizonAngle(distance + radius)) return -1;
  if (angle + spread < horizon.angle + getSplatHorizonAngle(distance - radius)) return 1;
  return 0;
}

/**
 * GLSL helpers for owner-local metres in any deck.gl projection. Planar projections take the
 * identity frame and keep deck.gl's own `project_position_to_clipspace` arithmetic.
 */
export const SPLAT_GLOBE_GLSL = `
// East-north-up at a common-space position on deck.gl's globe, identity in planar projections.
mat3 splatTangentFrame(vec3 commonPosition) {
  if (project.projectionMode != PROJECTION_MODE_GLOBE) return mat3(1.0);
  vec3 up = normalize(commonPosition);
  vec2 east = vec2(-up.y, up.x);
  float eastLength = length(east);
  vec3 eastAxis = eastLength > ${POLE_EPSILON} ? vec3(east / eastLength, 0.0) : vec3(1.0, 0.0, 0.0);
  return mat3(eastAxis, cross(up, eastAxis), up);
}
// project_position_to_clipspace with the offset in metres east, north and up of the anchor.
vec4 splatProjectOffset(vec3 position, vec3 position64Low, vec3 offset, out vec4 commonPosition) {
  vec3 anchor = project_position(position, position64Low);
  commonPosition = vec4(anchor + splatTangentFrame(anchor) * offset, 1.0);
  return project_common_position_to_clipspace(commonPosition);
}
// project_normal for a direction in the east-north-up frame at a common-space position.
vec3 splatProjectNormal(vec3 normal, vec3 commonPosition) {
  if (project.projectionMode != PROJECTION_MODE_GLOBE) return project_normal(normal);
  return normalize(splatTangentFrame(commonPosition) * (project.modelMatrix * vec4(normal, 0.0)).xyz);
}
// Whether the sea-level globe hides a common-space point from the camera: the sightline's nearest
// approach to the globe center lies between them, and inside the globe.
bool splatBehindGlobe(vec3 position) {
  if (project.projectionMode != PROJECTION_MODE_GLOBE) return false;
  vec3 ray = project.cameraPosition - position;
  float along = dot(position, ray);
  float rayLength = dot(ray, ray);
  if (along >= 0.0 || -along >= rayLength) return false;
  return dot(position, position) - along * along / rayLength < GLOBE_RADIUS * GLOBE_RADIUS;
}
`;

/** WGSL counterparts of `SPLAT_GLOBE_GLSL`. */
export const SPLAT_GLOBE_WGSL = `
fn splatTangentFrame(commonPosition: vec3<f32>) -> mat3x3<f32> {
  if (project.projectionMode != PROJECTION_MODE_GLOBE) {
    return mat3x3<f32>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0));
  }
  let up = normalize(commonPosition);
  let east = vec2<f32>(-up.y, up.x);
  let eastLength = length(east);
  var eastAxis = vec3<f32>(1.0, 0.0, 0.0);
  if (eastLength > ${POLE_EPSILON}) { eastAxis = vec3<f32>(east / eastLength, 0.0); }
  return mat3x3<f32>(eastAxis, cross(up, eastAxis), up);
}
fn splatProjectOffset(position: vec3<f32>, position64Low: vec3<f32>, offset: vec3<f32>) -> ProjectResult {
  let anchor = project_position_vec3_f64(position, position64Low);
  let commonPosition = vec4<f32>(anchor + splatTangentFrame(anchor) * offset, 1.0);
  return ProjectResult(project_common_position_to_clipspace(commonPosition), commonPosition);
}
fn splatProjectNormal(normal: vec3<f32>, commonPosition: vec3<f32>) -> vec3<f32> {
  if (project.projectionMode != PROJECTION_MODE_GLOBE) { return project_normal(normal); }
  return normalize(splatTangentFrame(commonPosition) * (project.modelMatrix * vec4<f32>(normal, 0.0)).xyz);
}
fn splatBehindGlobe(position: vec3<f32>) -> bool {
  if (project.projectionMode != PROJECTION_MODE_GLOBE) { return false; }
  let ray = project.cameraPosition - position;
  let along = dot(position, ray);
  let rayLength = dot(ray, ray);
  if (along >= 0.0 || -along >= rayLength) { return false; }
  return dot(position, position) - along * along / rayLength < GLOBE_RADIUS * GLOBE_RADIUS;
}
`;
