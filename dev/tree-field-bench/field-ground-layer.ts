// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SolidPolygonLayer} from '@deck.gl/layers';
import type {Model} from '@luma.gl/engine';
import type {ShaderModule, ShaderPlugin} from '@luma.gl/shaders';
import {getTreeShadowWgsl} from '../../modules/layers/src/tree-layer/tree-photoreal-shadow-wgsl';
import {FIELD_GROUND_SHADOW_WGSL} from './field-ground-shadow';

const plugins = new WeakMap<ShaderPlugin, ShaderPlugin>();
const isFieldShadow = (module: ShaderModule) =>
  module.name === 'shadow' && module.dependencies?.some(dep => dep.name === 'fieldShadowBlend');

/** A flat field receiver. Stock SolidPolygonLayer already receives shadows on WebGL. */
export class FieldGroundLayer<DataT> extends SolidPolygonLayer<DataT, {shadowEnabled?: boolean}> {
  static layerName = 'FieldGroundLayer';

  getShaders(type: 'top' | 'side') {
    const shaders = super.getShaders(type);
    const plugin = shaders.plugins.find(plugin => plugin.module && isFieldShadow(plugin.module));
    const module: ShaderModule | undefined = plugin?.module;
    if (this.context.device.type !== 'webgpu' || type !== 'top' || !plugin || !module)
      return shaders;

    let receiver = plugins.get(plugin);
    if (!receiver) {
      const wgsl = getTreeShadowWgsl(module);
      receiver = {
        ...plugin,
        module: {
          ...wgsl,
          source: wgsl.source!.replace(/fn treeShadowTap\([\s\S]*$/, FIELD_GROUND_SHADOW_WGSL)
        },
        interStageVariables: {fieldShadowPosition: {type: 'vec3<f32>'}},
        injections: {
          'wgsl:vs:DECKGL_FILTER_GL_POSITION': 'fieldShadowPosition = geometry.position.xyz;',
          'wgsl:fs:DECKGL_FILTER_COLOR': /* wgsl */ `
if (picking.isActive <= 0.5) {
  (*color) = vec4<f32>((*color).rgb * fieldGroundVisibility(fieldShadowPosition), (*color).a);
}
`
        }
      };
      plugins.set(plugin, receiver);
    }
    return {
      ...shaders,
      modules: shaders.modules.filter(entry => entry !== module),
      plugins: shaders.plugins.map(entry => (entry === plugin ? receiver : entry))
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
