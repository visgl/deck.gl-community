// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {color, getShaderAssembler, picking, project32} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';
import {describe, expect, it} from 'vitest';

import blockSource from '../../infovis-layers/src/layers/block-layer/block-layer.wgsl';
import {blockUniforms} from '../../infovis-layers/src/layers/block-layer/block-layer-uniforms';
import fastTextSource from '../../infovis-layers/src/layers/fast-text-layer/fast-text-layer.wgsl';
import {fastTextUniforms} from '../../infovis-layers/src/layers/fast-text-layer/fast-text-layer';
import windTriangleSource from '../../geo-layers/src/wind-layer/wind-triangle-layer.wgsl';
import horizonSource from '../../timeline-layers/src/layers/horizon-graph-layer/horizon-graph-layer.wgsl';
import {horizonLayerUniforms} from '../../timeline-layers/src/layers/horizon-graph-layer/horizon-graph-layer-uniforms';
import geometrySource from '../src/dependency-arrow-layer/geometry-layer.wgsl';

const WEBGPU_PLATFORM = {
  type: 'webgpu',
  shaderLanguage: 'wgsl',
  shaderLanguageVersion: 300,
  gpu: 'test-webgpu',
  features: new Set<string>()
} as const;

const layerUniforms = {
  name: 'layer',
  source: /* wgsl */ `
struct LayerUniforms {
  opacity: f32,
};

@group(0) @binding(auto) var<uniform> layer: LayerUniforms;
`,
  uniformTypes: {opacity: 'f32'}
} as const satisfies ShaderModule;

const geometryLayerUniforms = {
  name: 'geometryLayer',
  source: '',
  uniformTypes: {
    sizeScale: 'f32',
    sizeUnits: 'i32',
    interpolationMode: 'i32',
    markerAnchor: 'i32'
  }
} as const satisfies ShaderModule;

function assembleWebgpuShader(source: string, modules: ShaderModule[]) {
  return getShaderAssembler('wgsl').assembleWGSLShader({
    source,
    modules: [layerUniforms, ...modules],
    platformInfo: WEBGPU_PLATFORM
  });
}

describe('community WebGPU shaders', () => {
  it('assembles block projection, colors, picking, and uniform bindings', () => {
    const shader = assembleWebgpuShader(blockSource, [project32, color, picking, blockUniforms]);

    expect(shader.source).toContain('fn vertexMain');
    expect(shader.source).toContain('fn fragmentMain');
    expect(shader.source).toContain('project_position_to_clipspace_and_commonspace');
    expect(shader.source).toContain('picking_normalizeColor');
    expect(shader.source).not.toContain('@binding(auto)');
  });

  it('assembles directional marker projection, arc interpolation, and picking', () => {
    const shader = assembleWebgpuShader(geometrySource, [
      project32,
      color,
      picking,
      geometryLayerUniforms
    ]);

    expect(shader.source).toContain('geometry_layer_interpolate');
    expect(shader.source).toContain('geometry_layer_paraboloid');
    expect(shader.source).toContain('picking_normalizeColor');
    expect(shader.source).not.toContain('@binding(auto)');
  });

  it('assembles packed glyph projection, atlas sampling, clipping, and SDF text', () => {
    const shader = assembleWebgpuShader(fastTextSource, [project32, color, fastTextUniforms]);

    expect(shader.source).toContain('fast_text_clip_glyph_vertex');
    expect(shader.source).toContain('textureSample');
    expect(shader.source).toContain('fastText.sdfEnabled');
    expect(shader.source).not.toContain('@binding(auto)');
  });

  it('assembles native wind-triangle projection, colors, and picking', () => {
    const shader = assembleWebgpuShader(windTriangleSource, [project32, color, picking]);

    expect(shader.source).toContain('WindTriangleAttributes');
    expect(shader.source).toContain('project_position_to_clipspace_and_commonspace');
    expect(shader.source).toContain('picking_normalizeColor');
    expect(shader.source).not.toContain('@binding(auto)');
  });

  it('assembles horizon bit-preserving integer texture and uniform bindings', () => {
    const shader = assembleWebgpuShader(horizonSource, [project32, horizonLayerUniforms]);

    expect(shader.source).toContain('texture_2d<u32>');
    expect(shader.source).toContain('textureLoad(dataTexture');
    expect(shader.source).toContain('bitcast<f32>');
    expect(shader.source).toContain('horizonLayer');
    expect(shader.source).not.toContain('@binding(auto)');
  });

  it('assembles bitmap and SDF fast-text atlas, clipping, and alignment bindings', () => {
    const shader = assembleWebgpuShader(fastTextSource, [project32, color, fastTextUniforms]);

    expect(shader.source).toContain('fontAtlasTexture: texture_2d<f32>');
    expect(shader.source).toContain('fontAtlasTextureSampler: sampler');
    expect(shader.source).toContain('textureSample(');
    expect(shader.source).toContain('fast_text_alignment_pixel_offset');
    expect(shader.source).toContain('fast_text_clip_glyph_vertex');
    expect(shader.source).toContain('fastText.sdfEnabled');
    expect(shader.source).toContain('deckgl_premultiplied_alpha');
    expect(shader.source).not.toContain('@binding(auto)');
  });
});
