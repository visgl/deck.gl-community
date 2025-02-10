// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

const uniformBlock = `\
uniform colorUniforms {
  float opacity;
  float desaturate;
  float brightness;
} color;
`;

export type ColorProps = {
  opacity: number;
  desaturate: number;
  brightness: number;
};

const INITIAL_STATE: ColorProps = {
  opacity: 1.0,
  desaturate: 0.0,
  brightness: 1.0
};

function getUniforms(opts = INITIAL_STATE) {
  return opts;
}

const vs = `\
in vec4 color_vColor;

color_setColor(vec4 color) {
  color_vColor = color;
}
`;

const fs = `\
${uniformBlock}

in vec4 color_vColor;

out vec4 fragColor;

vec4 color_getColor() {
  return color_vColor;
}

vec4 color_filterColor(vec4 inputColor) {
  vec4 color = inputColor;
  // apply desaturation and brightness
  if (color.desaturate > 0.01) {
    float luminance = (color.r + color.g + color.b) * 0.333333333 + color.brightness;
    color = vec4(mix(color.rgb, vec3(luminance), color.desaturate), color.a);
  }

  // Apply opacity
  color = vec4(color.rgb, color.a * color.opacity);
  return color;
}
`;

/** Shader module that implements desaturation. @note still WIP */
export const color = {
  name: 'color',
  vs,
  fs,
  getUniforms,
  uniformTypes: {
    opacity: 'f32',
    desaturate: 'f32',
    brightness: 'f32'
  }
} as const satisfies ShaderModule<ColorProps>;
