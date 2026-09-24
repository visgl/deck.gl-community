// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {BlockLayer} from '../src/layers/block-layer/block-layer';
import blockLayerVertexShader from '../src/layers/block-layer/block-layer-vertex.glsl';
import blockLayerWebgpuShader from '../src/layers/block-layer/block-layer.wgsl';

describe('BlockLayer dense rectangle controls', () => {
  it('defaults to the existing visual behavior', () => {
    const defaults = BlockLayer.defaultProps as Record<string, unknown>;

    expect(defaults.widthMaxPixels).toMatchObject({value: Number.MAX_SAFE_INTEGER});
    expect(defaults.widthCutoffPixels).toMatchObject({value: 0});
    expect(defaults.strokeOffset).toMatchObject({value: 0});
    expect(defaults.getOpacity).toMatchObject({value: 1});
    expect(defaults.getColorOverride).toMatchObject({value: 0});
    expect(defaults.overrideColor).toMatchObject({value: [0, 0, 0, 255]});
  });

  it('keeps width clamps and cutoff behavior aligned across WebGL2 and WebGPU', () => {
    expect(blockLayerVertexShader).toContain(
      'float effectiveWidthMaxPixels = min(blockLayer.widthMaxPixels, blockLayer.sizeMaxPixels);'
    );
    expect(blockLayerVertexShader).toContain(
      'bool widthBelowCutoff = abs(pixelSize.x) < blockLayer.widthCutoffPixels;'
    );
    expect(blockLayerWebgpuShader).toContain(
      'let effectiveWidthMaxPixels = min(blockLayer.widthMaxPixels, blockLayer.sizeMaxPixels);'
    );
    expect(blockLayerWebgpuShader).toContain(
      'let widthBelowCutoff = abs(pixelSize.x) < blockLayer.widthCutoffPixels;'
    );
  });

  it('keeps stroke alignment behavior aligned across WebGL2 and WebGPU', () => {
    expect(blockLayerVertexShader).toContain(
      'vec2 strokePadding = vec2(lineWidth * blockLayer.strokeOffset);'
    );
    expect(blockLayerVertexShader).toContain(
      'project_pixel_size(unitPosition * pixelSize - strokePadding)'
    );
    expect(blockLayerWebgpuShader).toContain(
      'let strokePadding = vec2<f32>(lineWidth * blockLayer.strokeOffset);'
    );
    expect(blockLayerWebgpuShader).toContain(
      'project_pixel_size_vec2(attributes.positions.xy * pixelSize - strokePadding)'
    );
  });

  it('keeps opacity and replacement-color behavior aligned across WebGL2 and WebGPU', () => {
    expect(blockLayerVertexShader).toContain(
      'instanceFillColors.a * instanceOpacities * layer.opacity'
    );
    expect(blockLayerVertexShader).toContain(
      'mix(instanceFillColors.rgb, blockLayer.overrideColor.rgb, instanceColorOverrides)'
    );
    expect(blockLayerWebgpuShader).toContain(
      'attributes.instanceFillColors.a * attributes.instanceOpacities * layer.opacity'
    );
    expect(blockLayerWebgpuShader).toContain('blockLayer.overrideColor.rgb');
    expect(blockLayerWebgpuShader).toContain('attributes.instanceColorOverrides');
  });
});
