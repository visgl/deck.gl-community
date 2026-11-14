// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SolidPolygonLayer} from '@deck.gl/layers';
import type {Model} from '@luma.gl/engine';
import type {ShaderModule, ShaderPlugin} from '@luma.gl/shaders';
import {getTreeShadowWgsl} from '../../modules/layers/src/tree-layer/tree-photoreal-shadow-wgsl';
import {FIELD_GROUND_SHADOW_WGSL} from './field-ground-shadow';

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
      !shaders.plugins.some(plugin => plugin.module && isFieldShadow(plugin.module))
    )
      return shaders;
    return {
      ...shaders,
      plugins: shaders.plugins.map((plugin: ShaderPlugin) => {
        const module = plugin.module;
        if (!module || !isFieldShadow(module)) return plugin;
        let receiver = modules.get(module);
        if (!receiver) {
          const wgsl = getTreeShadowWgsl(module);
          receiver = {
            ...wgsl,
            source: wgsl.source!.replace(/fn treeShadowTap\([\s\S]*$/, FIELD_GROUND_SHADOW_WGSL)
          };
          modules.set(module, receiver);
        }
        return {...plugin, module: receiver};
      }),
      source: shaders.source
        .replace(
          '@location(1) pickingColor: vec3<f32>,',
          '@location(1) pickingColor: vec3<f32>, @location(2) shadowPosition: vec3<f32>,'
        )
        .replace(
          'geometry.position = projectedPosition.commonPosition;',
          'geometry.position = projectedPosition.commonPosition; outp.shadowPosition = geometry.position.xyz;'
        )
        .replace(
          'var fragColor = inp.vColor;',
          'let visibility = fieldGroundVisibility(inp.shadowPosition); var fragColor = vec4<f32>(inp.vColor.rgb * visibility, inp.vColor.a);'
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
