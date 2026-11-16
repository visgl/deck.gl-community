// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';
import type {Matrix4} from '@math.gl/core';

type SkyUniforms = {
  clipToLocal: Matrix4;
  sunDirection: readonly [number, number, number];
  aerosolOpticalDepth: number;
  exposure: number;
  opacity: number;
};

const SKY_UNIFORMS = /* glsl */ `
layout(std140) uniform skyUniforms {
  mat4 clipToLocal;
  vec3 sunDirection;
  float aerosolOpticalDepth;
  float exposure;
  float opacity;
} sky;
`;

export const skyUniforms = {
  name: 'sky',
  vs: SKY_UNIFORMS,
  fs: SKY_UNIFORMS,
  source: /* wgsl */ `
struct SkyUniforms {
  clipToLocal: mat4x4<f32>,
  sunDirection: vec3<f32>,
  aerosolOpticalDepth: f32,
  exposure: f32,
  opacity: f32,
};
@group(0) @binding(auto) var<uniform> sky: SkyUniforms;
`,
  uniformTypes: {
    clipToLocal: 'mat4x4<f32>',
    sunDirection: 'vec3<f32>',
    aerosolOpticalDepth: 'f32',
    exposure: 'f32',
    opacity: 'f32'
  }
} as const satisfies ShaderModule<SkyUniforms>;

// Single scattering with exponential Rayleigh and aerosol density profiles, plus ozone.
// Integrate smooth optical depth on a coarse grid and evaluate the solar phase per pixel.
const ATMOSPHERE_GLSL = /* glsl */ `
const float PLANET_RADIUS = 6371000.0;
const float ATMOSPHERE_RADIUS = 6471000.0;
const float RAYLEIGH_HEIGHT = 8000.0;
const float AEROSOL_HEIGHT = 1500.0;
const vec3 RAYLEIGH = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 OZONE = vec3(0.65e-6, 1.881e-6, 0.085e-6);
const vec3 AEROSOL_TINT = vec3(0.78, 1.0, 1.3);
const float SOLAR_RADIUS = 0.00465;
const float SOLAR_STRENGTH = 15.0;

// Bruneton's analytic optical depth from radius r along a ray of zenith cosine mu.
float airPath(float height, float r, float mu) {
  float a = sqrt(0.5 / height * r) * mu;
  float a2 = a * a;
  float y = (a < 0.0 ? -1.0 : 1.0) / (2.3193 * abs(a) + sqrt(1.52 * a2 + 4.0));
  float x = a < 0.0 ? exp(min(a2, 40.0)) : 0.0;
  return sqrt(6.283185 * height * r) * exp((PLANET_RADIUS - r) / height) * (x + y);
}

vec3 transmission(float r, float mu) {
  float horizon = -sqrt(max((r - PLANET_RADIUS) * (r + PLANET_RADIUS), 0.0)) / r;
  float clear = smoothstep(horizon - SOLAR_RADIUS, horizon + SOLAR_RADIUS, mu);
  if (clear <= 0.0) return vec3(0.0);
  float rayleigh = airPath(RAYLEIGH_HEIGHT, r, mu);
  float aerosol = airPath(AEROSOL_HEIGHT, r, mu);
  float airMass = rayleigh * exp((r - PLANET_RADIUS) / RAYLEIGH_HEIGHT) / RAYLEIGH_HEIGHT;
  vec3 depth = RAYLEIGH * rayleigh +
    AEROSOL_TINT * (sky.aerosolOpticalDepth / AEROSOL_HEIGHT) * 1.08 * aerosol +
    OZONE * 15000.0 * airMass;
  return exp(-depth) * clear;
}
`;

