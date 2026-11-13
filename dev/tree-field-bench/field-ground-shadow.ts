// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const FIELD_SHADOW_OPACITY = 0.42;
const CONTACT_FILTER_METRES = 0.068;
const CONTACT_BIAS_METRES = 0.064;
const FULL_SHADOW_DEPTH_METRES = 0.64;

export const FIELD_GROUND_SHADOW_GLSL = /* glsl */ `
float fieldShadowCompare(sampler2D map, ivec2 texel, float receiverDepth, float depthRange) {
  float casterDepth = dot(texelFetch(map, texel, 0), bitUnpackShift);
  return smoothstep(${CONTACT_BIAS_METRES}, ${FULL_SHADOW_DEPTH_METRES}, (receiverDepth - casterDepth) * depthRange);
}

float fieldShadowFilter(sampler2D map, vec2 at, ivec2 size, float receiverDepth, float depthRange) {
  // The depth range is twice the span along the shorter map axis. Use a wider,
  // world-scale footprint only when the inspection map has very small texels.
  float radius = clamp(${2 * CONTACT_FILTER_METRES} * float(min(size.x, size.y)) / depthRange, 1.0, 2.0);
  if (radius <= 1.0) {
    ivec2 corner = ivec2(floor(at));
    ivec2 lo = clamp(corner, ivec2(0), size - 1);
    ivec2 hi = clamp(corner + 1, ivec2(0), size - 1);
    float a = fieldShadowCompare(map, lo, receiverDepth, depthRange);
    float b = fieldShadowCompare(map, ivec2(hi.x, lo.y), receiverDepth, depthRange);
    float c = fieldShadowCompare(map, ivec2(lo.x, hi.y), receiverDepth, depthRange);
    float d = fieldShadowCompare(map, hi, receiverDepth, depthRange);
    vec2 f = fract(at);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // At the finest map scale, widen the footprint and flatten the weight at
  // its center. At radius 1.5 this has exactly the narrower tent's support
  // and weights. At radius 2 it has four taps per axis and a constant sum.
  if (radius > 1.5) {
    ivec2 corner = ivec2(floor(at));
    vec2 f = fract(at);
    const vec4 taps = vec4(-1.0, 0.0, 1.0, 2.0);
    float peak = 3.0 - radius;
    vec4 xWeight = clamp(vec4(radius) - abs(taps - f.x), 0.0, peak);
    vec4 yWeight = clamp(vec4(radius) - abs(taps - f.y), 0.0, peak);
    float sum = 0.0;
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        ivec2 texel = clamp(corner + ivec2(x - 1, y - 1), ivec2(0), size - 1);
        sum += xWeight[x] * yWeight[y] * fieldShadowCompare(map, texel, receiverDepth, depthRange);
      }
    }
    return sum / (dot(xWeight, vec4(1.0)) * dot(yWeight, vec4(1.0)));
  }

  // A centered tent is continuous as the nearest texel changes. At radius 1
  // it is exactly bilinear, so both paths agree at the boundary.
  ivec2 center = ivec2(floor(at + 0.5));
  vec2 offset = at - vec2(center);
  const vec3 taps = vec3(-1.0, 0.0, 1.0);
  vec3 xWeight = max(vec3(0.0), radius - abs(taps - offset.x));
  vec3 yWeight = max(vec3(0.0), radius - abs(taps - offset.y));
  float sum = 0.0;
  for (int y = 0; y < 3; y++) {
    for (int x = 0; x < 3; x++) {
      ivec2 texel = clamp(center + ivec2(x - 1, y - 1), ivec2(0), size - 1);
      sum += xWeight[x] * yWeight[y] * fieldShadowCompare(map, texel, receiverDepth, depthRange);
    }
  }
  return sum / (dot(xWeight, vec3(1.0)) * dot(yWeight, vec3(1.0)));
}

float shadow_getShadowWeight(vec3 position, sampler2D shadowMap, float depthRange) {
  vec3 edge = min(position, vec3(1.0) - position);
  if (min(min(edge.x, edge.y), edge.z) <= 0.0) return 0.0;
  ivec2 size = textureSize(shadowMap, 0);
  vec2 at = position.xy * vec2(size) - 0.5;
  float border = smoothstep(0.0, 0.04, min(edge.x, edge.y));
  return border * fieldShadowFilter(shadowMap, at, size, position.z, depthRange);
}`;

