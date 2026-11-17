// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderPlugin} from '@luma.gl/shaders';

/**
 * Named vertex hook shared by splat and tree mesh shaders. `SelectionPulseExtension` in
 * `@deck.gl-community/extensions` injects into it and matches this literal.
 */
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
