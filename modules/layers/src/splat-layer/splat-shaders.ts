// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_DEFORMATION_GLSL} from './splat-deformation';

const DECLARATION = `uniform splatUniforms {
  float strength;
  float time;
  float mode;
  float kernelVariance;
  float alphaCutoff;
  float support;
  vec4 wave;
  mat4 lightMatrix;
  vec4 lightCenter;
  vec2 lightViewport;
} splat;`;
export const splatUniforms = {
  name: 'splat',
  vs: DECLARATION,
  fs: DECLARATION,
  source: `struct SplatUniforms { strength: f32, time: f32, mode: f32, kernelVariance: f32, alphaCutoff: f32, support: f32, wave: vec4<f32>, lightMatrix: mat4x4<f32>, lightCenter: vec4<f32>, lightViewport: vec2<f32> };
@group(0) @binding(auto) var<uniform> splat: SplatUniforms;`,
  uniformTypes: {
    strength: 'f32',
    time: 'f32',
    mode: 'f32',
    kernelVariance: 'f32',
    alphaCutoff: 'f32',
    support: 'f32',
    wave: 'vec4<f32>',
    lightMatrix: 'mat4x4<f32>',
    lightCenter: 'vec4<f32>',
    lightViewport: 'vec2<f32>'
  }
} as const satisfies ShaderModule;

export const SPLAT_VERTEX = `#version 300 es
in vec2 splatCorners;
in vec3 splatCenters;
in vec3 splatAxisX;
in vec3 splatAxisY;
in vec3 splatAxisZ;
in vec4 splatColors;
in vec3 splatNormals;
in vec3 instancePositions;
in vec3 instancePositions64Low;
in vec4 instanceColors;
in vec3 instanceModelMatrixCol0;
in vec3 instanceModelMatrixCol1;
in vec3 instanceModelMatrixCol2;
in vec3 instanceTranslation;
in vec4 instanceDeformation;
in vec3 instanceCoverageWeight;
out vec2 gaussianPosition;
out vec4 vColor;
out vec3 vNormal;
out vec3 vPosition;
out vec3 vCamera;
out float vCoverageWeight;
${SPLAT_DEFORMATION_GLSL}
vec2 projectAxis(vec3 axis, vec4 center) {
  mat4 projection = splat.mode > 2.5 ? splat.lightMatrix : project.viewProjectionMatrix;
  vec4 delta = projection * vec4(project_size(axis), 0.0);
  vec2 viewportSize = splat.mode > 2.5 ? splat.lightViewport : project.viewportSize;
  return (delta.xy * center.w - center.xy * delta.w) / (center.w * center.w) * viewportSize * 0.5;
}
void main() {
  geometry.worldPosition = instancePositions;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  mat3 transform = mat3(instanceModelMatrixCol0, instanceModelMatrixCol1, instanceModelMatrixCol2);
  vec3 position = transform * splatCenters + instanceTranslation;
  mat3 covariance = transform * mat3(splatAxisX, splatAxisY, splatAxisZ);
  vec3 squaredScale = max(vec3(dot(transform[0],transform[0]), dot(transform[1],transform[1]), dot(transform[2],transform[2])), vec3(1e-12));
  vec3 normal = transform * (splatNormals / squaredScale);
  float height = max(instanceDeformation.x, 0.001);
  vec2 wave = vec2(splat.wave.x * instanceDeformation.w + splat.wave.y * instanceDeformation.z,
    splat.wave.z * instanceCoverageWeight.z + splat.wave.w * instanceCoverageWeight.y);
  mat3 jacobian = splatDeform(position, height, splat.strength * instanceDeformation.y, wave);
  covariance = jacobian * covariance;
  normal = splatDeformNormal(jacobian, normal);
  vec4 commonPosition;
  vec4 center = project_position_to_clipspace(instancePositions, instancePositions64Low, project_size(position), commonPosition);
  if (splat.mode > 2.5) center = splat.lightMatrix * commonPosition + splat.lightCenter;
  geometry.position = commonPosition;
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vCoverageWeight = instanceCoverageWeight.x;
  vNormal = project_normal(normal);
  geometry.normal = vNormal;
  vec2 x = projectAxis(covariance[0], center);
  vec2 y = projectAxis(covariance[1], center);
  vec2 z = projectAxis(covariance[2], center);
  float a = x.x*x.x + y.x*y.x + z.x*z.x;
  float b = x.x*x.y + y.x*y.y + z.x*z.y;
  float c = x.y*x.y + y.y*y.y + z.y*z.y;
  float determinant = max(a*c-b*b, 0.0);
  a += splat.kernelVariance;
  c += splat.kernelVariance;
  float filteredDeterminant = max(a*c-b*b, 1e-12);
  float compensation = sqrt(determinant / filteredDeterminant);
  // Eigenvectors give a tight oriented footprint, reducing transparent overdraw.
  float middle = 0.5 * (a + c);
  float spread = sqrt(max(0.25*(a-c)*(a-c)+b*b, 0.0));
  float major = max(middle + spread, 1e-8);
  float minor = max(middle - spread, 1e-8);
  vec2 direction = abs(b) > 1e-8 ? normalize(vec2(b, major-a)) : (a >= c ? vec2(1,0) : vec2(0,1));
  vec2 offset = (direction * sqrt(major) * splatCorners.x + vec2(-direction.y,direction.x) * sqrt(minor) * splatCorners.y) * splat.support;
  gaussianPosition = splatCorners * splat.support;
  vColor = vec4(splatColors.rgb * instanceColors.rgb, splatColors.a * instanceColors.a * (splat.mode > 2.5 ? 1.0 : layer.opacity) * compensation);
  gl_Position = center;
  vec2 viewportSize = splat.mode > 2.5 ? splat.lightViewport : project.viewportSize;
  gl_Position.xy += offset / viewportSize * 2.0 * center.w;
  if (center.w <= 0.0 || center.z < -center.w || vColor.a < splat.alphaCutoff) gl_Position = vec4(2,2,2,1);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  DECKGL_FILTER_COLOR(vColor, geometry);
}`;

