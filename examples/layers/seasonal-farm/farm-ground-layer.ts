// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SolidPolygonLayer} from '@deck.gl/layers';
import type {Model} from '@luma.gl/engine';
import type {ShaderModule, ShaderPlugin} from '@luma.gl/shaders';
import {getTreeShadowWgsl} from '../../../modules/layers/src/tree-layer/tree-photoreal-shadow-wgsl';
import {FARM_COMMON_UNITS_PER_METRE, farmShadow, farmShadowPlugin} from './farm-lighting';

const GROUND_SHADOW_OPACITY = 0.3;

// Compare packed depths first, then filter visibility. A fixed world-space footprint
// keeps the penumbra similar through zoom changes and different canvas sizes.
const filter = /* glsl */ `
float farmShadowTap(sampler2D map, ivec2 cell, float receiverDepth, float depthPerMetre) {
  float depth = dot(texelFetch(map, cell, 0), bitUnpackShift);
  float separation = (receiverDepth - depth) / depthPerMetre;
  // The trunk keeps a stronger contact shadow than the elevated canopy.
  return smoothstep(0.02, 0.28, separation) * mix(1.0, 0.64, smoothstep(0.5, 8.0, separation));
}

float farmShadowWeight(vec3 position, sampler2D shadowMap) {
  vec3 edge = min(position, 1.0 - position);
  if (min(min(edge.x, edge.y), edge.z) <= 0.0) return 0.0;
  ivec2 size = textureSize(shadowMap, 0);
  mat4 light = shadow.viewProjectionMatrix0;
  vec2 units = vec2(length(vec3(light[0].x, light[1].x, light[2].x)),
    length(vec3(light[0].y, light[1].y, light[2].y)));
  const float metre = ${FARM_COMMON_UNITS_PER_METRE};
  float depthPerMetre = 0.5 * length(vec3(light[0].z, light[1].z, light[2].z)) * metre;
  vec2 radius = clamp(0.5 * 0.16 * metre * units * vec2(size), vec2(1.5), vec2(2.0));
  vec2 pixel = position.xy * vec2(size) - 0.5;
  ivec2 origin = ivec2(floor(pixel));
  vec2 fraction = fract(pixel);
  float sum = 0.0;
  float total = 0.0;
  for (int y = -1; y <= 2; y++) {
    for (int x = -1; x <= 2; x++) {
      vec2 weights = max(radius - abs(vec2(x, y) - fraction), vec2(0.0));
      float weight = weights.x * weights.y;
      ivec2 cell = clamp(origin + ivec2(x, y), ivec2(0), size - 1);
      sum += weight * farmShadowTap(shadowMap, cell, position.z, depthPerMetre);
      total += weight;
    }
  }
  return sum / total * smoothstep(0.0, 0.03, min(edge.x, edge.y));
}
`;

const glslShadow = {
  ...farmShadow,
  getUniforms(options: Parameters<typeof farmShadow.getUniforms>[0]) {
    const uniforms = farmShadow.getUniforms(options);
    if (uniforms.color) {
      uniforms.color = [0, 0, 0, Math.min(uniforms.color[3], GROUND_SHADOW_OPACITY)];
    }
    return uniforms;
  },
  fs: farmShadow.fs
    .replace(/float shadow_getShadowWeight\([^)]*\) \{[\s\S]*?\n\}/, filter)
    .replace(/shadow_getShadowWeight\(/g, 'farmShadowWeight(')
};

