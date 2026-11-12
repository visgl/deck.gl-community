// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SolidPolygonLayer} from '@deck.gl/layers';
import type {Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {getTreeShadowWgsl} from '../../modules/layers/src/tree-layer/tree-photoreal-shadow-wgsl';

const modules = new WeakMap<ShaderModule, ShaderModule>();

/** A flat field receiver. Stock SolidPolygonLayer already receives shadows on WebGL. */
export class FieldGroundLayer<DataT> extends SolidPolygonLayer<DataT, {shadowEnabled?: boolean}> {
  static layerName = 'FieldGroundLayer';

  getShaders(type: 'top' | 'side') {
    const shaders = super.getShaders(type);
    if (
      this.context.device.type !== 'webgpu' ||
      type !== 'top' ||
      !shaders.modules.some((module: ShaderModule) => module.name === 'shadow')
    )
      return shaders;
    return {
      ...shaders,
      modules: shaders.modules.map((module: ShaderModule) => {
        if (module.name !== 'shadow') return module;
        let receiver = modules.get(module);
        if (!receiver) {
          const wgsl = getTreeShadowWgsl(module);
          receiver = {
            ...wgsl,
            source: wgsl.source!.replaceAll(
              'treePhotoreal.shadowHistoryWeight',
              'fieldShadowBlend.weight'
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
