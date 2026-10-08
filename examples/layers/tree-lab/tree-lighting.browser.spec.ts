// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {DirectionalLight, type Deck, type EffectContext} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {TreeLightingEffect} from './tree-lighting';

it('installs comparison filtering when shadows are enabled after effect setup', async () => {
  const device = await webgl2Adapter.create({
    createCanvasContext: {canvas: document.createElement('canvas'), autoResize: false}
  });
  const modules: {name: string; fs?: string}[] = [];
  const context = {
    device,
    deck: {
      _addDefaultShaderModule: module => modules.push(module),
      _removeDefaultShaderModule() {}
    } as unknown as Deck
  } as EffectContext;
  const lighting = new TreeLightingEffect({
    key: new DirectionalLight({direction: [-1, -1, -2], _shadow: false})
  });
  try {
    lighting.setup(context);
    expect(modules).toEqual([]);
    lighting.setProps({key: new DirectionalLight({direction: [-1, -1, -2], _shadow: true})});
    expect(modules.at(-1)?.name).toBe('shadow');
    expect(modules.at(-1)?.fs).toContain('sampler2DShadow');
    expect(device.gl.getError()).toBe(device.gl.NO_ERROR);
  } finally {
    lighting.cleanup(context);
    device.destroy();
  }
});