export const SKY_VS = /* glsl */ `#version 300 es
precision highp float;
in vec2 positions;
out vec3 vDirection;
out vec3 vRayleigh;
out vec3 vAerosol;
out vec3 vAmbient;
${ATMOSPHERE_GLSL}

void main() {
  gl_Position = vec4(positions, 1.0, 1.0);
  vec4 nearPoint = sky.clipToLocal * vec4(positions, -1.0, 1.0);
  vec4 farPoint = sky.clipToLocal * vec4(positions, 1.0, 1.0);
  vDirection = farPoint.xyz * nearPoint.w - nearPoint.xyz * farPoint.w;
  vec3 direction = normalize(vDirection);
  float mu = max(direction.z, 0.001);
  vec2 across = direction.xy / max(length(direction.xy), 1e-6);
  vec3 ray = vec3(across * sqrt(1.0 - mu * mu), mu);
  float cosine = dot(ray, sky.sunDirection);
  vec3 aerosolBeta = AEROSOL_TINT * sky.aerosolOpticalDepth / AEROSOL_HEIGHT;

  float r0 = PLANET_RADIUS + 2.0;
  float reach = sqrt((ATMOSPHERE_RADIUS - r0) * (ATMOSPHERE_RADIUS + r0) + r0 * r0 * mu * mu) - r0 * mu;
  vRayleigh = vec3(0.0);
  vAerosol = vec3(0.0);
  vAmbient = vec3(0.0);
  vec3 through = vec3(1.0);
  vec3 ambient = vec3(0.62, 0.76, 1.0) * 0.42 * smoothstep(-0.21, 0.14, sky.sunDirection.z);
  float last = 0.0;
  for (int i = 0; i < 8; i++) {
    float fraction = float(i + 1) / 8.0;
    float next = reach * fraction * fraction;
    float t = 0.5 * (last + next);
    float interval = next - last;
    last = next;
    float r = sqrt(r0 * r0 + 2.0 * r0 * mu * t + t * t);
    float height = r - PLANET_RADIUS;
    vec3 rayleighHere = RAYLEIGH * exp(-height / RAYLEIGH_HEIGHT);
    vec3 aerosolHere = aerosolBeta * exp(-height / AEROSOL_HEIGHT);
    float ozone = max(1.0 - abs(height - 25000.0) / 15000.0, 0.0);
    vec3 extinction = rayleighHere + 1.08 * aerosolHere + OZONE * ozone;
    vec3 sunlight = transmission(r, (r0 * sky.sunDirection.z + t * cosine) / r) * SOLAR_STRENGTH;
    vec3 fade = exp(-extinction * interval);
    vec3 share = through * (1.0 - fade) / max(extinction, vec3(1e-9));
    vRayleigh += share * rayleighHere * sunlight;
    vAerosol += share * aerosolHere * sunlight;
    vAmbient += share * (rayleighHere + aerosolHere) * ambient;
    through *= fade;
  }
}
`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vDirection;
in vec3 vRayleigh;
in vec3 vAerosol;
in vec3 vAmbient;
out vec4 fragColor;
${ATMOSPHERE_GLSL}

