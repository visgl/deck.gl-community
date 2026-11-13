// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Texture} from '@luma.gl/core';
import type {ShaderModule, ShaderPlugin} from '@luma.gl/shaders';

/** Named vertex hook shared by splat and tree mesh shaders. */
export const WGSL_FILTER_COLOR_ANCHOR =
  'DECKGL_FILTER_INSTANCE_COLOR(&vertexColor, instanceIndex);';
export const INSTANCE_COLOR_PLUGIN: ShaderPlugin = {
  name: 'instance-color',
  injectionTargets: [
    {
      name: 'DECKGL_FILTER_INSTANCE_COLOR',
      stage: 'vertex',
      wgsl: {parameters: 'color: ptr<function, vec4<f32>>, instanceIndex: u32'}
    }
  ]
};

/** The per-object selection weight attribute, written from `getSelected`. */
export const SELECTION_WEIGHTS_ATTRIBUTE = 'selectionWeights';

/**
 * How a layer reads selection weights:
 * - `attribute`: a vertex attribute, for any layer with deck.gl's GLSL `DECKGL_FILTER_COLOR`
 *   vertex hook, including non-instanced geometry such as polygon fills.
 * - `instance`: a texture read by instance index, for instanced layers whose vertex attributes
 *   already fill the 16 slots that WebGL2 and WebGPU guarantee.
 */
export type SelectionPulseMode = 'attribute' | 'instance';

export type SelectionPulseModuleProps = {
  /** Color selected objects blend toward, 0-1 RGB. */
  color: [number, number, number];
  /** Current blend toward `color` at a selection weight of 1. */
  amount: number;
  /** `instance` mode: one weight per instance, row-major. */
  selectionPulseTexture?: Texture;
};

const GLSL = /* glsl */ `\
layout(std140) uniform selectionPulseUniforms {
  vec3 color;
  float amount;
} selectionPulse;

#ifdef SELECTION_PULSE_INSTANCES
uniform highp sampler2D selectionPulseTexture;

float selectionPulse_getWeight() {
  int width = textureSize(selectionPulseTexture, 0).x;
  return texelFetch(selectionPulseTexture, ivec2(gl_InstanceID % width, gl_InstanceID / width), 0).r;
}
#else
in float ${SELECTION_WEIGHTS_ATTRIBUTE};

float selectionPulse_getWeight() {
  return ${SELECTION_WEIGHTS_ATTRIBUTE};
}
#endif

vec4 selectionPulse_filterColor(vec4 color) {
  return vec4(mix(color.rgb, selectionPulse.color, selectionPulse.amount * selectionPulse_getWeight()), color.a);
}
`;

const WGSL = /* wgsl */ `\
struct SelectionPulseUniforms {
  color: vec3<f32>,
  amount: f32,
};

@group(0) @binding(auto) var<uniform> selectionPulse: SelectionPulseUniforms;
@group(0) @binding(auto) var selectionPulseTexture: texture_2d<f32>;

fn selectionPulse_filterColor(color: vec4<f32>, instanceIndex: u32) -> vec4<f32> {
  let width = textureDimensions(selectionPulseTexture).x;
  let weight = textureLoad(selectionPulseTexture, vec2<u32>(instanceIndex % width, instanceIndex / width), 0).r;
  return vec4<f32>(mix(color.rgb, selectionPulse.color, selectionPulse.amount * weight), color.a);
}
`;

export const selectionPulse = {
  name: 'selectionPulse',
  vs: GLSL,
  source: WGSL,
  uniformTypes: {
    color: 'vec3<f32>',
    amount: 'f32'
  }
} as const satisfies ShaderModule<SelectionPulseModuleProps>;

const GLSL_INJECT = {'vs:DECKGL_FILTER_COLOR': '\n  color = selectionPulse_filterColor(color);\n'};

/** Shader additions for a layer, or `null` when WebGPU has no hook for `attribute` mode. */
export function getSelectionPulseShaders(mode: SelectionPulseMode, webgpu: boolean) {
  if (webgpu)
    return mode === 'instance'
      ? {
          modules: [selectionPulse],
          plugins: [
            {
              name: 'selection-pulse',
              injections: {
                'wgsl:vs:DECKGL_FILTER_INSTANCE_COLOR':
                  '(*color) = selectionPulse_filterColor(*color, instanceIndex);'
              }
            }
          ]
        }
      : null;
  return {
    modules: [selectionPulse],
    ...(mode === 'instance' && {defines: {SELECTION_PULSE_INSTANCES: 1}}),
    plugins: [{name: 'selection-pulse', injections: GLSL_INJECT}]
  };
}
