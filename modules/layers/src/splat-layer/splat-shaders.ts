// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_DEFORMATION_GLSL} from './splat-deformation';
import {SPLAT_GLOBE_GLSL} from './splat-globe';

const DECLARATION = `uniform splatUniforms {
  float mode;
  float kernelVariance;
  float alphaCutoff;
  float support;
  float opticalDepthMode;
} splat;`;
export const splatUniforms = {
  name: 'splat',
  vs: DECLARATION,
  fs: DECLARATION,
  source: `struct SplatUniforms { mode: f32, kernelVariance: f32, alphaCutoff: f32, support: f32, opticalDepthMode: f32 };
@group(0) @binding(auto) var<uniform> splat: SplatUniforms;`,
  uniformTypes: {
    mode: 'f32',
    kernelVariance: 'f32',
    alphaCutoff: 'f32',
    support: 'f32',
    opticalDepthMode: 'f32'
  }
} as const satisfies ShaderModule;

/**
 * deck.gl's `shadow` module (GLSL only), present while a `LightingEffect` has a shadow light.
 * Casting projects each covariance with the light's orthographic matrix and keeps the fragments
 * whose alpha exceeds a stable per-Gaussian random threshold, so overlapping Gaussians block light
 * as `1 - Π(1 - alpha)`. Receiving tests the owner's light-facing side, so a crown is shaded by
 * other owners and layers but not, through weighted transparency, by its own interior.
 */
