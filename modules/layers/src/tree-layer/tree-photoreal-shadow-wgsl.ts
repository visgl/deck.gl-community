// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shaders';

/** The same shader entry points for a Deck without a shadow effect. */
export const treeUnshadowedWgsl = {
  name: 'treeUnshadowed',
  source: /* wgsl */ `
fn treeIsShadowPass() -> bool { return false; }
fn treeShadowPosition(clip: vec4<f32>, position: vec4<f32>) -> vec4<f32> { return clip; }
fn treeShadowDepth(depth: f32) -> vec4<f32> { return vec4<f32>(0.0); }
fn treeShadowDirect(light: i32, position: vec3<f32>, normal: vec3<f32>) -> f32 { return 1.0; }
`
} satisfies ShaderModule;

const SHADOW_MODULES = new WeakMap<ShaderModule, ShaderModule>();

/** Keep deck's light matrices and render targets, adding WGSL to the tree's instance of its module. */
export function getTreeShadowWgsl(module: ShaderModule): ShaderModule {
  const cached = SHADOW_MODULES.get(module);
  if (cached) return cached;
  const replacement: ShaderModule = {
    name: module.name,
    dependencies: module.dependencies,
    uniformTypes: module.uniformTypes,
    getUniforms: (props, previous) => {
      const {
        shadow_uShadowMap0: _map0,
        shadow_uShadowMap1: _map1,
        ...uniforms
      } = module.getUniforms?.(props, previous) ?? {};
      return {
        ...uniforms,
        drawShadowMap: Number(uniforms.drawShadowMap ?? 0),
        useShadowMap: Number(uniforms.useShadowMap ?? 0)
      };
    },
    source: /* wgsl */ `
struct TreeShadowUniforms {
  drawShadowMap: f32,
  useShadowMap: f32,
  color: vec4<f32>,
  lightId: i32,
  lightCount: f32,
  viewProjectionMatrix0: mat4x4<f32>,
  viewProjectionMatrix1: mat4x4<f32>,
  projectCenter0: vec4<f32>,
  projectCenter1: vec4<f32>,
};

@group(0) @binding(auto) var<uniform> shadow: TreeShadowUniforms;
@group(0) @binding(auto) var treeShadowMap0: texture_2d<f32>;
@group(0) @binding(auto) var treeShadowMap1: texture_2d<f32>;

fn treeIsShadowPass() -> bool { return shadow.drawShadowMap > 0.5; }

fn treeShadowClip(position: vec4<f32>, light: i32) -> vec4<f32> {
  if (light == 0) {
    return project_common_position_to_clipspace_with_projection(position, shadow.viewProjectionMatrix0, shadow.projectCenter0);
  }
  return project_common_position_to_clipspace_with_projection(position, shadow.viewProjectionMatrix1, shadow.projectCenter1);
}

fn treeShadowPosition(clip: vec4<f32>, position: vec4<f32>) -> vec4<f32> {
  if (treeIsShadowPass()) { return treeShadowClip(position, shadow.lightId); }
  return clip;
}

const TREE_DEPTH_SCALE = vec4<f32>(1.0, 255.0, 65025.0, 16581375.0);

fn treeShadowDepth(depth: f32) -> vec4<f32> {
  // Keep the depth write opaque even when a native model inherits color blending.
  // Three base-255 digits retain more precision than the depth16 attachment.
  let packed = u32(clamp(depth, 0.0, 0.99999994) * 16581375.0);
  return vec4<f32>(
    f32(packed / 65025u),
    f32((packed / 255u) % 255u),
    f32(packed % 255u),
    255.0
  ) / 255.0;
}

fn treeShadowTap(map: texture_2d<f32>, cell: vec2<i32>, extent: vec2<i32>, depth: f32) -> f32 {
  let stored = dot(textureLoad(map, clamp(cell, vec2<i32>(0), extent - vec2<i32>(1)), 0), 1.0 / TREE_DEPTH_SCALE);
  return smoothstep(0.0, 0.00002, depth - stored);
}

fn treeShadowRead(map: texture_2d<f32>, clip: vec4<f32>, normal: vec3<f32>, light: mat4x4<f32>) -> f32 {
  let ndc = clip.xyz / clip.w;
  if (clip.w <= 0.0 || any(abs(ndc.xy) > vec2<f32>(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) {
    return 0.0;
  }
  let extent = vec2<i32>(textureDimensions(map));
  let size = vec2<f32>(extent);
  let rowX = vec3<f32>(light[0].x, light[1].x, light[2].x);
  let rowY = -vec3<f32>(light[0].y, light[1].y, light[2].y);
  let rowZ = vec3<f32>(light[0].z, light[1].z, light[2].z);
  let metre = project_size_float(1.0);
  let depthPerMetre = 0.5 * length(rowZ) * metre;
  let texelMetres = 2.0 / max(vec2<f32>(length(rowX), length(rowY)) * size * metre, vec2<f32>(1e-6));
  let facing = dot(normal, normalize(rowZ));
  let slope = -vec2<f32>(dot(normal, normalize(rowX)), dot(normal, normalize(rowY))) *
    (facing / max(facing * facing, 0.26 * 0.26)) * texelMetres * depthPerMetre;
  let depth = ndc.z - 0.035 * depthPerMetre - 0.5 * (abs(slope.x) + abs(slope.y));
  // WebGPU render targets start at the top of the light's clip volume.
  let pixel = size * (vec2<f32>(ndc.x, -ndc.y) * 0.5 + vec2<f32>(0.5)) - vec2<f32>(0.5);
  let cell = vec2<i32>(floor(pixel));
  let weight = fract(pixel);
  let lowest = depth - dot(weight, slope);
  let a = treeShadowTap(map, cell, extent, lowest);
  let b = treeShadowTap(map, cell + vec2<i32>(1, 0), extent, lowest + slope.x);
  let c = treeShadowTap(map, cell + vec2<i32>(0, 1), extent, lowest + slope.y);
  let d = treeShadowTap(map, cell + vec2<i32>(1, 1), extent, lowest + slope.x + slope.y);
  return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
}

fn treeShadowDirect(light: i32, position: vec3<f32>, normal: vec3<f32>) -> f32 {
  if (shadow.useShadowMap <= 0.5 || light >= i32(shadow.lightCount) || light > 1) { return 1.0; }
  let commonPosition = vec4<f32>(position, 1.0);
  var shade = 0.0;
  if (light == 0) {
    shade = treeShadowRead(treeShadowMap0, treeShadowClip(commonPosition, 0), normal, shadow.viewProjectionMatrix0);
    if (treePhotoreal.shadowHistoryWeight > 0.0) {
      let previous = treeShadowRead(treeShadowMap1, treeShadowClip(commonPosition, 1), normal, shadow.viewProjectionMatrix1);
      shade = mix(shade, previous, treePhotoreal.shadowHistoryWeight);
    }
  } else {
    shade = treeShadowRead(treeShadowMap1, treeShadowClip(commonPosition, 1), normal, shadow.viewProjectionMatrix1);
  }
  return 1.0 - shade * shadow.color.a;
}
`
  };
  SHADOW_MODULES.set(module, replacement);
  return replacement;
}