void main() {
  vec3 ray = normalize(vDirection);
  float cosine = clamp(dot(ray, sky.sunDirection), -1.0, 1.0);
  float cosine2 = cosine * cosine;
  const float g = 0.76;
  const float g2 = g * g;
  float rayleigh = 0.0596831 * (1.0 + cosine2);
  float mie = 0.1193662 * (1.0 - g2) * (1.0 + cosine2) /
    ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * cosine, 1e-5), 1.5));
  vec3 light = vRayleigh * rayleigh + vAerosol * mie * 0.3 + vAmbient;
  float edge = max(0.5 * (length(dFdx(ray)) + length(dFdy(ray))), 0.0006);
  if (cosine > 0.9) {
    float angle = acos(cosine);
    float disc = 1.0 - smoothstep(SOLAR_RADIUS - edge, SOLAR_RADIUS + edge, angle);
    float radius = angle / SOLAR_RADIUS;
    float limb = 0.42 + 0.58 * sqrt(max(1.0 - radius * radius, 0.0));
    float glow = 0.9 * exp(-angle / 0.012) + 0.1 * exp(-angle / 0.05);
    light += transmission(PLANET_RADIUS + 2.0, sky.sunDirection.z) * (disc * limb * 260.0 + glow * 6.0);
  }
  vec3 linear = max(light * sky.exposure * smoothstep(-0.18, 0.0, ray.z), vec3(0.0));
  // Display mapping keeps the sun bright without clipping the sky gradient.
  vec3 display = clamp(linear * (2.51 * linear + 0.03) / (linear * (2.43 * linear + 0.59) + 0.14), 0.0, 1.0);
  fragColor = vec4(pow(display, vec3(1.0 / 2.2)), sky.opacity);
}
`;

export const SKY_WGSL = /* wgsl */ `
const PLANET_RADIUS = 6371000.0;
const ATMOSPHERE_RADIUS = 6471000.0;
const RAYLEIGH_HEIGHT = 8000.0;
const AEROSOL_HEIGHT = 1500.0;
const RAYLEIGH = vec3<f32>(5.802e-6, 13.558e-6, 33.1e-6);
const OZONE = vec3<f32>(0.65e-6, 1.881e-6, 0.085e-6);
const AEROSOL_TINT = vec3<f32>(0.78, 1.0, 1.3);
const SOLAR_RADIUS = 0.00465;
const SOLAR_STRENGTH = 15.0;

fn airPath(height: f32, r: f32, mu: f32) -> f32 {
  let a = sqrt(0.5 / height * r) * mu;
  let a2 = a * a;
  let y = select(1.0, -1.0, a < 0.0) / (2.3193 * abs(a) + sqrt(1.52 * a2 + 4.0));
  let x = select(0.0, exp(min(a2, 40.0)), a < 0.0);
  return sqrt(6.283185 * height * r) * exp((PLANET_RADIUS - r) / height) * (x + y);
}

fn transmission(r: f32, mu: f32) -> vec3<f32> {
  let horizon = -sqrt(max((r - PLANET_RADIUS) * (r + PLANET_RADIUS), 0.0)) / r;
  let clear = smoothstep(horizon - SOLAR_RADIUS, horizon + SOLAR_RADIUS, mu);
  if (clear <= 0.0) { return vec3<f32>(0.0); }
  let rayleigh = airPath(RAYLEIGH_HEIGHT, r, mu);
  let aerosol = airPath(AEROSOL_HEIGHT, r, mu);
  let airMass = rayleigh * exp((r - PLANET_RADIUS) / RAYLEIGH_HEIGHT) / RAYLEIGH_HEIGHT;
  let depth = RAYLEIGH * rayleigh +
    AEROSOL_TINT * (sky.aerosolOpticalDepth / AEROSOL_HEIGHT) * 1.08 * aerosol +
    OZONE * 15000.0 * airMass;
  return exp(-depth) * clear;
}

struct VertexInputs {
  @location(0) positions: vec2<f32>,
};
struct VertexOutputs {
  @builtin(position) position: vec4<f32>,
  @location(0) direction: vec3<f32>,
  @location(1) rayleigh: vec3<f32>,
  @location(2) aerosol: vec3<f32>,
  @location(3) ambient: vec3<f32>,
};

