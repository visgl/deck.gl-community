// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import {Texture} from '@luma.gl/core';

import {GetUniformsOutput, ShaderModule} from '../types';

function getUniforms(opts: {imageRgba?: Texture} = {}): GetUniformsOutput {
  const {imageRgba} = opts;

  if (!imageRgba) {
    return null;
  }

  return {
    bitmapTextureRgba: imageRgba
  };
}

const fs = /* glsl */ `\
precision mediump float;
precision mediump int;
precision mediump usampler2D;

#ifdef SAMPLER_TYPE
  uniform SAMPLER_TYPE bitmapTextureRgba;
#else
  uniform sampler2D bitmapTextureRgba;
#endif
`;

export const rgbaImage: ShaderModule = {
  name: 'rgba-image',
  fs,
  getUniforms,
  defines: {
    SAMPLER_TYPE: 'sampler2D'
  },
  inject: {
    'fs:DECKGL_CREATE_COLOR': `
    image = vec4(texture2D(bitmapTextureRgba, coord));
    `
  }
};
