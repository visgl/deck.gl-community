// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {PathOutlineLayer} from '../../src/path-outline-layer/path-outline-layer';

import type {Parameters} from '@luma.gl/core';

type PathOutlineDrawHarness = PathOutlineLayer & {
  context: any;
  props: any;
  setShaderModuleProps: ReturnType<typeof vi.fn>;
  state: any;
};

const DRAW_PROPS = {
  billboard: false,
  capRounded: false,
  id: 'path-outline',
  jointRounded: false,
  miterLimit: 4,
  widthMaxPixels: Number.MAX_SAFE_INTEGER,
  widthMinPixels: 0,
  widthScale: 1,
  widthUnits: 'pixels'
};

function createDrawHarness(): PathOutlineDrawHarness {
  const shadowRenderPass = {end: vi.fn()};
  const layer = Object.create(PathOutlineLayer.prototype) as PathOutlineDrawHarness;
  layer.props = DRAW_PROPS;
  layer.context = {
    device: {
      beginRenderPass: vi.fn(() => shadowRenderPass)
    },
    renderPass: {},
    viewport: {height: 120, width: 240}
  };
  layer.setShaderModuleProps = vi.fn();
  layer.state = {
    model: {
      draw: vi.fn(),
      setParameters: vi.fn(),
      shaderInputs: {
        setProps: vi.fn()
      }
    },
    outlineEmptyTexture: {},
    outlineFramebuffer: {
      colorAttachments: [{texture: {}}],
      resize: vi.fn()
    }
  };
  return layer;
}

describe('PathOutlineLayer', () => {
  it('preserves deck picking blend parameters in the main pass', () => {
    const layer = createDrawHarness();
    const pickingParameters = {
      blend: true,
      blendAlphaSrcFactor: 'constant',
      blendColorSrcFactor: 'one'
    } as Parameters;

    layer.draw({parameters: pickingParameters});

    expect(layer.state.model.setParameters).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        blend: true,
        blendAlphaSrcFactor: 'one',
        blendColorSrcFactor: 'one'
      })
    );
    expect(layer.state.model.setParameters).toHaveBeenNthCalledWith(2, pickingParameters);
  });

  it('restores outline screen render parameters outside picking', () => {
    const layer = createDrawHarness();
    const screenParameters = {
      blend: true,
      cullMode: 'back'
    } as Parameters;

    layer.draw({parameters: screenParameters});

    expect(layer.state.model.setParameters).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        blend: false,
        cullMode: 'back',
        depthCompare: 'always',
        depthWriteEnabled: false
      })
    );
  });
});
