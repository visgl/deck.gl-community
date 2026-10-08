// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  LightingEffect,
  shadow,
  type EffectContext,
  type Layer,
  type LightingEffectProps,
  type PreRenderOptions,
  type DirectionalLight
} from '@deck.gl/core';
import type {Texture} from '@luma.gl/core';
import {Matrix4, Vector3} from '@math.gl/core';
import {getBoundedShadowUniforms, getGroundShadowSettings} from './shadow-frustum';
import {GroundShadowFilter} from './ground-shadow-filter';
import {TreeShadowPass} from './tree-shadow-pass';
import {SplatLayer, SplatShadowPass, type SplatShadowProjection} from '@deck.gl-community/layers';

const SHADOW_WEIGHT = `float shadow_getShadowWeight(vec3 position, sampler2D shadowMap) {`;
export const SHADOW_FILTER = `float shadow_getShadowWeight(vec3 position, highp sampler2DShadow shadowMap, float bias) {
  if (any(lessThanEqual(position, vec3(0.0))) || any(greaterThanEqual(position, vec3(1.0)))) return 0.0;
  vec2 size = vec2(textureSize(shadowMap, 0));
  vec2 samplePosition = position.xy * size - 0.5;
  vec2 base = floor(samplePosition);
  vec2 f = fract(samplePosition);
  // Pair a three-texel tent's four fractional weights into two hardware PCF reads per axis.
  // Hardware compares each depth before interpolating, as in NVIDIA GPU Gems chapter 11.
  vec2 wx = vec2(3.0 - 2.0 * f.x, 1.0 + 2.0 * f.x);
  vec2 wy = vec2(3.0 - 2.0 * f.y, 1.0 + 2.0 * f.y);
  vec2 ox = vec2(-1.0 + (2.0 - f.x) / wx.x, 1.0 + f.x / wx.y);
  vec2 oy = vec2(-1.0 + (2.0 - f.y) / wy.x, 1.0 + f.y / wy.y);
  float weight = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 uv = (base + vec2(ox[x], oy[y]) + 0.5) / size;
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
      weight += (1.0 - texture(shadowMap, vec3(uv, position.z - bias))) * wx[x] * wy[y];
    }
  }
  vec2 edge = min(position.xy, 1.0 - position.xy);
  return weight / 16.0 * smoothstep(0.0, 0.04, min(edge.x, edge.y));
}`;

const GROUND_WEIGHT = `
  uniform sampler2D shadow_uGroundMap0;
  uniform sampler2D shadow_uGroundMap1;
  float shadow_getGroundWeight(vec3 position, sampler2D map) {
    if (any(lessThanEqual(position, vec3(0.0))) || any(greaterThanEqual(position, vec3(1.0)))) return 0.0;
    vec2 edge = min(position.xy, 1.0 - position.xy);
    return texture(map, position.xy).r * smoothstep(0.0, 0.04, min(edge.x, edge.y));
  }`;
const SOFT_SHADOW = {
  ...shadow,
  getUniforms: getBoundedShadowUniforms,
  inject: {...shadow.inject, 'fs:#main-start': 'if (shadow.drawShadowMap) { return; }'},
  uniformTypes: {...shadow.uniformTypes, depthBias: 'vec2<f32>', groundFilter: 'vec2<f32>'},
  vs: shadow.vs!.replace(
    '  vec4 projectCenter1;',
    '  vec4 projectCenter1;\n  vec2 depthBias;\n  vec2 groundFilter;'
  ),
  fs: shadow
    .fs!.replace(
      '  vec4 projectCenter1;',
      '  vec4 projectCenter1;\n  vec2 depthBias;\n  vec2 groundFilter;'
    )
    .replaceAll(
      'uniform sampler2D shadow_uShadowMap',
      'uniform highp sampler2DShadow shadow_uShadowMap'
    )
    .replace(
      /float shadow_getShadowWeight\(vec3 position, sampler2D shadowMap\) \{[\s\S]*?\n\}/,
      SHADOW_FILTER + GROUND_WEIGHT
    )
    .replace(
      'shadow_getShadowWeight(shadow_vPosition[0], shadow_uShadowMap0)',
      '(shadow.groundFilter.x > 0.5 ? shadow_getGroundWeight(shadow_vPosition[0], shadow_uGroundMap0) : shadow_getShadowWeight(shadow_vPosition[0], shadow_uShadowMap0, shadow.depthBias.x))'
    )
    .replace(
      'shadow_getShadowWeight(shadow_vPosition[1], shadow_uShadowMap1)',
      '(shadow.groundFilter.x > 0.5 ? shadow_getGroundWeight(shadow_vPosition[1], shadow_uGroundMap1) : shadow_getShadowWeight(shadow_vPosition[1], shadow_uShadowMap1, shadow.depthBias.y))'
    )
};

