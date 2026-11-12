// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView, type Layer} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {Buffer, luma, Texture, type Device} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter, type WebGPUDevice} from '@luma.gl/webgpu';
import {expect, test} from 'vitest';
import {RainLayer} from '../../src';
import {requireWebGPUAdapter} from '../webgpu-test-utils';

const SIZE = 128;

async function readFrame(device: Device, color: Texture): Promise<Uint8Array> {
  if (device.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }
  device.submit();
  const buffer = device.createBuffer({
    byteLength: SIZE * SIZE * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: color,
      destinationBuffer: buffer,
      bytesPerRow: SIZE * 4,
      width: SIZE,
      height: SIZE
    });
    device.submit(encoder.finish());
    return new Uint8Array(await buffer.readAsync());
  } finally {
    buffer.destroy();
  }
}

function opaquePlane(id: string, elevation: number): Layer {
  return new SolidPolygonLayer({
    id,
    data: [
      [
        [-100, -100, elevation],
        [100, -100, elevation],
        [100, 100, elevation],
        [-100, 100, elevation]
      ]
    ],
    getPolygon: polygon => polygon,
    getFillColor: [0, 120, 180],
    parameters: {depthCompare: 'less-equal', depthWriteEnabled: true, cullMode: 'none'}
  });
}

test.for(['webgl', 'webgpu'] as const)(
  'renders seeded periodic rain and preserves scene depth on %s',
  async (backend, {skip}) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    const parent = document.createElement('div');
    parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
    document.body.append(parent);
    const device = await luma.createDevice({
      type: backend,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container: parent, width: SIZE, height: SIZE, useDevicePixels: false}
    });
    const errors: string[] = [];
    if (backend === 'webgpu') {
      (device as WebGPUDevice).handle.addEventListener('uncapturederror', event => {
        errors.push(event.error.message);
      });
    }
    const color = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    const framebuffer = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [color],
      depthStencilAttachment: 'depth24plus'
    });
    const deck = new Deck({
      device,
      _framebuffer: backend === 'webgpu' ? framebuffer : undefined,
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      _animate: true,
      views: new OrbitView({orbitAxis: 'Z'}),
      initialViewState: {target: [0, 0, 0], zoom: 0, rotationX: 35, rotationOrbit: 25}
    });

    function render(
      time: number,
      count = 256,
      {before = [], after = []}: {before?: Layer[]; after?: Layer[]} = {}
    ): Promise<Uint8Array> {
      const layer = new RainLayer({
        id: 'rain',
        position: [0, 0, 0],
        size: [128, 120, 64],
        velocity: [8, 0, -16],
        exposure: 0.25,
        color: [240, 160, 80, 220],
        count,
        time,
        seed: 7
      });
      const layers = [...before, layer, ...after];
      return new Promise((resolve, reject) => {
        let captured = false;
        deck.setProps({
          layers,
          onError: reject,
          onAfterRender: () => {
            if (captured) return;
            const models = layers.flatMap(layer => layer.getModels());
            if (errors.length || models.some(model => model.pipeline.isErrored)) {
              reject(new Error(errors.join('\n') || 'RainLayer pipeline failed'));
              return;
            }
            if (backend === 'webgpu' && models.some(model => model.pipeline.isPending)) return;
            captured = true;
            readFrame(device, color).then(resolve, reject);
          }
        });
      });
    }

    try {
      const initial = await render(0);
      expect(
        initial.filter((channel, index) => index % 4 === 0 && channel > 32).length
      ).toBeGreaterThan(40);
      // Each moving axis has completed a whole number of periods after sixteen seconds.
      const wrapped = await render(16);
      expect(wrapped.every((channel, index) => channel === initial[index])).toBe(true);
      const moved = await render(0.7);
      expect(moved.some((channel, index) => channel !== initial[index])).toBe(true);
      const disabled = await render(0, 0);
      expect(disabled.every((channel, index) => index % 4 === 3 || channel === 0)).toBe(true);
      deck.setProps({
        views: new OrbitView({orbitAxis: 'Z', orthographic: true}),
        initialViewState: {target: [0, 0, 0], zoom: 0, rotationX: 90, rotationOrbit: 0}
      });
      const topDownRain = await render(0);
      expect(topDownRain.some((channel, index) => index % 4 === 0 && channel > 32)).toBe(true);

      // A plane above the entire volume occludes rain drawn after it.
      const foreground = opaquePlane('foreground', 50);
      const foregroundOnly = await render(0, 0, {before: [foreground]});
      const foregroundAndRain = await render(0, 256, {before: [foreground]});
      expect(foregroundAndRain.every((channel, index) => channel === foregroundOnly[index])).toBe(
        true
      );

      // A plane below the volume can still render when it is drawn after rain.
      const background = opaquePlane('background', -50);
      const backgroundOnly = await render(0, 0, {after: [background]});
      const rainThenBackground = await render(0, 256, {after: [background]});
      expect(rainThenBackground.every((channel, index) => channel === backgroundOnly[index])).toBe(
        true
      );
      expect(errors).toEqual([]);
    } finally {
      deck.finalize();
      framebuffer.destroy();
      color.destroy();
      device.destroy();
      parent.remove();
    }
  },
  30_000
);
