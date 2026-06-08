// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

const glslUniformBlock = `\
uniform blockUniforms {
  highp int sizeUnits;
  highp float widthMinPixels;
  highp float heightMinPixels;
  highp float sizeMaxPixels;
  highp int lineWidthUnits;
} block;
`;

export type BlockProps = {
  sizeUnits: number;
  widthMinPixels: number;
  heightMinPixels: number;
  sizeMaxPixels: number;
  lineWidthUnits: number;
};

export const blockUniforms = {
  name: 'block',
  vs: glslUniformBlock,
  fs: glslUniformBlock,
  uniformTypes: {
    sizeUnits: 'i32',
    widthMinPixels: 'f32',
    heightMinPixels: 'f32',
    sizeMaxPixels: 'f32',
    lineWidthUnits: 'i32'
  }
} as const satisfies ShaderModule<BlockProps>;