/** Native comparison depth maps and prefiltered coverage for the lab's planar ground. */
export class TreeLightingEffect extends LightingEffect {
  useInPicking = true;
  /** Maximum shadow map edge in pixels; presentation and source geometry retain their own sizes. */
  shadowMapSize = 1024;
  private neutralShadowMap?: Texture;
  private neutralGroundMap?: Texture;
  private filteredShadow = false;
  private treePasses: TreeShadowPass[] = [];
  private transmissionPasses: SplatShadowPass[] = [];
  private groundFilters: GroundShadowFilter[] = [];
  private treeMatrices: Matrix4[] = [];
  private pendingRedraw?: number;

  setProps(props: LightingEffectProps) {
    this.props = props;
    super.setProps(props);
  }

  /** Capture may use ground maps only after both filter draws completed. */
  get groundShadowsReady(): boolean {
    const lights = Object.values(this.props).filter(
      light => light.type === 'directional' && light.shadow
    );
    return (
      this.groundFilters.length === lights.length &&
      this.groundFilters.every(filter => filter.ready)
    );
  }

  setSunDirection(direction: [number, number, number]) {
    const key = this.props.key;
    if (key?.type === 'directional') key.direction = direction;
  }

  setup(context: EffectContext) {
    super.setup(context);
    if (context.device.type !== 'webgl') return;
    this.neutralShadowMap ??= context.device.createTexture({
      format: 'depth16unorm',
      width: 1,
      height: 1,
      data: new Uint16Array([65535]),
      sampler: {
        type: 'comparison-sampler',
        compare: 'less-equal',
        minFilter: 'linear',
        magFilter: 'linear'
      }
    });
    this.neutralGroundMap ??= context.device.createTexture({
      width: 1,
      height: 1,
      data: new Uint8Array(4)
    });
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

  preRender(options: PreRenderOptions) {
    if (this.context?.device.type !== 'webgl') return super.preRender(options);
    const lights = Object.values(this.props).filter(
      (light): light is DirectionalLight => light.type === 'directional' && light.shadow
    );
    const hasGroundReceiver = options.layers.some(
      layer =>
        layer.props.visible &&
        layer.id.endsWith('-ground') &&
        layer.props.operation.includes('draw')
    );
    for (const pass of this.treePasses.splice(lights.length)) pass.destroy();
    const groundLights = hasGroundReceiver ? lights.length : 0;
    for (const pass of this.transmissionPasses.splice(groundLights)) pass.destroy();
    for (const filter of this.groundFilters.splice(groundLights)) filter.destroy();
    if (!lights.length) return;
    this.treeMatrices = lights.map(light =>
      new Matrix4().lookAt({eye: new Vector3(light.direction).negate()})
    );
    const boundedUniforms = getBoundedShadowUniforms({
      project: {viewport: options.viewports[0]},
      shadowMatrices: this.treeMatrices,
      dummyShadowMap: this.neutralShadowMap!,
      dummyGroundMap: this.neutralGroundMap!
    });
    const lightProjections: SplatShadowProjection[] = lights.map((_, index) => {
      const viewport = options.viewports[0];
      const ratio = this.shadowMapSize / Math.max(viewport.width, viewport.height);
      return {
        matrix: Array.from(
          index === 0
            ? boundedUniforms.viewProjectionMatrix0
            : boundedUniforms.viewProjectionMatrix1
        ),
        center: Array.from(
          index === 0 ? boundedUniforms.projectCenter0 : boundedUniforms.projectCenter1
        ),
        width: Math.max(1, Math.round(viewport.width * ratio)),
        height: Math.max(1, Math.round(viewport.height * ratio))
      };
    });
    for (const layer of options.layers) {
      // Optical transmission currently serves only the lab's planar receiver.
      if (!hasGroundReceiver && layer instanceof SplatLayer) continue;
      const caster = layer as Layer & {
        prepareShadow?: (
          projections: SplatShadowProjection[],
          viewport: (typeof options.viewports)[0]
        ) => void;
      };
      caster.prepareShadow?.(lightProjections, options.viewports[0]);
    }
    for (const [index] of lights.entries()) {
      this.treePasses[index] ??= new TreeShadowPass(this.context.device);
      this.treePasses[index].render(
        {
          ...options,
          effects: [],
          shaderModuleProps: {
            shadow: {
              shadowLightId: index,
              dummyShadowMap: this.neutralShadowMap,
              dummyGroundMap: this.neutralGroundMap,
              shadowMatrices: this.treeMatrices
            }
          }
        },
        this.shadowMapSize
      );
    }
    if (!hasGroundReceiver) return;
    for (const [index, pass] of this.treePasses.entries()) {
      this.transmissionPasses[index] ??= new SplatShadowPass(this.context.device);
      this.transmissionPasses[index].renderTransmission(options, {
        ...lightProjections[index],
        width: pass.depth.width,
        height: pass.depth.height
      });
    }
    const settings = getGroundShadowSettings(
      options.viewports[0],
      this.treeMatrices,
      this.treePasses.map(pass => [pass.depth.width, pass.depth.height])
    );
    for (const [index, setting] of settings.entries()) {
      this.groundFilters[index] ??= new GroundShadowFilter(this.context.device);
      this.groundFilters[index].render(
        this.treePasses[index].depth,
        setting.plane,
        setting.step,
        this.transmissionPasses[index].transmission
      );
    }
    if (this.groundFilters.some(filter => !filter.ready) && this.pendingRedraw === undefined) {
      this.pendingRedraw = requestAnimationFrame(() => {
        this.pendingRedraw = undefined;
        this.context?.deck.setProps({});
      });
    }
  }

  getShaderModuleProps(layer: Layer, otherShaderModuleProps: Record<string, unknown>) {
    const props = super.getShaderModuleProps(layer, otherShaderModuleProps);
    if (!this.neutralShadowMap) return props;
    const enabled = Object.values(this.props).some(
      light => light.type === 'directional' && light.shadow
    );
    return {
      ...props,
      shadow: {
        project: otherShaderModuleProps.project,
        shadowMaps: enabled
          ? this.treePasses.slice(0, this.treeMatrices.length).map(pass => pass.depth)
          : [],
        dummyShadowMap: this.neutralShadowMap,
        dummyGroundMap: this.neutralGroundMap,
        groundMaps: this.groundFilters.map(filter => filter.map),
        groundReceiver:
          layer.id.endsWith('-ground') && this.groundFilters.every(filter => filter.ready),
        shadowColor: this.shadowColor,
        shadowMatrices: this.treeMatrices
      }
    };
  }

  cleanup(context: EffectContext) {
    if (this.pendingRedraw !== undefined) cancelAnimationFrame(this.pendingRedraw);
    this.pendingRedraw = undefined;
    for (const pass of this.treePasses) pass.destroy();
    for (const pass of this.transmissionPasses) pass.destroy();
    this.transmissionPasses = [];
    for (const filter of this.groundFilters) filter.destroy();
    this.treePasses = [];
    this.groundFilters = [];
    super.cleanup(context);
    if (this.filteredShadow) context.deck._removeDefaultShaderModule(SOFT_SHADOW);
    this.filteredShadow = false;
    this.neutralShadowMap?.destroy();
    this.neutralShadowMap = undefined;
    this.neutralGroundMap?.destroy();
    this.neutralGroundMap = undefined;
  }
}
