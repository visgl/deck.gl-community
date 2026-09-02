// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

const glslUniformBlock = `\
uniform blockUniforms {
  highp int sizeUnits;
  highp float widthMinPixels;
  highp float widthMaxPixels;
  highp float widthCutoffPixels;
  highp float heightMinPixels;
  highp float sizeMaxPixels;
  highp int lineWidthUnits;
  highp float strokeOffset;
  highp vec4 overrideColor;
} block;
`;

/** Shader uniform values used by {@link BlockLayer}. */
export type BlockProps = {
  /** Numeric deck.gl unit for block width and height. */
  sizeUnits: number;
  /** Minimum rendered block width in pixels. */
  widthMinPixels: number;
  /** Maximum rendered block width in pixels. */
  widthMaxPixels: number;
  /** Minimum projected source width in pixels required to render the block. */
  widthCutoffPixels: number;
  /** Minimum rendered block height in pixels. */
  heightMinPixels: number;
  /** Maximum rendered block width or height in pixels. */
  sizeMaxPixels: number;
  /** Numeric deck.gl unit for block outline width. */
  lineWidthUnits: number;
  /** Stroke alignment relative to the block bounds. */
  strokeOffset: number;
  /** Normalized replacement color used by instances with an enabled color override. */
  overrideColor: [number, number, number, number];
};

/** Shader module that defines uniforms consumed by {@link BlockLayer}. */
export const blockUniforms = {
  name: 'block',
  vs: glslUniformBlock,
  fs: glslUniformBlock,
  uniformTypes: {
    sizeUnits: 'i32',
    widthMinPixels: 'f32',
    widthMaxPixels: 'f32',
    widthCutoffPixels: 'f32',
    heightMinPixels: 'f32',
    sizeMaxPixels: 'f32',
    lineWidthUnits: 'i32',
    strokeOffset: 'f32',
    overrideColor: 'vec4<f32>'
  }
} as const satisfies ShaderModule<BlockProps>;
