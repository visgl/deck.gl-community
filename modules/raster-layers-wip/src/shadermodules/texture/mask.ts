// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import {Texture} from '@luma.gl/core';

import {GetUniformsOutput, ShaderModule} from '../types';

const inf = Math.pow(2, 62);

function getUniforms(
  opts: {imageMask?: Texture; maskKeepMin?: number; maskKeepMax?: number} = {}
): GetUniformsOutput {
  const {imageMask, maskKeepMin, maskKeepMax} = opts;
  if (!imageMask) {
    return null;
  }

  return {
    bitmapTextureMask: imageMask,
    uMaskKeepMin: Number.isFinite(maskKeepMin) ? maskKeepMin : -inf,
    uMaskKeepMax: Number.isFinite(maskKeepMax) ? maskKeepMax : inf
  };
}

const fs = /* glsl */ `\
precision mediump float;
precision mediump int;
precision mediump usampler2D;

#ifdef SAMPLER_TYPE
  uniform SAMPLER_TYPE bitmapTextureMask;
#else
  uniform sampler2D bitmapTextureMask;
#endif

uniform float uMaskKeepMin;
uniform float uMaskKeepMax;
`;

const mask: ShaderModule = {
  name: 'mask-image',
  fs,
  getUniforms,
  defines: {
    SAMPLER_TYPE: 'sampler2D'
  },
  inject: {
    'fs:DECKGL_CREATE_COLOR': `
    float mask_value = float(texture2D(bitmapTextureMask, coord).r);
    if (mask_value < uMaskKeepMin) discard;
    if (mask_value > uMaskKeepMax) discard;
    `
  }
};

export const maskFloat: ShaderModule = {
  ...mask,
  name: 'mask-image-float'
};
export const maskUint: ShaderModule = {
  ...mask,
  name: 'mask-image-uint',
  defines: {
    SAMPLER_TYPE: 'usampler2D'
  }
};
export const maskInt: ShaderModule = {
  ...mask,
  name: 'mask-image-int',
  defines: {
    SAMPLER_TYPE: 'isampler2D'
  }
};
