// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  LightingEffect,
  shadow,
  type EffectContext,
  type Layer,
  type LightingEffectProps
} from '@deck.gl/core';
import type {Texture} from '@luma.gl/core';
import {getBoundedShadowUniforms} from './shadow-frustum';

const SHADOW_WEIGHT = `float shadow_getShadowWeight(vec3 position, sampler2D shadowMap) {`;
export const SHADOW_FILTER = `float shadow_getShadowWeight(vec3 position, sampler2D shadowMap, float bias) {
  // Border texels are clamped by WebGL; sampling them outside the light
  // volume repeats unrelated silhouettes across the ground near the horizon.
  if (any(lessThanEqual(position, vec3(0.0))) || any(greaterThanEqual(position, vec3(1.0)))) return 0.0;
  ivec2 size = textureSize(shadowMap, 0);
  vec2 samplePosition = position.xy * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(samplePosition));
  vec2 fraction = fract(samplePosition);
  // PCF compares unfiltered depths, then filters the comparison results.
  // These 16 unique texels reproduce nine overlapping bilinear comparisons.
  // See NVIDIA GPU Gems, chapter 11 (Shadow Map Antialiasing).
  vec4 weightsX = vec4(1.0 - fraction.x, 1.0, 1.0, fraction.x);
  vec4 weightsY = vec4(1.0 - fraction.y, 1.0, 1.0, fraction.y);
  float weight = 0.0;
  for (int y = -1; y <= 2; y++) {
    for (int x = -1; x <= 2; x++) {
      ivec2 coordinate = base + ivec2(x, y);
      if (any(lessThan(coordinate, ivec2(0))) || any(greaterThanEqual(coordinate, size))) continue;
      float depth = dot(texelFetch(shadowMap, coordinate, 0), bitUnpackShift);
      float occlusion = step(depth + bias, position.z);
      weight += occlusion * weightsX[x + 1] * weightsY[y + 1];
    }
  }
  vec2 edge = min(position.xy, 1.0 - position.xy);
  float fade = smoothstep(0.0, 0.04, min(edge.x, edge.y));
  return weight / 9.0 * fade;
}`;
const SOFT_SHADOW = {
  ...shadow,
  getUniforms: getBoundedShadowUniforms,
  uniformTypes: {...shadow.uniformTypes, depthBias: 'vec2<f32>'},
  vs: shadow.vs!.replace('  vec4 projectCenter1;', '  vec4 projectCenter1;\n  vec2 depthBias;'),
  inject: {
    ...shadow.inject,
    // The frozen SimpleMeshLayer path shades after DECKGL_FILTER_COLOR. Restore
    // raw packed depth at the final output so both comparison columns cast correctly.
    'fs:#main-end': `
      if (shadow.drawShadowMap) {
        fragColor = fract(gl_FragCoord.z * bitPackShift);
        fragColor -= fragColor.gbaa * bitMask;
      }
    `
  },
  fs: shadow
    .fs!.replace('  vec4 projectCenter1;', '  vec4 projectCenter1;\n  vec2 depthBias;')
    .replace(
      /float shadow_getShadowWeight\(vec3 position, sampler2D shadowMap\) \{[\s\S]*?\n\}/,
      SHADOW_FILTER
    )
    .replace(
      'shadow_vPosition[0], shadow_uShadowMap0)',
      'shadow_vPosition[0], shadow_uShadowMap0, shadow.depthBias.x)'
    )
    .replace(
      'shadow_vPosition[1], shadow_uShadowMap1)',
      'shadow_vPosition[1], shadow_uShadowMap1, shadow.depthBias.y)'
    )
};

/** Matched lab lighting with filtered, bounded WebGL shadows through the camera horizon. */
export class TreeLightingEffect extends LightingEffect {
  useInPicking = true;
  private neutralShadowMap?: Texture;
  private filteredShadow = false;

  setProps(props: LightingEffectProps) {
    // The base calls setup before assigning props; publish the new lights first.
    this.props = props;
    super.setProps(props);
  }

  setSunDirection(direction: [number, number, number]) {
    const key = this.props.key;
    if (key?.type === 'directional') key.direction = direction;
  }

  setup(context: EffectContext) {
    super.setup(context);
    if (context.device.type !== 'webgl') return;
    this.neutralShadowMap ??= context.device.createTexture({width: 1, height: 1});
    if (
      Object.values(this.props).some(light => light.type === 'directional' && light.shadow) &&
      !this.filteredShadow
    ) {
      if (!shadow.fs!.includes(SHADOW_WEIGHT))
        throw new Error('Unsupported deck.gl shadow filter.');
      context.deck._removeDefaultShaderModule(shadow);
      context.deck._addDefaultShaderModule(SOFT_SHADOW);
      this.filteredShadow = true;
    }
  }
  getShaderModuleProps(layer: Layer, otherShaderModuleProps: Record<string, unknown>) {
    const props = super.getShaderModuleProps(layer, otherShaderModuleProps);
    // LightingEffect keeps its shadow module when toggled off. A live fallback
    // sampler prevents its disabled shader from binding an undefined texture.
    if (this.neutralShadowMap && !('dummyShadowMap' in props.shadow)) {
      return {
        ...props,
        shadow: {
          project: otherShaderModuleProps.project,
          shadowMaps: [],
          dummyShadowMap: this.neutralShadowMap,
          shadowColor: this.shadowColor,
          shadowMatrices: []
        }
      };
    }
    return props;
  }

  cleanup(context: EffectContext) {
    super.cleanup(context);
    if (this.filteredShadow) context.deck._removeDefaultShaderModule(SOFT_SHADOW);
    this.filteredShadow = false;
    this.neutralShadowMap?.destroy();
    this.neutralShadowMap = undefined;
  }
}
