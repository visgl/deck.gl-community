// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, inject, it} from 'vitest';

import {SplatLayer} from '../../src';

class TestDeck extends Deck {
  pause() {
    this.animationLoop?.stop();
  }
  resume() {
    this.animationLoop?.start();
  }
}
async function readFrame(device: Device, texture?: Texture): Promise<Uint8Array> {
  if (device.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    return pixels;
  }
  device.submit();
  const buffer = device.createBuffer({
    byteLength: 128 * 128 * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: texture!,
      destinationBuffer: buffer,
      bytesPerRow: 128 * 4,
      width: 128,
      height: 128
    });
    device.submit(encoder.finish());
    const data = await buffer.readAsync();
    const pixels = new Uint8Array(data.length);
    for (let y = 0; y < 128; y++)
      pixels.set(data.subarray(y * 128 * 4, (y + 1) * 128 * 4), (127 - y) * 128 * 4);
    return pixels;
  } finally {
    buffer.destroy();
  }
}

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

async function renderSplatLayer(
  type: 'webgl' | 'webgpu',
  mode: 'constant' | 'heterogeneous' | 'direct' = 'constant'
): Promise<void> {
  const heterogeneous = mode === 'heterogeneous';
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: TestDeck | undefined;
  let colorTexture: Texture | undefined;
  let framebuffer: Framebuffer | undefined;
  let pixels = new Uint8Array();
  let capturing = false;
  const source = {
    positions: new Float32Array([0, 0, 0, 0.4, 0, 0.2]),
    scales: new Float32Array([1.2, 0.3, 0.25, 0.4, 0.25, 0.1]),
    rotations: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
    colors: new Uint8Array([80, 180, 60, 255, 120, 200, 80, 255]),
    opacities: new Float32Array([0.85, 0.9])
  };
  const owner = {position: [0, 0] as [number, number], splats: source};
  const other = {
    position: [0.00003, 0] as [number, number],
    splats: {...source, colors: new Uint8Array([200, 20, 40, 255, 200, 20, 40, 255])}
  };
  let frames = 0;
  let nativeDevice: NativeGpuDevice | undefined;
  const validationErrors: string[] = [];
  const captureValidationError = (event: NativeGpuError): void => {
    validationErrors.push(event.error?.message ?? 'Unknown WebGPU validation error.');
  };

  try {
    device = await luma.createDevice({
      type,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container: parent, width: 128, height: 128, useDevicePixels: false}
    });
    if (type === 'webgpu') {
      colorTexture = device.createTexture({
        width: 128,
        height: 128,
        format: 'rgba8unorm',
        usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
      });
      framebuffer = device.createFramebuffer({
        width: 128,
        height: 128,
        colorAttachments: [colorTexture],
        depthStencilAttachment: 'depth24plus'
      });
      nativeDevice = (device as Device & {handle?: NativeGpuDevice}).handle;
      nativeDevice?.addEventListener('uncapturederror', captureValidationError);
    }

    await new Promise<void>((resolve, reject) => {
      // Cold software shader compilation can exceed 10 seconds on a busy CI host.
      // This gate verifies rendering/validation; hardware frame pacing is measured separately.
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out while rendering SplatLayer with ${type}.`));
      }, 30_000);

      deck = new TestDeck({
        _framebuffer: framebuffer,
        useDevicePixels: false,
        device,
        parent,
        width: 128,
        height: 128,
        _animate: true,
        views: new MapView({id: 'tree-webgpu-test'}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 20, pitch: 0},
        layers: [
          new SplatLayer({
            id: `splats-${type}`,
            data: mode === 'direct' ? source : heterogeneous ? [owner, other] : [owner],
            ...(mode === 'direct' ? {} : {getSource: heterogeneous ? row => row.splats : source}),
            getPosition: mode === 'direct' ? [0, 0] : row => row.position,
            getTransformMatrix: heterogeneous
              ? [1, 0, 0, 0, 0.4, 1.3, 0, 0, 0, 0, 0.7, 0, 0, 0, 5, 1]
              : null,
            transparency: 'weighted',
            getTranslation: [0, 0, 5],
            getDeformation: [10, 0.7, 1],
            deformationStrength: 0.025,
            deformationTime: 1.25,
            maxRenderPixels: 64 * 64,
            pickable: true,
            material: {unlit: true}
          })
        ],
        onAfterRender: () => {
          if (++frames < 8 || capturing) return;
          capturing = true;
          deck!.pause();
          readFrame(device!, colorTexture).then(result => {
            pixels = result;
            let visible = 0;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 30) visible++;
            if (visible > 30) {
              window.clearTimeout(timeout);
              resolve();
            } else {
              capturing = false;
              deck!.resume();
            }
          }, reject);
        },
        onError: error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
    });

    let strongest = 0;
    for (let i = 3; i < pixels.length; i += 4)
      if (
        pixels[i] > pixels[strongest * 4 + 3] &&
        (!heterogeneous || pixels[i - 2] > pixels[i - 3])
      )
        strongest = (i - 3) / 4;
    expect(pixels[strongest * 4 + 1]).toBeGreaterThan(pixels[strongest * 4]);
    const picked = (
      await deck!.pickObjectAsync({x: strongest % 128, y: 127 - Math.floor(strongest / 128)})
    )?.object;
    if (mode === 'direct') expect(picked).toMatchObject({splats: source, position: [0, 0, 0]});
    else expect(picked).toBe(owner);
    await nativeDevice?.queue.onSubmittedWorkDone();
    expect(device.type).toBe(type);
    expect(validationErrors).toEqual([]);
    const stats = (deck!.props.layers[0] as SplatLayer).splatStats;
    expect(stats.sourceCount).toBe(heterogeneous ? 2 : 1);
    if (heterogeneous) {
      expect(stats.renderedSplats).toBe(4);
      const otherPixel = Array.from({length: 128 * 128}, (_, i) => i).find(
        i => pixels[i * 4] > pixels[i * 4 + 1] * 2 && pixels[i * 4 + 3] > 30
      )!;
      expect(otherPixel).toBeDefined();
      expect(
        (await deck!.pickObjectAsync({x: otherPixel % 128, y: 127 - Math.floor(otherPixel / 128)}))
          ?.object
      ).toBe(other);
    }
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    framebuffer?.destroy();
    colorTexture?.destroy();
    device?.destroy();
    parent.remove();
  }
}

describe('SplatLayer graphics backend compatibility', () => {
  it('renders prepared anisotropic Gaussians with deformation on WebGL2', async () => {
    await renderSplatLayer('webgl');
    await renderSplatLayer('webgl', 'heterogeneous');
    await renderSplatLayer('webgl', 'direct');
  }, 40_000);

  it('renders prepared anisotropic Gaussians with deformation on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderSplatLayer('webgpu');
    await renderSplatLayer('webgpu', 'heterogeneous');
    await renderSplatLayer('webgpu', 'direct');
  }, 40_000);
});
