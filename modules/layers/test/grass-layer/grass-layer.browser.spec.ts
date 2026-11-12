// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrbitView} from '@deck.gl/core';
import {Buffer, Texture, luma} from '@luma.gl/core';
import {type WebGLDevice, webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {expect, it} from 'vitest';
import {GrassLayer} from '../../src/grass-layer/grass-layer';
import {requireWebGPUAdapter} from '../webgpu-test-utils';

const SIZE = 128;

it.for(['webgl', 'webgpu'] as const)(
  'renders deterministic, animated and pickable grass patches on %s',
  async (backend, {skip}) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    const parent = document.createElement('div');
    document.body.append(parent);
    const errors: string[] = [];
    const device = await luma.createDevice({
      type: backend,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container: parent, width: SIZE, height: SIZE, useDevicePixels: false},
      onError: error => errors.push(error.message)
    });
    const texture = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    const target = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [texture],
      depthStencilAttachment: 'depth24plus'
    });
    const readback =
      backend === 'webgpu'
        ? device.createBuffer({
            byteLength: SIZE * SIZE * 4,
            usage: Buffer.COPY_DST | Buffer.MAP_READ
          })
        : null;
    async function readPixels() {
      if (!readback) return (device as WebGLDevice).readPixelsToArrayWebGL(target) as Uint8Array;
      device.submit();
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({
        sourceTexture: texture,
        destinationBuffer: readback,
        bytesPerRow: SIZE * 4,
        width: SIZE,
        height: SIZE
      });
      device.submit(encoder.finish());
      return new Uint8Array(await readback.readAsync());
    }

    const rows = [
      {position: [-1.2, 0, 0] as const, density: 1},
      {position: [1.2, 0, 0] as const, density: 0}
    ];
    function layer(windTime: number, windStrength = 0) {
      return new GrassLayer<(typeof rows)[number]>({
        id: 'test-grass',
        data: rows,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: d => d.position,
        getSize: [1.5, 1.5],
        getHeight: 0.48,
        getBladeWidth: 0.09,
        getDensity: d => d.density,
        getSeed: 13,
        getColor: [65, 183, 43, 255],
        bladesPerPatch: 128,
        windTime,
        windStrength,
        pickable: true
      });
    }

    let draws = 0;
    const deck = new Deck({
      _framebuffer: target,
      device,
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      views: new OrbitView({orbitAxis: 'Z', fovy: 45}),
      initialViewState: {target: [0, 0, 0.15], zoom: 4.6, rotationX: 42, rotationOrbit: 0},
      layers: [layer(0)],
      onAfterRender: () => {
        draws++;
      },
      onError: error => {
        errors.push(error.message);
      }
    });
    try {
      await expect.poll(() => draws, {timeout: 10_000}).toBeGreaterThan(0);
      const still = await readPixels();
      const visible: number[] = [];
      for (let i = 0; i < SIZE * SIZE; i++) {
        const p = i * 4;
        if (still[p + 1] > 50 && still[p + 1] > still[p] * 2) visible.push(i);
      }
      expect(visible.length).toBeGreaterThan(100);
      expect(visible.every(i => i % SIZE < SIZE / 2)).toBe(true);

      const pixel = visible[Math.floor(visible.length / 2)];
      const row = Math.floor(pixel / SIZE);
      expect(
        (
          await deck.pickObjectAsync({
            x: pixel % SIZE,
            y: readback ? row : SIZE - 1 - row,
            radius: 2
          })
        )?.object
      ).toBe(rows[0]);

      async function render(time: number, strength: number) {
        const before = draws;
        deck.setProps({layers: [layer(time, strength)]});
        await expect.poll(() => draws).toBeGreaterThan(before);
        return readPixels();
      }

      const frozen = await render(1.5, 0);
      expect(frozen.every((byte, index) => byte === still[index])).toBe(true);
      const moving = await render(0.25, 0.8);
      const later = await render(1.5, 0.8);
      expect(moving.filter((byte, index) => byte !== later[index]).length).toBeGreaterThan(100);
      expect(errors).toEqual([]);
    } finally {
      deck.finalize();
      readback?.destroy();
      target.destroy();
      texture.destroy();
      device.destroy();
      parent.remove();
    }
  },
  45_000
);
