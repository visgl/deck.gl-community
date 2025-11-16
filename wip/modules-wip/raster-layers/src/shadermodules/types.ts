// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import {Texture} from '@luma.gl/core';

export interface ShaderModule {
  /** A unique name for this shader module */
  name: string;

  /** A fragment shader to be used in both WebGL1 and WebGL2 environments */
  fs: string;
  /** A vertex shader to inject */
  vs?: string;

  uniforms?: Record<string, any>;
  getUniforms?: (opts: object) => GetUniformsOutput;

  /** Optional constants to define when injecting */
  defines?: Record<string, string>;
  inject?: Record<string, string>;
  dependencies?: ShaderModule[];
  deprecations?: any[];
}

export type UniformType = number | number[] | Texture | undefined;

export type GetUniformsOutput = Record<string, UniformType> | null;