const SPLAT_SHADOW_VERTEX = `#ifdef MODULE_SHADOW
flat out float splatShadowThreshold;
// Receiver light depths at the owner's tangent plane, for up to two lights.
out vec2 splatShadowDepth;
// Source-unit radius around a source's origin that holds every Gaussian centre: TreeLayer crowns
// lie within 1.1 units.
const float SPLAT_SHADOW_OWNER_RADIUS = 1.25;
// The light-depth offset from a receiver to its owner's light-facing tangent plane, less one
// shadow-map texel. A caster draws a flat footprint at its centre depth, so none of this owner's
// Gaussians lies nearer the light than that plane, however wide; nearer owners still shadow it.
// transform maps source units to metres along the common axes; ownerOffset is the receiver minus
// the source origin, in common units.
float splatShadowReceiveOffset(mat4 light, mat3 transform, vec3 ownerOffset) {
  // Light depth grows away from the light, along this row of its view-projection.
  vec3 depthAxis = vec3(light[0].z, light[1].z, light[2].z);
  // deck.gl sizes its shadow maps like the viewport.
  vec2 texel = 2.0 / max(project.viewportSize * vec2(length(vec3(light[0].x, light[1].x, light[2].x)),
    length(vec3(light[0].y, light[1].y, light[2].y))), vec2(1e-20));
  float plane = -dot(depthAxis, ownerOffset)
    - SPLAT_SHADOW_OWNER_RADIUS * project_size(1.0) * length(transpose(transform) * depthAxis)
    - max(texel.x, texel.y) * length(depthAxis);
  return min(plane * 0.5, 0.0);
}
// pcg3d (Jarzynski and Olano 2020): independent per Gaussian, stable across frames and map fits.
uvec3 splatShadowPcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float splatShadowHash(vec3 local, vec3 owner, vec3 ownerLow) {
  uvec3 v = splatShadowPcg(floatBitsToUint(local)) ^ floatBitsToUint(owner);
  v = splatShadowPcg(v) ^ floatBitsToUint(ownerLow);
  return float(splatShadowPcg(v).x >> 8u) / 16777216.0;
}
#endif`;

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
${SPLAT_GLOBE_GLSL}
${SPLAT_SHADOW_VERTEX}
void main() {
  geometry.worldPosition = instancePositions;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  mat3 transform = mat3(instanceModelMatrixCol0, instanceModelMatrixCol1, instanceModelMatrixCol2);
  vec3 position = transform * splatCenters + instanceTranslation;
  mat3 covariance = transform * mat3(splatAxisX, splatAxisY, splatAxisZ);
  vec3 normalAxisX = cross(transform[1], transform[2]);
  vec3 normalAxisY = cross(transform[2], transform[0]);
  vec3 normalAxisZ = cross(transform[0], transform[1]);
  float normalDeterminant = dot(transform[0], normalAxisX);
  // Cofactors form the inverse transpose, including shear and reflections.
  vec3 normal = mat3(normalAxisX, normalAxisY, normalAxisZ) * splatNormals;
  normal *= (normalDeterminant < 0.0 ? -1.0 : 1.0) / max(abs(normalDeterminant), 1e-20);
  float height = max(instanceDeformation.x, 0.001);
  vec2 wave = vec2(wind.wave.x * instanceDeformation.w + wind.wave.y * instanceDeformation.z,
    wind.wave.z * instanceCoverageWeight.z + wind.wave.w * instanceCoverageWeight.y);
  mat3 jacobian = mat3(1.0);
  if (wind.strength != 0.0) {
    float windStrength = wind.strength * instanceDeformation.y;
    vec3 flutter = splatFlutter(position, splatCenters, height, windStrength, instanceDeformation.zw, wind.axis, wind.flutter);
    jacobian = splatDeform(position, height, windStrength, wave, wind.axis, mat2(wind.mode), instanceDeformation.zw, wind.branch);
    position += flutter;
  }
  covariance = jacobian * covariance;
  normal = splatDeformNormal(jacobian, normal);
  // Owner metres point east, north and up of the anchor, on deck.gl's globe as in planar views.
  vec3 anchor = project_position(instancePositions, instancePositions64Low);
  mat3 frame = splatTangentFrame(anchor);
  vec4 commonPosition = vec4(anchor + frame * project_size(position), 1.0);
  vec4 center = project_common_position_to_clipspace(commonPosition);
  geometry.position = commonPosition;
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vCoverageWeight = instanceCoverageWeight.x;
  vNormal = splatProjectNormal(normal, frame);
  geometry.normal = vNormal;
  // Reuse the perspective Jacobian for all three covariance axes.
  mat4 projectionMatrix = project.viewProjectionMatrix;
  vec2 viewportSize = project.viewportSize;
  vec3 rowW = vec3(projectionMatrix[0].w, projectionMatrix[1].w, projectionMatrix[2].w);
  vec3 axisX = frame * project_size(covariance[0]);
  vec3 axisY = frame * project_size(covariance[1]);
  vec3 axisZ = frame * project_size(covariance[2]);
  vec3 depthAxes = vec3(dot(rowW, axisX), dot(rowW, axisY), dot(rowW, axisZ));
  float depthSigma = length(depthAxes);
  // EWA is a local perspective approximation. Clamp its off-axis derivative like
  // the reference 3DGS rasterizer, and regularize depth when support crosses the eye.
  float safeW = max(max(center.w, depthSigma * splat.support * 0.5), 1e-8);
  vec2 ndc = clamp(center.xy / safeW, vec2(-1.3), vec2(1.3));
  vec3 rowX = (vec3(projectionMatrix[0].x, projectionMatrix[1].x, projectionMatrix[2].x) - rowW * ndc.x) * viewportSize.x / (2.0 * safeW);
  vec3 rowY = (vec3(projectionMatrix[0].y, projectionMatrix[1].y, projectionMatrix[2].y) - rowW * ndc.y) * viewportSize.y / (2.0 * safeW);
  vec3 rowNear = vec3(projectionMatrix[0].z, projectionMatrix[1].z, projectionMatrix[2].z) + rowW;
  float nearSigma = length(vec3(dot(rowNear, axisX), dot(rowNear, axisY), dot(rowNear, axisZ)));
  float clipWeight = smoothstep(0.0, max(nearSigma * splat.support, 1e-8), center.z + center.w);
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) {
    // The shadow map is an orthographic light view: its linear part projects the covariance.
    mat4 light = shadow.lightId == 0 ? shadow.viewProjectionMatrix0 : shadow.viewProjectionMatrix1;
    rowX = vec3(light[0].x, light[1].x, light[2].x) * viewportSize.x * 0.5;
    rowY = vec3(light[0].y, light[1].y, light[2].y) * viewportSize.y * 0.5;
    clipWeight = 1.0;
  }
#endif
  vCoverageWeight *= clipWeight;
  vec2 x = vec2(dot(rowX, axisX), dot(rowY, axisX));
  vec2 y = vec2(dot(rowX, axisY), dot(rowY, axisY));
  vec2 z = vec2(dot(rowX, axisZ), dot(rowY, axisZ));
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
  vColor = vec4(splatColors.rgb * instanceColors.rgb, splatColors.a * instanceColors.a * layer.opacity * compensation);
  gl_Position = center;
  gl_Position.xy += offset / viewportSize * 2.0 * center.w;
  // Weighted transparency resolves without the basemap's depth: the globe must hide its far side.
  if (center.w <= 0.0 || center.z < -center.w || vColor.a < splat.alphaCutoff || splatBehindGlobe(commonPosition.xyz)) gl_Position = vec4(2,2,2,1);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
