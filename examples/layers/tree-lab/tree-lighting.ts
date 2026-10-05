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

const SHADOW_WEIGHT = `float shadow_getShadowWeight(vec3 position, sampler2D shadowMap) {`;
const SHADOW_FILTER = `float shadow_getShadowWeight(vec3 position, sampler2D shadowMap) {
  vec2 texel = 1.0 / vec2(textureSize(shadowMap, 0));
  float weight = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float depth = dot(texture(shadowMap, position.xy + vec2(float(x), float(y)) * texel), bitUnpackShift);
      weight += smoothstep(0.0005, 0.002, position.z - depth);
    }
  }
  return weight / 9.0;
}`;
const SOFT_SHADOW = {
  ...shadow,
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
  fs: shadow.fs!.replace(
    /float shadow_getShadowWeight\(vec3 position, sampler2D shadowMap\) \{[\s\S]*?\n\}/,
    SHADOW_FILTER
  )
};

/** Matched lab lighting: a small PCF kernel smooths the shared WebGL shadow map. */
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
