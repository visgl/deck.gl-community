// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {AmbientLight, Deck, DirectionalLight, LightingEffect} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {describe, expect, it} from 'vitest';
import {
  SIZE,
  ORBIT_VIEW,
  ORBIT_STATE,
  MAGENTA,
  CropFixture,
  TREE,
  fruit,
  mount,
  trees,
  isMagenta,
  countCrop,
  cropLayers
} from './tree-crop-test-utils';

describe('TreeLayer crop mesh rendering', () => {
  it.each([
    'fruit',
    'lemon',
    'cone',
    'acorn',
    'catkin',
    'propagule',
    'flower'
  ] as const)('renders %s at every mesh level, and in the shadow pass', async kind => {
    const scene = mount({
      effects: [
        new LightingEffect({
          ambient: new AmbientLight({intensity: 0.6}),
          sun: new DirectionalLight({direction: [1, 0.3, -1], intensity: 1.2, _shadow: true})
        })
      ]
    });
    const tree = {...TREE, crop: {kind, color: MAGENTA, count: 200, radius: 0.09}};
    const data = [tree];
    const seen: Record<string, number> = {};
    for (const [zoom, lodBias] of [
      [9.2, 0],
      [7, 0],
      [6.2, -1],
      [4.7, 1],
      [2.5, 1],
      [0.5, 1]
    ] as const) {
      scene.setViewState({...ORBIT_STATE, zoom});
      const pixels = await scene.render([trees(tree, {lodBias}, data, CropFixture)]);
      for (const layer of cropLayers(scene)) {
        if ((layer.props.data as unknown as {length: number}).length) {
          seen[layer.id.split('-').at(-1) as string] = countCrop(pixels);
        }
      }
      expect(scene.errors).toEqual([]);
      expect(scene.glErrors).toEqual([]);
    }
    // A close view takes a finer level than a far one, and every level shows something.
    expect(Object.keys(seen).length).toBeGreaterThanOrEqual(2);
    for (const pixels of Object.values(seen)) expect(pixels).toBeGreaterThan(0);
  }, 120000);

  it('sizes its levels and dots in CSS pixels, whatever the device pixel ratio', async () => {
    const draw = async (useDevicePixels: number) => {
      const parent = document.createElement('div');
      parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
      document.body.append(parent);
      let share: number | undefined;
      const deck = new Deck({
        parent,
        width: SIZE,
        height: SIZE,
        useDevicePixels,
        deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
        views: ORBIT_VIEW as never,
        viewState: {...ORBIT_STATE, zoom: 5.4} as never,
        layers: [trees({...TREE, crop: fruit({count: 120, radius: 0.09})}, {lodBias: 0})],
        onAfterRender({gl}) {
          if (share !== undefined) return;
          const {drawingBufferWidth: width, drawingBufferHeight: height} = gl;
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let count = 0;
          for (let i = 0; i < width * height; i++) if (isMagenta(pixels, i * 4)) count++;
          share = count / (width * height);
        }
      });
      try {
        await expect.poll(() => share, {timeout: 60000}).toBeDefined();
        return share!;
      } finally {
        deck.finalize();
        parent.remove();
      }
    };
    const one = await draw(1);
    const two = await draw(2);
    expect(one).toBeGreaterThan(0.002);
    expect(two / one).toBeGreaterThan(0.85);
    expect(two / one).toBeLessThan(1.15);
  }, 120000);
});
