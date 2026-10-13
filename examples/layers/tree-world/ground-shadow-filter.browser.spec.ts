// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Value: protects=small shadow gaps blend while large openings remain lit;
// fails_when=coverage filtering leaves hard holes or binds textures replaced during resize;
// why_new=thin-leaf PCF checks do not exercise the reusable ground mask; seam=none

import type {Texture} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {GroundShadowFilter} from './ground-shadow-filter';

it('softens edges and small gaps without filling large openings, including after resize', async () => {
  const canvas = document.createElement('canvas');
  const device = await webgl2Adapter.create({createCanvasContext: {canvas, autoResize: false}});
  const filter = new GroundShadowFilter(device);
  const textures: Texture[] = [];
  let previousMap: Texture | undefined;
  try {
    for (const width of [128, 256]) {
      const height = 64;
      const depths = new Float32Array(width * height).fill(1);
      const scale = width / 128;
      for (let y = 0; y < height; y++) {
        for (let x = 16 * scale; x < 80 * scale; x++) {
          if (x < 48 * scale || x >= 50 * scale) depths[y * width + x] = 0.5;
        }
      }
      const depth = device.createTexture({
        format: 'depth32float',
        width,
        height,
        data: depths,
        sampler: {
          type: 'comparison-sampler',
          compare: 'less-equal',
          minFilter: 'linear',
          magFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        }
      });
      textures.push(depth);
      await expect
        .poll(
          () => {
            filter.render(depth, [0, 0, 0.8, 0.001], [2 / 128, 2 / 64]);
            return filter.ready;
          },
          {timeout: 15000}
        )
        .toBe(true);
      const map = filter.map;
      if (previousMap) expect(previousMap.destroyed).toBe(true);
      previousMap = map;
      expect([map.width, map.height]).toEqual([width / 2, height / 2]);
      const pixels = device.readPixelsToArrayWebGL(map) as Uint8Array;
      const value = (x: number) => pixels[(16 * map.width + Math.floor((x * scale) / 2)) * 4] / 255;
      expect(value(32)).toBeGreaterThan(0.98);
      expect(value(49), 'the narrow gap keeps blended shadow coverage').toBeGreaterThan(0.65);
      expect(value(49)).toBeLessThan(0.95);
      expect(value(100), 'the large opening remains lit').toBeLessThan(0.02);
      const edge = Array.from({length: 12}, (_, x) => value(8 + x * 2));
      expect(edge.some(coverage => coverage > 0.1 && coverage < 0.9)).toBe(true);
      for (let x = 1; x < edge.length; x++) {
        expect(edge[x] - edge[x - 1]).toBeGreaterThanOrEqual(-1 / 255);
        expect(edge[x] - edge[x - 1]).toBeLessThan(0.45);
      }
      expect(device.gl.getError()).toBe(device.gl.NO_ERROR);
    }
  } finally {
    filter.destroy();
    for (const texture of textures) texture.destroy();
    device.destroy();
  }
});
