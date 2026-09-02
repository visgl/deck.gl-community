// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {BlockLayer} from '../src/layers/block-layer/block-layer';
import blockLayerVertexShader from '../src/layers/block-layer/block-layer-vertex.glsl';

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

  it('applies width clamps and cutoff behavior in WebGL2', () => {
    expect(blockLayerVertexShader).toContain(
      'float effectiveWidthMaxPixels = min(block.widthMaxPixels, block.sizeMaxPixels);'
    );
    expect(blockLayerVertexShader).toContain(
      'bool widthBelowCutoff = abs(pixelSize.x) < block.widthCutoffPixels;'
    );
  });

  it('applies stroke alignment behavior in WebGL2', () => {
    expect(blockLayerVertexShader).toContain('pixelSize.x < 0.0 ? -1.0 : 1.0');
    expect(blockLayerVertexShader).toContain('pixelSize.y < 0.0 ? -1.0 : 1.0');
    expect(blockLayerVertexShader).toContain(
      'vec2 strokePadding = strokeDirection * lineWidth * block.strokeOffset;'
    );
    expect(blockLayerVertexShader).toContain(
      'project_pixel_size(unitPosition * pixelSize - strokePadding)'
    );
  });

  it('applies opacity and replacement-color behavior in WebGL2', () => {
    expect(blockLayerVertexShader).toContain(
      'instanceFillColors.a * instanceOpacities * layer.opacity'
    );
    expect(blockLayerVertexShader).toContain(
      'mix(instanceFillColors.rgb, block.overrideColor.rgb, instanceColorOverrides)'
    );
  });
});
