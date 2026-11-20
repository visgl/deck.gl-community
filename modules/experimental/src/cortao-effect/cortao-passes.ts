// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Framebuffer, RenderPipelineParameters, Texture} from '@luma.gl/core';
import type {CORTAOCamera, CORTAOConfiguration} from './cortao-parameters';
import type {CORTAORayCount} from './cortao-occluder-lookup-table';

/** The shader constants of the passes. A change rebuilds the pipelines. */
export type CORTAOShaderOptions = {
  sampleCount: number;
  rayCount: CORTAORayCount;
  largeFilter: boolean;
  filterSymmetry: boolean;
};

/** The inputs of one CORTAO frame. */
export type CORTAOFrame = {
  camera: CORTAOCamera;
  configuration: CORTAOConfiguration;
  /** The hardware depth of the captured layers. */
  depthTexture: Texture;
  /** Apply the bilateral filter pass. */
  filter: boolean;
};

/** The options of the composite pass. */
export type CORTAOCompositeOptions = {
  /** The output. `null` is the default framebuffer. */
  output: Framebuffer | null;
  colorTexture: Texture;
  /** The occlusion, or `null` to copy the color unchanged. */
  occlusionTexture: Texture | null;
  showOcclusion: boolean;
  clearCanvas: boolean;
};

/** The CORTAO passes of one GPU backend. */
export interface CORTAOPasses {
  /** Runs the prepass, the mip pass, the main pass and the optional filter pass. */
  renderOcclusion(frame: CORTAOFrame): Texture;
  /** Writes the color, multiplied by the occlusion if there is one, to the output. */
  composite(options: CORTAOCompositeOptions): void;
  /** Rebuilds the pipelines that depend on the shader constants. */
  setShaderOptions(options: CORTAOShaderOptions): void;
  destroy(): void;
}

/** Pipeline parameters of the full-screen passes. */
export const PASS_PARAMETERS: RenderPipelineParameters = {
  depthWriteEnabled: false,
  depthCompare: 'always'
};

/** Pipeline parameters of the composite pass. They match the deck.gl `ScreenPass` blending. */
export const COMPOSITE_PARAMETERS: RenderPipelineParameters = {
  ...PASS_PARAMETERS,
  blend: true,
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
  blendColorOperation: 'add',
  blendAlphaOperation: 'add'
};

/** Nearest sampling. Integer and depth textures are incomplete with linear filtering in WebGL 2. */
export const NEAREST_SAMPLER = {
  minFilter: 'nearest',
  magFilter: 'nearest'
} as const;

/** The size of the occluder lookup table. Both backends use the same table. */
export const LOOKUP_TABLE_SIZE = {
  directionResolution: 24,
  radiusResolution: 16
} as const;
