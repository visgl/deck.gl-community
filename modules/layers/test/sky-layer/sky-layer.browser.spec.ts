// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, FirstPersonView, type Layer} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {Buffer, Texture, luma, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {expect, test} from 'vitest';
import {SkyLayer} from '../../src';
import {requireWebGPUAdapter} from '../webgpu-test-utils';

const SIZE = 64;

async function readPixels(
  device: Device,
  framebuffer: Framebuffer,
  texture: Texture
): Promise<Uint8Array> {
  if (device.type === 'webgl') {
    return (device as WebGLDevice).readPixelsToArrayWebGL(framebuffer) as Uint8Array;
  }
  const buffer = device.createBuffer({
    byteLength: SIZE * SIZE * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: texture,
      destinationBuffer: buffer,
      bytesPerRow: SIZE * 4,
      width: SIZE,
      height: SIZE
    });
    device.submit(encoder.finish());
    return await buffer.readAsync();
  } finally {
    buffer.destroy();
  }
}

test.for(['webgl', 'webgpu'] as const)(
  'renders the sun behind opaque geometry on %s',
  {timeout: 30000},
  async (type, {skip}) => {
    if (type === 'webgpu') await requireWebGPUAdapter(skip);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let device: Device | undefined;
    let texture: Texture | undefined;
    let framebuffer: Framebuffer | undefined;
    let deck: Deck<FirstPersonView> | undefined;
    const datum = {position: [-3.3, 10, 4.45] as [number, number, number]};
    const foreground = new ScatterplotLayer({
      id: 'foreground',
      data: [datum],
      getPosition: d => d.position,
      getRadius: 3,
      radiusUnits: 'pixels',
      getFillColor: [28, 218, 64, 255],
      pickable: true
    });
    const getLayers = (sunDirection: [number, number, number]): Layer[] => [
      foreground,
      new SkyLayer({id: 'sky', sunDirection})
    ];
    const errors: unknown[] = [];
    let capture: (() => void) | undefined;
    let failCapture: ((error: unknown) => void) | undefined;
    try {
      device = await luma.createDevice({
        type,
        adapters: [webgl2Adapter, webgpuAdapter],
        createCanvasContext: {container: parent, width: SIZE, height: SIZE, useDevicePixels: false}
      });
      texture = device.createTexture({
        width: SIZE,
        height: SIZE,
        format: 'rgba8unorm',
        usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
      });
      framebuffer = device.createFramebuffer({
        width: SIZE,
        height: SIZE,
        colorAttachments: [texture],
        depthStencilAttachment: 'depth24plus'
      });
      const firstFrame = new Promise<void>((resolve, reject) => {
        capture = resolve;
        failCapture = reject;
      });
      deck = new Deck({
        _framebuffer: framebuffer,
        device,
        parent,
        width: SIZE,
        height: SIZE,
        useDevicePixels: false,
        views: new FirstPersonView({id: 'camera'}),
        initialViewState: {position: [0, 0, 0], bearing: 0, pitch: -24},
        layers: getLayers([0, 1, 0.445]),
        onAfterRender: () => {
          const done = capture;
          capture = undefined;
          failCapture = undefined;
          done?.();
        },
        onError: error => {
          errors.push(error);
          failCapture?.(error);
        }
      });
      await firstFrame;
      const sun = await readPixels(device, framebuffer, texture);
      const nextFrame = new Promise<void>((resolve, reject) => {
        capture = resolve;
        failCapture = reject;
      });
      deck.setProps({layers: getLayers([0, -1, 0.445])});
      await nextFrame;
      const away = await readPixels(device, framebuffer, texture);
      const pixel = (image: Uint8Array, x: number, y: number) =>
        Array.from(image.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4));
      const markerX = Math.floor(deck.getViewports()[0].project(datum.position)[0]);
      expect(pixel(sun, markerX, 32)).toEqual([28, 218, 64, 255]);
      expect(pixel(away, markerX, 32)).toEqual([28, 218, 64, 255]);
      // The nearby solar glow should brighten the sky without changing the foreground.
      expect(pixel(sun, 36, 32)[0]).toBeGreaterThan(pixel(away, 36, 32)[0] + 10);
      expect(pixel(away, 36, 32)[3]).toBe(255);
      expect(pixel(away, 36, 32)[2]).toBeGreaterThan(pixel(away, 36, 32)[0]);
      const picked = await deck.pickObjectAsync({x: markerX, y: 32});
      expect(picked?.object).toEqual(datum);
      expect(device.type).toBe(type);
      expect(errors).toEqual([]);
    } finally {
      deck?.finalize();
      framebuffer?.destroy();
      texture?.destroy();
      device?.destroy();
      parent.remove();
    }
  }
);
