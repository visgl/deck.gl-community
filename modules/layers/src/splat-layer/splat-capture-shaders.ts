// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_CAPTURE_COLOR_RANGE} from './splat-capture';

const DECLARATION = `uniform splatCaptureUniforms {
  mat4 clipMatrix;
  vec3 cameraPosition;
  vec4 tint;
  float count;
  float shDegree;
  float shTexels;
  vec3 pickingColor;
  float kernelVariance;
  float alphaCutoff;
  float support;
  float antialiased;
} splatCapture;`;

export const splatCaptureUniforms = {
  name: 'splatCapture',
  vs: DECLARATION,
  fs: DECLARATION,
  uniformTypes: {
    clipMatrix: 'mat4x4<f32>',
    cameraPosition: 'vec3<f32>',
    tint: 'vec4<f32>',
    count: 'f32',
    shDegree: 'f32',
    shTexels: 'f32',
    pickingColor: 'vec3<f32>',
    kernelVariance: 'f32',
    alphaCutoff: 'f32',
    support: 'f32',
    antialiased: 'f32'
  }
} as const satisfies ShaderModule;

/** Quads per instance. One-quad instances leave most of a GPU vertex batch idle (ANGLE on Metal). */
export const SPLAT_CAPTURE_QUADS_PER_INSTANCE = 64;

/**
 * One quad per Gaussian of a packed capture, in the order the depth sort supplies, pulled from
 * textures by vertex and instance ID: no vertex attributes. The projection is the template path's
 * EWA approximation; colour is the capture's own, unlit.
 */