export const SPLAT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 gaussianPosition;
in vec4 vColor;
in vec3 vNormal;
in vec3 vPosition;
in vec3 vCamera;
in float vCoverageWeight;
out vec4 fragColor;
void main() {
  float radiusSquared = dot(gaussianPosition, gaussianPosition);
  if (radiusSquared > splat.support * splat.support) discard;
  float alpha = min(0.995, 1.0 - pow(max(1.0 - vColor.a * exp(-0.5 * radiusSquared), 0.005), vCoverageWeight));
  if (alpha < splat.alphaCutoff || (picking.isActive > 0.5 && alpha < 0.08)) discard;
  geometry.uv = gaussianPosition;
  if (splat.mode > 2.5) { fragColor = vec4(alpha); return; }
  vec3 normal = normalize(vNormal);
  if (dot(normal, vCamera - vPosition) < 0.0) normal = -normal;
  vec3 shaded = lighting_getLightColor(vColor.rgb, vCamera, vPosition, normal);
  vec4 color = vec4(shaded, alpha);
  DECKGL_FILTER_COLOR(color, geometry);
  if (splat.mode > 1.5) { fragColor = vec4(alpha); }
  else if (splat.mode > 0.5) {
    // Bounded weighted blending: opacity is exact in the separate transmission buffer.
    float weight = clamp(pow(alpha + 0.01, 3.0) * 100.0 * pow(1.0 - gl_FragCoord.z * 0.9, 3.0), 0.01, 30.0);
    fragColor = vec4(color.rgb * alpha, alpha) * weight;
  } else { fragColor = color; }
}`;

// Color and optical depth use the same additive blend, so MRT resolves both in one geometry pass.
export const SPLAT_ACCUMULATION_FRAGMENT = SPLAT_FRAGMENT.replace(
  'out vec4 fragColor;',
  'layout(location=0) out vec4 fragColor;\nlayout(location=1) out vec4 opticalDepth;'
).replace(
  '  geometry.uv = gaussianPosition;',
  '  opticalDepth = vec4(-log(max(1.0 - alpha, 0.005)), 0.0, 0.0, 0.0);\n  geometry.uv = gaussianPosition;'
);
