// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

/** Props accepted by the `zoomOpacity` shader module. */
export type ZoomOpacityModuleProps = {
  /** Zoom-derived opacity multiplier in `[0, 1]`. */
  opacity?: number;
};

type ZoomOpacityModuleUniforms = {
  opacity: number;
};

const uniformBlock = /* glsl */ `\
layout(std140) uniform zoomOpacityUniforms {
  float opacity;
} zoomOpacity;
`;

/**
 * GLSL shader module used by `ZoomOpacityExtension`.
 *
 * Alpha is applied through deck.gl's `layer.opacity` uniform. This module collapses every vertex
 * when the zoom-derived opacity is `0` so fully faded layers rasterize no fragments and cannot be
 * picked. `zoomOpacity.opacity` is also available to custom shaders.
 */
export const zoomOpacityShaderModule = {
  name: 'zoomOpacity',
  vs: uniformBlock,
  fs: uniformBlock,
  inject: {
    'vs:#main-end': /* glsl */ `
  if (zoomOpacity.opacity <= 0.0) {
    gl_Position = vec4(0.0);
  }
`
  },
  getUniforms: (props?: ZoomOpacityModuleProps): Partial<ZoomOpacityModuleUniforms> =>
    props && props.opacity !== undefined ? {opacity: props.opacity} : {},
  uniformTypes: {
    opacity: 'f32'
  },
  defaultUniforms: {
    opacity: 1
  }
} as const satisfies ShaderModule<ZoomOpacityModuleProps, ZoomOpacityModuleUniforms>;