#ifdef MODULE_SHADOW
  // The shadow filter moved the center into light clip space; expand the footprint there.
  if (shadow.drawShadowMap) {
    gl_Position.xy += offset / viewportSize * 2.0 * gl_Position.w;
    if (vColor.a < splat.alphaCutoff) gl_Position = vec4(2,2,2,1);
    splatShadowThreshold = splatShadowHash(splatCenters, instancePositions, instancePositions64Low);
  } else if (shadow.useShadowMap) {
    vec3 ownerOffset = frame * project_size(position - instanceTranslation);
    splatShadowDepth = vec2(shadow_vPosition[0].z + splatShadowReceiveOffset(shadow.viewProjectionMatrix0, frame * transform, ownerOffset), 0.0);
    // deck.gl leaves an unused light's matrix zero.
    if (shadow.lightCount > 1.0)
      splatShadowDepth.y = shadow_vPosition[1].z + splatShadowReceiveOffset(shadow.viewProjectionMatrix1, frame * transform, ownerOffset);
    // deck.gl's color filter would tint a translucent Gaussian as a shadow film laid over it; the
    // fragment shader tints it as a surface instead.
    shadow_vPosition[0].z = -1.0;
    shadow_vPosition[1].z = -1.0;
  }
#endif
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
#ifdef MODULE_SHADOW
flat in float splatShadowThreshold;
in vec2 splatShadowDepth;
// Light reaching a Gaussian does not depend on its own alpha: tint it like an opaque surface.
vec3 splatShadowReceive(vec3 color) {
  float weight = shadow_getShadowWeight(vec3(shadow_vPosition[0].xy, splatShadowDepth.x), shadow_uShadowMap0);
  if (shadow.lightCount > 1.0)
    weight += shadow_getShadowWeight(vec3(shadow_vPosition[1].xy, splatShadowDepth.y), shadow_uShadowMap1);
  return mix(color, shadow.color.rgb, weight * shadow.color.a / shadow.lightCount);
}
#endif
out vec4 fragColor;
void main() {
  float radiusSquared = dot(gaussianPosition, gaussianPosition);
  if (radiusSquared > splat.support * splat.support) discard;
  float coverage = vColor.a * exp(-0.5 * radiusSquared);
  float depth = splat.opticalDepthMode > 0.5 ? coverage * vCoverageWeight :
    -log(max(1.0 - coverage, 0.005)) * vCoverageWeight;
  float alpha = splat.opticalDepthMode < 0.5 && vCoverageWeight == 1.0 ? min(0.995, coverage) : min(0.995, 1.0 - exp(-depth));
  if (alpha < splat.alphaCutoff || (picking.isActive > 0.5 && alpha < 0.08)) discard;
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) {
    // Each Gaussian casts the opaque core where its alpha exceeds its own random threshold.
    if (alpha <= splatShadowThreshold) discard;
    fragColor = shadow_filterShadowColor(vec4(0.0));
    return;
  }
#endif
  geometry.uv = gaussianPosition;
  vec3 normal = normalize(vNormal);
  // Authored normals stay in the foliage frame, including at grazing camera angles.
  vec3 shaded = lighting_getLightColor(vColor.rgb, vCamera, vPosition, normal);
#ifdef MODULE_SHADOW
  if (shadow.useShadowMap) shaded = splatShadowReceive(shaded);
#endif
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
  '  opticalDepth = vec4(min(depth, 80.0), 0.0, 0.0, 0.0);\n  geometry.uv = gaussianPosition;'
);

// WebGPU cannot apply this blend state to MRT attachment 1. Its weighted path therefore
// renders optical depth separately into a single additive target.
export const SPLAT_TRANSMISSION_FRAGMENT = SPLAT_FRAGMENT.replace(
  /  geometry\.uv = gaussianPosition;[\s\S]*/,
  '  fragColor = vec4(min(depth, 80.0), 0.0, 0.0, 0.0);\n}'
);
