// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

const RAIN_UNIFORMS_GLSL = /* glsl */ `
layout(std140) uniform rainUniforms {
  vec3 center;
  vec3 center64Low;
  vec3 size;
  vec3 phase;
  vec3 halfStreak;
  float streakWidth;
  vec4 color;
  highp uint seed;
} rain;
`;

export const rainUniforms = {
  name: 'rain',
  vs: RAIN_UNIFORMS_GLSL,
  fs: RAIN_UNIFORMS_GLSL,
  source: /* wgsl */ `
struct RainUniforms {
  center: vec3<f32>,
  center64Low: vec3<f32>,
  size: vec3<f32>,
  phase: vec3<f32>,
  halfStreak: vec3<f32>,
  streakWidth: f32,
  color: vec4<f32>,
  seed: u32,
};
@group(0) @binding(auto) var<uniform> rain: RainUniforms;
`,
  uniformTypes: {
    center: 'vec3<f32>',
    center64Low: 'vec3<f32>',
    size: 'vec3<f32>',
    phase: 'vec3<f32>',
    halfStreak: 'vec3<f32>',
    streakWidth: 'f32',
    color: 'vec4<f32>',
    seed: 'u32'
  }
} as const satisfies ShaderModule;

export const RAIN_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

out vec2 vUV;
out float vFade;

float rainRandom(uint value) {
  uint state = value * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return float(((word >> 22u) ^ word) >> 8u) / 16777216.0;
}

void main() {
  geometry.worldPosition = rain.center;
  uint index = uint(gl_InstanceID) * 3u + rain.seed;
  vec3 initial = vec3(rainRandom(index), rainRandom(index + 1u), rainRandom(index + 2u));
  vec3 local = fract(initial + rain.phase) - 0.5;
  vec3 edge = 0.5 - abs(local);
  vFade = smoothstep(0.0, 0.08, min(edge.x, min(edge.y, edge.z)));
  vUV = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;

  vec3 offset = local * rain.size;
  vec4 start = project_position_to_clipspace(
    rain.center, rain.center64Low, project_size(offset - rain.halfStreak));
  vec4 end = project_position_to_clipspace(
    rain.center, rain.center64Low, project_size(offset + rain.halfStreak));

  // Clip the segment before dividing by w. A drop can cross the camera's near plane.
  float nearStart = start.z + start.w;
  float nearEnd = end.z + end.w;
  if (nearStart < 0.0 && nearEnd < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (nearStart < 0.0) {
    start = mix(start, end, nearStart / (nearStart - nearEnd));
  } else if (nearEnd < 0.0) {
    end = mix(end, start, nearEnd / (nearEnd - nearStart));
  }

  vec2 halfViewport = project.viewportSize * 0.5;
  vec2 delta = (end.xy / end.w - start.xy / start.w) * halfViewport;
  float lengthPixels = length(delta);
  vec2 axis = lengthPixels > 0.0001 ? delta / lengthPixels : vec2(0.0, 1.0);
  vec2 normal = vec2(-axis.y, axis.x);
  vec2 expansion = (normal * vUV.x + axis * vUV.y) *
    (rain.streakWidth * 0.5 * project.devicePixelRatio) / halfViewport;
  vec4 point = vUV.y < 0.0 ? start : end;
  gl_Position = vec4(point.xy + expansion * point.w, point.zw);
}
`;

export const RAIN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2 vUV;
in float vFade;
out vec4 fragColor;

void main() {
  float profile = exp(-vUV.x * vUV.x * 3.2) * (1.0 - smoothstep(0.65, 1.0, abs(vUV.y)));
  float alpha = rain.color.a * layer.opacity * profile * vFade;
  fragColor = vec4(rain.color.rgb * alpha, alpha);
}
`;

export const RAIN_WGSL = /* wgsl */ `
struct RainVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fade: f32,
};

fn rainRandom(value: u32) -> f32 {
  let state = value * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return f32(((word >> 22u) ^ word) >> 8u) / 16777216.0;
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32,
) -> RainVaryings {
  geometry.worldPosition = rain.center;
  let index = instance * 3u + rain.seed;
  let initial = vec3<f32>(rainRandom(index), rainRandom(index + 1u), rainRandom(index + 2u));
  let local = fract(initial + rain.phase) - 0.5;
  let edge = 0.5 - abs(local);
  var output: RainVaryings;
  output.fade = smoothstep(0.0, 0.08, min(edge.x, min(edge.y, edge.z)));
  output.uv = vec2<f32>(f32(vertex & 1u), f32(vertex >> 1u)) * 2.0 - 1.0;

  let offset = local * rain.size;
  var start = project_position_to_clipspace(
    rain.center, rain.center64Low, project_size_vec3(offset - rain.halfStreak));
  var end = project_position_to_clipspace(
    rain.center, rain.center64Low, project_size_vec3(offset + rain.halfStreak));

  // The WebGPU projection uses [0, w] for clip-space depth.
  let nearStart = start.z;
  let nearEnd = end.z;
  if (nearStart < 0.0 && nearEnd < 0.0) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    return output;
  }
  if (nearStart < 0.0) {
    start = mix(start, end, nearStart / (nearStart - nearEnd));
  } else if (nearEnd < 0.0) {
    end = mix(end, start, nearEnd / (nearEnd - nearStart));
  }

  let halfViewport = project.viewportSize * 0.5;
  let delta = (end.xy / end.w - start.xy / start.w) * halfViewport;
  let lengthPixels = length(delta);
  var axis = vec2<f32>(0.0, 1.0);
  if (lengthPixels > 0.0001) {
    axis = delta / lengthPixels;
  }
  let normal = vec2<f32>(-axis.y, axis.x);
  let expansion = (normal * output.uv.x + axis * output.uv.y) *
    (rain.streakWidth * 0.5 * project.devicePixelRatio) / halfViewport;
  let point = select(start, end, output.uv.y > 0.0);
  output.position = vec4<f32>(point.xy + expansion * point.w, point.zw);
  return output;
}

@fragment
fn fragmentMain(input: RainVaryings) -> @location(0) vec4<f32> {
  let profile = exp(-input.uv.x * input.uv.x * 3.2) *
    (1.0 - smoothstep(0.65, 1.0, abs(input.uv.y)));
  let alpha = rain.color.a * layer.opacity * profile * input.fade;
  return vec4<f32>(rain.color.rgb * alpha, alpha);
}
`;