export const FIELD_GROUND_SHADOW_WGSL = /* wgsl */ `
fn fieldShadowCompare(map: texture_2d<f32>, texel: vec2<i32>, receiverDepth: f32, depthRange: f32) -> f32 {
  let casterDepth = dot(textureLoad(map, texel, 0), 1.0 / TREE_DEPTH_SCALE);
  return smoothstep(${CONTACT_BIAS_METRES}, ${FULL_SHADOW_DEPTH_METRES}, (receiverDepth - casterDepth) * depthRange);
}

fn fieldShadowFilter(map: texture_2d<f32>, at: vec2<f32>, size: vec2<i32>, receiverDepth: f32, depthRange: f32) -> f32 {
  let radius = clamp(${2 * CONTACT_FILTER_METRES} * f32(min(size.x, size.y)) / depthRange, 1.0, 2.0);
  if (radius <= 1.0) {
    let corner = vec2<i32>(floor(at));
    let lo = clamp(corner, vec2<i32>(0), size - 1);
    let hi = clamp(corner + 1, vec2<i32>(0), size - 1);
    let a = fieldShadowCompare(map, lo, receiverDepth, depthRange);
    let b = fieldShadowCompare(map, vec2<i32>(hi.x, lo.y), receiverDepth, depthRange);
    let c = fieldShadowCompare(map, vec2<i32>(lo.x, hi.y), receiverDepth, depthRange);
    let d = fieldShadowCompare(map, hi, receiverDepth, depthRange);
    let f = fract(at);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  if (radius > 1.5) {
    let corner = vec2<i32>(floor(at));
    let f = fract(at);
    let taps = vec4<f32>(-1.0, 0.0, 1.0, 2.0);
    let peak = vec4<f32>(3.0 - radius);
    let xWeight = clamp(vec4<f32>(radius) - abs(taps - f.x), vec4<f32>(0.0), peak);
    let yWeight = clamp(vec4<f32>(radius) - abs(taps - f.y), vec4<f32>(0.0), peak);
    var sum = 0.0;
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        let texel = clamp(corner + vec2<i32>(x - 1, y - 1), vec2<i32>(0), size - 1);
        sum += xWeight[x] * yWeight[y] * fieldShadowCompare(map, texel, receiverDepth, depthRange);
      }
    }
    return sum / (dot(xWeight, vec4<f32>(1.0)) * dot(yWeight, vec4<f32>(1.0)));
  }

  let center = vec2<i32>(floor(at + 0.5));
  let offset = at - vec2<f32>(center);
  let taps = vec3<f32>(-1.0, 0.0, 1.0);
  let xWeight = max(vec3<f32>(0.0), radius - abs(taps - offset.x));
  let yWeight = max(vec3<f32>(0.0), radius - abs(taps - offset.y));
  var sum = 0.0;
  for (var y = 0; y < 3; y++) {
    for (var x = 0; x < 3; x++) {
      let texel = clamp(center + vec2<i32>(x - 1, y - 1), vec2<i32>(0), size - 1);
      sum += xWeight[x] * yWeight[y] * fieldShadowCompare(map, texel, receiverDepth, depthRange);
    }
  }
  return sum / (dot(xWeight, vec3<f32>(1.0)) * dot(yWeight, vec3<f32>(1.0)));
}

fn fieldGroundShade(map: texture_2d<f32>, clip: vec4<f32>, depthRange: f32) -> f32 {
  let ndc = clip.xyz / clip.w;
  let edge = 0.5 * (1.0 - max(abs(ndc.x), abs(ndc.y)));
  if (clip.w <= 0.0 || edge <= 0.0 || ndc.z <= 0.0 || ndc.z >= 1.0) { return 0.0; }
  let size = vec2<i32>(textureDimensions(map));
  let at = vec2<f32>(size) * (vec2<f32>(ndc.x, -ndc.y) * 0.5 + 0.5) - 0.5;
  return smoothstep(0.0, 0.04, edge) * fieldShadowFilter(map, at, size, ndc.z, depthRange);
}

fn fieldGroundVisibility(position: vec3<f32>) -> f32 {
  if (shadow.useShadowMap <= 0.5 || shadow.lightCount < 1.0) { return 1.0; }
  let commonPosition = vec4<f32>(position, 1.0);
  var shade = fieldGroundShade(treeShadowMap0, treeShadowClip(commonPosition, 0), fieldShadowBlend.depthRange.x);
  if (shadow.lightCount > 1.0) {
    let previous = fieldGroundShade(treeShadowMap1, treeShadowClip(commonPosition, 1), fieldShadowBlend.depthRange.y);
    if (fieldShadowBlend.weight > 0.0) {
      shade = mix(shade, previous, fieldShadowBlend.weight);
    } else {
      shade = (shade + previous) / shadow.lightCount;
    }
  }
  return 1.0 - shade * min(shadow.color.a, ${FIELD_SHADOW_OPACITY});
}
`;