const wgslShadow = getTreeShadowWgsl(farmShadow);
const wgslReceiver: ShaderModule = {
  ...wgslShadow,
  source: wgslShadow.source!.replace(
    /fn treeShadowTap\([\s\S]*$/,
    /* wgsl */ `
fn farmShadowTap(cell: vec2<i32>, receiverDepth: f32, depthPerMetre: f32) -> f32 {
  let depth = dot(textureLoad(treeShadowMap0, cell, 0), 1.0 / TREE_DEPTH_SCALE);
  let separation = (receiverDepth - depth) / depthPerMetre;
  return smoothstep(0.02, 0.28, separation) * mix(1.0, 0.64, smoothstep(0.5, 8.0, separation));
}

fn farmShadowVisibility(position: vec3<f32>) -> f32 {
  if (shadow.useShadowMap <= 0.5 || shadow.lightCount < 1.0) { return 1.0; }
  let clip = treeShadowClip(vec4<f32>(position, 1.0), 0);
  let ndc = clip.xyz / clip.w;
  let edge = 0.5 * (1.0 - max(abs(ndc.x), abs(ndc.y)));
  if (clip.w <= 0.0 || edge <= 0.0 || ndc.z <= 0.0 || ndc.z >= 1.0) { return 1.0; }
  let size = vec2<i32>(textureDimensions(treeShadowMap0));
  let light = shadow.viewProjectionMatrix0;
  let units = vec2<f32>(length(vec3<f32>(light[0].x, light[1].x, light[2].x)),
    length(vec3<f32>(light[0].y, light[1].y, light[2].y)));
  let metre = ${FARM_COMMON_UNITS_PER_METRE};
  let depthPerMetre = 0.5 * length(vec3<f32>(light[0].z, light[1].z, light[2].z)) * metre;
  let radius = clamp(0.5 * 0.16 * metre * units * vec2<f32>(size), vec2<f32>(1.5), vec2<f32>(2.0));
  let pixel = vec2<f32>(size) * (vec2<f32>(ndc.x, -ndc.y) * 0.5 + 0.5) - 0.5;
  let origin = vec2<i32>(floor(pixel));
  let fraction = fract(pixel);
  var sum = 0.0;
  var total = 0.0;
  for (var y = -1; y <= 2; y++) {
    for (var x = -1; x <= 2; x++) {
      let weights = max(radius - abs(vec2<f32>(f32(x), f32(y)) - fraction), vec2<f32>(0.0));
      let weight = weights.x * weights.y;
      let cell = clamp(origin + vec2<i32>(x, y), vec2<i32>(0), size - 1);
      sum += weight * farmShadowTap(cell, ndc.z, depthPerMetre);
      total += weight;
    }
  }
  return 1.0 - min(shadow.color.a, ${GROUND_SHADOW_OPACITY}) * sum / total * smoothstep(0.0, 0.03, edge);
}
`
  )
};

const glslReceiverPlugin: ShaderPlugin = {...farmShadowPlugin, module: glslShadow};

const wgslReceiverPlugin: ShaderPlugin = {
  ...farmShadowPlugin,
  module: wgslReceiver,
  interStageVariables: {farmShadowPosition: {type: 'vec3<f32>'}},
  injections: {
    'wgsl:vs:DECKGL_FILTER_GL_POSITION': 'farmShadowPosition = geometry.position.xyz;',
    'wgsl:fs:DECKGL_FILTER_COLOR': /* wgsl */ `
if (picking.isActive <= 0.5) {
  (*color) = vec4<f32>((*color).rgb * farmShadowVisibility(farmShadowPosition), (*color).a);
}
`
  }
};

/** Flat terrain and plot surfaces share the same directional shadow. */
export class FarmGroundLayer<DataT> extends SolidPolygonLayer<DataT, {shadowEnabled?: boolean}> {
  static layerName = 'FarmGroundLayer';

  getShaders(type: 'top' | 'side') {
    const shaders = super.getShaders(type);
    const webgpu = this.context.device.type === 'webgpu';
    const plugin = webgpu ? wgslReceiverPlugin : glslReceiverPlugin;
    return {
      ...shaders,
      modules: shaders.modules.filter((module: ShaderModule) => module !== farmShadow),
      plugins: shaders.plugins.map((candidate: ShaderPlugin) =>
        candidate !== farmShadowPlugin ? candidate : plugin
      )
    };
  }

  setShaderModuleProps(props: Parameters<Model['shaderInputs']['setProps']>[0]): void {
    super.setShaderModuleProps(props);
    if (this.context.device.type !== 'webgpu' || !props.shadow?.dummyShadowMap) return;
    const {shadowMaps, dummyShadowMap} = props.shadow;
    this.state.topModel?.setBindings({
      treeShadowMap0: shadowMaps?.[0] ?? dummyShadowMap,
      treeShadowMap1: shadowMaps?.[1] ?? dummyShadowMap
    });
  }
}