export const SPLAT_CAPTURE_VERTEX = `#version 300 es
#define SHADER_NAME splat-capture-vertex
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D splatData;
uniform usampler2D splatOrder;
uniform usampler2D splatHarmonics;
out vec2 gaussianPosition;
out vec4 vColor;

uvec4 shTexel[3];
// coefficient j's RGB, from SPZ bytes meaning (byte - 128) / 128
vec3 shCoefficient(int j) {
  vec3 value;
  for (int c = 0; c < 3; c++) {
    int b = j * 3 + c;
    uint word = shTexel[b >> 4][(b >> 2) & 3];
    value[c] = (float((word >> uint((b & 3) * 8)) & 0xffu) - 128.0) / 128.0;
  }
  return value;
}
// The 3DGS rasterizer's real spherical-harmonic basis above DC, toward unit direction d.
vec3 shColor(int index, vec3 d) {
  int texels = int(splatCapture.shTexels);
  int width = textureSize(splatHarmonics, 0).x;
  for (int t = 0; t < 3; t++) {
    int i = index * texels + min(t, texels - 1);
    shTexel[t] = texelFetch(splatHarmonics, ivec2(i % width, i / width), 0);
  }
  float x = d.x, y = d.y, z = d.z;
  vec3 color = 0.4886025119029199 * (-y * shCoefficient(0) + z * shCoefficient(1) - x * shCoefficient(2));
  if (splatCapture.shDegree < 1.5) return color;
  float xx = x * x, yy = y * y, zz = z * z, xy = x * y, yz = y * z, xz = x * z;
  color += 1.0925484305920792 * xy * shCoefficient(3) - 1.0925484305920792 * yz * shCoefficient(4) +
    0.31539156525252005 * (2.0 * zz - xx - yy) * shCoefficient(5) - 1.0925484305920792 * xz * shCoefficient(6) +
    0.5462742152515649 * (xx - yy) * shCoefficient(7);
  if (splatCapture.shDegree < 2.5) return color;
  return color - 0.5900435899266435 * y * (3.0 * xx - yy) * shCoefficient(8) +
    2.890611442640554 * xy * z * shCoefficient(9) - 0.4570457994644658 * y * (4.0 * zz - xx - yy) * shCoefficient(10) +
    0.3731763325901154 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shCoefficient(11) -
    0.4570457994644658 * x * (4.0 * zz - xx - yy) * shCoefficient(12) +
    1.445305721320277 * z * (xx - yy) * shCoefficient(13) - 0.5900435899266435 * x * (xx - 3.0 * yy) * shCoefficient(14);
}

void main() {
  // the static index buffer numbers each instance's quads 0..N-1, four corners each
  int quad = gl_VertexID >> 2;
  int corner = gl_VertexID & 3;
  int slot = gl_InstanceID * ${SPLAT_CAPTURE_QUADS_PER_INSTANCE} + quad;
  if (float(slot) >= splatCapture.count) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 positions = vec2(float(corner & 1), float(corner >> 1)) * 2.0 - 1.0;
  int orderWidth = textureSize(splatOrder, 0).x;
  uint index = texelFetch(splatOrder, ivec2(slot % orderWidth, slot / orderWidth), 0).x;
  int texel = int(index) * 2;
  int width = textureSize(splatData, 0).x;
  ivec2 cell = ivec2(texel % width, texel / width);
  uvec4 centerTexel = texelFetch(splatData, cell, 0);
  uvec4 shapeTexel = texelFetch(splatData, cell + ivec2(1, 0), 0);
  vec3 local = uintBitsToFloat(centerTexel.xyz);
  uint rgba = centerTexel.w;
  vec4 color = vec4(uvec4(rgba, rgba >> 8u, rgba >> 16u, rgba >> 24u) & 0xffu) / 255.0;
  color.rgb = ${SPLAT_CAPTURE_COLOR_RANGE[0].toFixed(1)} + color.rgb * ${(SPLAT_CAPTURE_COLOR_RANGE[1] - SPLAT_CAPTURE_COLOR_RANGE[0]).toFixed(1)};
  // view-dependent colour, toward the camera in the capture's own frame; then clamped like 3DGS
  if (splatCapture.shDegree > 0.5)
    color.rgb += shColor(int(index), normalize(local - splatCapture.cameraPosition));
  color.rgb = max(color.rgb, 0.0);
  vec2 scaleXY = unpackHalf2x16(shapeTexel.x);
  vec2 scaleZRotationW = unpackHalf2x16(shapeTexel.y);
  vec2 rotationXY = unpackHalf2x16(shapeTexel.z);
  vec4 q = normalize(vec4(scaleZRotationW.y, rotationXY, unpackHalf2x16(shapeTexel.w).x));
  float w = q.x, x = q.y, y = q.z, z = q.w;
  // rotation times the one-sigma scale: the covariance square root
  mat3 axes = mat3(
    vec3(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + w * z), 2.0 * (x * z - w * y)) * scaleXY.x,
    vec3(2.0 * (x * y - w * z), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + w * x)) * scaleXY.y,
    vec3(2.0 * (x * z + w * y), 2.0 * (y * z - w * x), 1.0 - 2.0 * (x * x + y * y)) * scaleZRotationW.x);

  geometry.pickingColor = splatCapture.pickingColor;
  // One affine map takes the capture's metres to clip space: the layer composes the anchor, its
  // east-north-up frame, the pose and the view in double precision once per draw.
  mat4 projectionMatrix = splatCapture.clipMatrix;
  vec4 center = projectionMatrix * vec4(local, 1.0);
  geometry.position = vec4(local, 1.0);
  vec2 viewportSize = project.viewportSize;
  vec3 rowW = vec3(projectionMatrix[0].w, projectionMatrix[1].w, projectionMatrix[2].w);
  float depthSigma = length(vec3(dot(rowW, axes[0]), dot(rowW, axes[1]), dot(rowW, axes[2])));
  // EWA is a local perspective approximation: clamp its off-axis derivative like the reference
  // 3DGS rasterizer, and regularize depth when the support crosses the eye.
  float safeW = max(max(center.w, depthSigma * splatCapture.support * 0.5), 1e-8);
  vec2 ndc = clamp(center.xy / safeW, vec2(-1.3), vec2(1.3));
  vec3 rowX = (vec3(projectionMatrix[0].x, projectionMatrix[1].x, projectionMatrix[2].x) - rowW * ndc.x) * viewportSize.x / (2.0 * safeW);
  vec3 rowY = (vec3(projectionMatrix[0].y, projectionMatrix[1].y, projectionMatrix[2].y) - rowW * ndc.y) * viewportSize.y / (2.0 * safeW);
  vec3 rowNear = vec3(projectionMatrix[0].z, projectionMatrix[1].z, projectionMatrix[2].z) + rowW;
  float nearSigma = length(vec3(dot(rowNear, axes[0]), dot(rowNear, axes[1]), dot(rowNear, axes[2])));
  float clipWeight = smoothstep(0.0, max(nearSigma * splatCapture.support, 1e-8), center.z + center.w);
  vec2 ax = vec2(dot(rowX, axes[0]), dot(rowY, axes[0]));
  vec2 ay = vec2(dot(rowX, axes[1]), dot(rowY, axes[1]));
  vec2 az = vec2(dot(rowX, axes[2]), dot(rowY, axes[2]));
  float a = ax.x * ax.x + ay.x * ay.x + az.x * az.x;
  float b = ax.x * ax.y + ay.x * ay.y + az.x * az.y;
  float c = ax.y * ax.y + ay.y * ay.y + az.y * az.y;
  float determinant = max(a * c - b * b, 0.0);
  a += splatCapture.kernelVariance;
  c += splatCapture.kernelVariance;
  float filteredDeterminant = max(a * c - b * b, 1e-12);
  // Classic 3DGS dilates without compensation; Mip-Splatting's filter keeps the integrated opacity.
  float compensation = splatCapture.antialiased > 0.5 ? sqrt(determinant / filteredDeterminant) : 1.0;
  float opacity = color.a * splatCapture.tint.a * layer.opacity * compensation * clipWeight;
  // Fragments beyond this Mahalanobis radius fall under the cutoff, so the quad stops there.
  float extent = min(splatCapture.support, sqrt(max(2.0 * log(opacity / splatCapture.alphaCutoff), 0.0)));
  float middle = 0.5 * (a + c);
  float spread = sqrt(max(0.25 * (a - c) * (a - c) + b * b, 0.0));
  float major = max(middle + spread, 1e-8);
  float minor = max(middle - spread, 1e-8);
  vec2 direction = abs(b) > 1e-8 ? normalize(vec2(b, major - a)) : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 offset = (direction * sqrt(major) * positions.x + vec2(-direction.y, direction.x) * sqrt(minor) * positions.y) * extent;
  gaussianPosition = positions * extent;
  vColor = vec4(color.rgb * splatCapture.tint.rgb, opacity);
  gl_Position = center;
  gl_Position.xy += offset / viewportSize * 2.0 * center.w;
  if (center.w <= 0.0 || center.z < -center.w || extent <= 0.0)
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  DECKGL_FILTER_COLOR(vColor, geometry);
}`;

/** Premultiplied, so back-to-front "over" blending composites the sorted Gaussians exactly. */
export const SPLAT_CAPTURE_FRAGMENT = `#version 300 es
#define SHADER_NAME splat-capture-fragment
precision highp float;
in vec2 gaussianPosition;
in vec4 vColor;
out vec4 fragColor;
void main() {
  // the 3DGS rasterizer's cap and cutoff
  float alpha = min(0.999, vColor.a * exp(-0.5 * dot(gaussianPosition, gaussianPosition)));
  if (alpha < splatCapture.alphaCutoff || (picking.isActive > 0.5 && alpha < 0.08)) discard;
  vec4 color = vec4(vColor.rgb, alpha);
  geometry.uv = gaussianPosition;
  DECKGL_FILTER_COLOR(color, geometry);
  // the picking filter has replaced color with the owner's picking color
  fragColor = picking.isActive > 0.5 ? color : vec4(color.rgb * color.a, color.a);
}`;