@vertex fn vertexMain(input: VertexInputs) -> VertexOutputs {
  var out: VertexOutputs;
  let positions = input.positions;
  out.position = vec4<f32>(positions, 1.0, 1.0);
  let nearPoint = sky.clipToLocal * vec4<f32>(positions, -1.0, 1.0);
  let farPoint = sky.clipToLocal * vec4<f32>(positions, 1.0, 1.0);
  out.direction = farPoint.xyz * nearPoint.w - nearPoint.xyz * farPoint.w;
  let direction = normalize(out.direction);
  let mu = max(direction.z, 0.001);
  let across = direction.xy / max(length(direction.xy), 1e-6);
  let ray = vec3<f32>(across * sqrt(1.0 - mu * mu), mu);
  let cosine = dot(ray, sky.sunDirection);
  let aerosolBeta = AEROSOL_TINT * sky.aerosolOpticalDepth / AEROSOL_HEIGHT;

  let r0 = PLANET_RADIUS + 2.0;
  let reach = sqrt((ATMOSPHERE_RADIUS - r0) * (ATMOSPHERE_RADIUS + r0) + r0 * r0 * mu * mu) - r0 * mu;
  out.rayleigh = vec3<f32>(0.0);
  out.aerosol = vec3<f32>(0.0);
  out.ambient = vec3<f32>(0.0);
  var through = vec3<f32>(1.0);
  let ambient = vec3<f32>(0.62, 0.76, 1.0) * 0.42 * smoothstep(-0.21, 0.14, sky.sunDirection.z);
  var last = 0.0;
  for (var i = 0; i < 8; i++) {
    let fraction = f32(i + 1) / 8.0;
    let next = reach * fraction * fraction;
    let t = 0.5 * (last + next);
    let interval = next - last;
    last = next;
    let r = sqrt(r0 * r0 + 2.0 * r0 * mu * t + t * t);
    let height = r - PLANET_RADIUS;
    let rayleighHere = RAYLEIGH * exp(-height / RAYLEIGH_HEIGHT);
    let aerosolHere = aerosolBeta * exp(-height / AEROSOL_HEIGHT);
    let ozone = max(1.0 - abs(height - 25000.0) / 15000.0, 0.0);
    let extinction = rayleighHere + 1.08 * aerosolHere + OZONE * ozone;
    let sunlight = transmission(r, (r0 * sky.sunDirection.z + t * cosine) / r) * SOLAR_STRENGTH;
    let fade = exp(-extinction * interval);
    let share = through * (vec3<f32>(1.0) - fade) / max(extinction, vec3<f32>(1e-9));
    out.rayleigh += share * rayleighHere * sunlight;
    out.aerosol += share * aerosolHere * sunlight;
    out.ambient += share * (rayleighHere + aerosolHere) * ambient;
    through *= fade;
  }
  return out;
}

@fragment fn fragmentMain(input: VertexOutputs) -> @location(0) vec4<f32> {
  let ray = normalize(input.direction);
  let cosine = clamp(dot(ray, sky.sunDirection), -1.0, 1.0);
  let cosine2 = cosine * cosine;
  let g = 0.76;
  let g2 = g * g;
  let rayleigh = 0.0596831 * (1.0 + cosine2);
  let mie = 0.1193662 * (1.0 - g2) * (1.0 + cosine2) /
    ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * cosine, 1e-5), 1.5));
  var light = input.rayleigh * rayleigh + input.aerosol * mie * 0.3 + input.ambient;
  let edge = max(0.5 * (length(dpdx(ray)) + length(dpdy(ray))), 0.0006);
  if (cosine > 0.9) {
    let angle = acos(cosine);
    let disc = 1.0 - smoothstep(SOLAR_RADIUS - edge, SOLAR_RADIUS + edge, angle);
    let radius = angle / SOLAR_RADIUS;
    let limb = 0.42 + 0.58 * sqrt(max(1.0 - radius * radius, 0.0));
    let glow = 0.9 * exp(-angle / 0.012) + 0.1 * exp(-angle / 0.05);
    light += transmission(PLANET_RADIUS + 2.0, sky.sunDirection.z) * (disc * limb * 260.0 + glow * 6.0);
  }
  let linear = max(light * sky.exposure * smoothstep(-0.18, 0.0, ray.z), vec3<f32>(0.0));
  let display = clamp(linear * (2.51 * linear + vec3<f32>(0.03)) /
    (linear * (2.43 * linear + vec3<f32>(0.59)) + vec3<f32>(0.14)), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(pow(display, vec3<f32>(1.0 / 2.2)) * sky.opacity, sky.opacity);
}
`;
