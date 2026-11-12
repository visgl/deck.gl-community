// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SolidPolygonLayer} from '@deck.gl/layers';
import type {Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {getTreeShadowWgsl} from '../../modules/layers/src/tree-layer/tree-photoreal-shadow-wgsl';

const modules = new WeakMap<ShaderModule, ShaderModule>();
const isFieldShadow = (module: ShaderModule) =>
  module.name === 'shadow' && module.dependencies?.some(dep => dep.name === 'fieldShadowBlend');

/** A flat field receiver. Stock SolidPolygonLayer already receives shadows on WebGL. */
export class FieldGroundLayer<DataT> extends SolidPolygonLayer<DataT, {shadowEnabled?: boolean}> {
  static layerName = 'FieldGroundLayer';

  getShaders(type: 'top' | 'side') {
    const shaders = super.getShaders(type);
    if (
      this.context.device.type !== 'webgpu' ||
      type !== 'top' ||
      !shaders.modules.some(isFieldShadow)
    )
      return shaders;
    return {
      ...shaders,
      modules: shaders.modules.map((module: ShaderModule) => {
        if (!isFieldShadow(module)) return module;
        let receiver = modules.get(module);
        if (!receiver) {
          const wgsl = getTreeShadowWgsl(module);
          receiver = {
            ...wgsl,
            source: wgsl
              .source!.replaceAll('treePhotoreal.shadowHistoryWeight', 'fieldShadowBlend.weight')
              // Fade the edge of each fitted map, as the WebGL ground receiver does.
              .replace(
                'return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);',
                'let border = smoothstep(0.0, 0.04, 0.5 * (1.0 - max(abs(ndc.x), abs(ndc.y)))); return border * mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);'
              )
          };
          modules.set(module, receiver);
        }
        return receiver;
      }),
      source: shaders.source
        .replace(
          '@location(2) clipCoordinates: vec2<f32>,',
          '@location(2) clipCoordinates: vec2<f32>, @location(3) shadowPosition: vec3<f32>,'
        )
        .replace(
          'outp.clipCoordinates = geometry.position.xy;',
          'outp.clipCoordinates = geometry.position.xy; outp.shadowPosition = geometry.position.xyz;'
        )
        .replace(
          'var fragColor = inp.vColor;',
          'let visibility = treeShadowDirect(0, inp.shadowPosition, vec3<f32>(0.0, 0.0, 1.0)); var fragColor = vec4<f32>(inp.vColor.rgb * visibility, inp.vColor.a);'
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
