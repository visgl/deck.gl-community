// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';
import {Texture} from '@luma.gl/core';

const uniformBlock = `\
layout(std140) uniform horizonLayerUniforms {
  float dataTextureSize;  // width = height of the POT texture
  float dataTextureSizeInv;
  float dataTextureCount; // actual number of data points

  float bands;
  float bandsInv;
  float yAxisScaleInv;

  vec3      positiveColor;
  vec3      negativeColor;
} horizonLayer;
`;

type HorizonLayerBindingProps = {
  dataTexture: Texture;
};

type HorizonLayerUniformProps = {};

export type HorizonLayerProps = HorizonLayerBindingProps & HorizonLayerUniformProps;

export const horizonLayerUniforms = {
  name: 'horizonLayer',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    dataTextureSize: 'f32',
    dataTextureSizeInv: 'f32',
    dataTextureCount: 'f32',

    bands: 'f32',
    bandsInv: 'f32',
    yAxisScaleInv: 'f32',

    positiveColor: 'vec3<f32>',
    negativeColor: 'vec3<f32>'
  }
} as const satisfies ShaderModule<HorizonLayerProps>;
