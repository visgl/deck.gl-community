// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {
  createLighting,
  createSceneLayers,
  createSpecimens,
  createViews,
  DEFAULT_OPTIONS,
  VIEW
} from './scene';

it('retains tree pixels and releases planar shadow work when the ground is removed', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:256px;height:256px';
  document.body.append(parent);
  const lighting = createLighting(true);
  const errors: string[] = [];
  let frame = 0,
    opaquePixels = 0;
  const [ground, tree] = createSceneLayers(TreeLayer, 'receiver-toggle', createSpecimens('oak'), {
    ...DEFAULT_OPTIONS,
    shadows: true,
    wind: false,
    crops: false,
    dropped: false
  });
  const deck = new Deck({
    parent,
    width: 256,
    height: 256,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: createViews(),
    initialViewState: VIEW,
    effects: [lighting],
    layers: [ground, tree],
    onError: error => errors.push(error.message),
    onAfterRender: ({gl}) => {
      const pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      opaquePixels = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 10) opaquePixels++;
      if (gl.getError() !== gl.NO_ERROR) errors.push('Tree-only pixel read failed');
      frame++;
    }
  });
  const passes = lighting as unknown as {
    treePasses: unknown[];
    groundFilters: {ready: boolean}[];
    transmissionPasses: unknown[];
  };
  try {
    await expect.poll(() => passes.groundFilters[0]?.ready, {timeout: 15000}).toBe(true);
    const at = frame;
    deck.setProps({layers: [tree]});
    await expect.poll(() => frame, {timeout: 15000}).toBeGreaterThan(at + 3);
    expect(passes.groundFilters).toHaveLength(0);
    expect(passes.transmissionPasses).toHaveLength(0);
    expect(passes.treePasses).toHaveLength(1);
    expect(opaquePixels).toBeGreaterThan(50);
    expect(opaquePixels).toBeLessThan(256 * 256 * 0.3);
    const treePixels = opaquePixels;
    const restoreAt = frame;
    deck.setProps({layers: [ground.clone({}), tree]});
    await expect.poll(() => frame, {timeout: 15000}).toBeGreaterThan(restoreAt + 3);
    await expect.poll(() => passes.groundFilters[0]?.ready, {timeout: 15000}).toBe(true);
    expect(passes.transmissionPasses).toHaveLength(1);
    expect(opaquePixels).toBeGreaterThan(treePixels * 3);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 30000);
