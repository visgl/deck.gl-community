// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, MapView} from '@deck.gl/core';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, inject, it} from 'vitest';

import {TreeLayer} from '../../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

async function readFrame(
  device: Device,
  texture: Texture,
  framebuffer: Framebuffer
): Promise<Uint8Array> {
  if (device.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = (device as WebGLDevice).readPixelsToArrayWebGL(framebuffer) as Uint8Array;
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
      sourceTexture: texture,
      destinationBuffer: buffer,
      bytesPerRow: 128 * 4,
      width: 128,
      height: 128
    });
    device.submit(encoder.finish());
    return new Uint8Array(await buffer.readAsync());
  } finally {
    buffer.destroy();
  }
}

type CanopyMetrics = {greenPixels: number; meanAlpha: number};

function getCanopyMetrics(pixels: Uint8Array): CanopyMetrics {
  let greenPixels = 0;
  let alpha = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const [red, green, blue, opacity] = pixels.subarray(index, index + 4);
    if (opacity > 16 && green > red * 1.2 && green > blue * 1.4) {
      greenPixels++;
      alpha += opacity;
    }
  }
  return {greenPixels, meanAlpha: alpha / Math.max(1, greenPixels)};
}

async function renderDenseCanopy(type: 'webgl' | 'webgpu'): Promise<CanopyMetrics> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: Deck | undefined;
  let colorTexture: Texture | undefined;
  let framebuffer: Framebuffer | undefined;
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
    if (type === 'webgpu') {
      nativeDevice = (device as Device & {handle?: NativeGpuDevice}).handle;
      nativeDevice?.addEventListener('uncapturederror', captureValidationError);
    }

    const pixels = await new Promise<Uint8Array>((resolve, reject) => {
      let frames = 0;
      let capturing = false;
      const timeout = window.setTimeout(
        () => reject(new Error(`Timed out while rendering dense TreeLayer canopy with ${type}.`)),
        30_000
      );
      deck = new Deck({
        _framebuffer: framebuffer,
        useDevicePixels: false,
        device,
        parent,
        width: 128,
        height: 128,
        _animate: true,
        views: new MapView({id: 'dense-canopy', nearZMultiplier: 0.02}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 19, pitch: 72, bearing: 20},
        layers: [
          new TreeLayer({
            id: `dense-canopy-${type}`,
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [0, 0, 0],
            data: Array.from({length: 4}, (_, index) => ({
              position: [((index % 2) - 0.5) * 2, (Math.floor(index / 2) - 0.5) * 2] as [
                number,
                number
              ],
              species: 'citrus' as const,
              season: 'summer' as const,
              height: 4.8,
              crownRadius: 2.4,
              trunkRadius: 0.1,
              wind: false,
              canopyColor: [33, 112, 29, 255] as [number, number, number, number]
            })),
            getTree: datum => datum,
            // One coarse cluster per visible crown forces TreeLayer's hierarchy representation,
            // whose sources carry opticalDepths rather than the authored leaf opacities.
            maxCanopySplats: 4,
            maxCanopyPixels: Infinity
          })
        ],
        onAfterRender: () => {
          if (++frames < 12 || capturing) return;
          capturing = true;
          readFrame(device!, colorTexture!, framebuffer!).then(
            result => {
              window.clearTimeout(timeout);
              resolve(result);
            },
            error => {
              window.clearTimeout(timeout);
              reject(error);
            }
          );
        },
        onError: error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
    });

    await nativeDevice?.queue.onSubmittedWorkDone();
    expect(device.type).toBe(type);
    expect(validationErrors).toEqual([]);
    return getCanopyMetrics(pixels);
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    framebuffer?.destroy();
    colorTexture?.destroy();
    device?.destroy();
    parent.remove();
  }
}

async function renderTreeLayer(type: 'webgl' | 'webgpu'): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: Deck | undefined;
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
      createCanvasContext: {container: parent}
    });
    if (type === 'webgpu') {
      nativeDevice = (device as Device & {handle?: NativeGpuDevice}).handle;
      nativeDevice?.addEventListener('uncapturederror', captureValidationError);
    }

    await new Promise<void>((resolve, reject) => {
      // Cold software shader compilation can exceed 10 seconds on a busy CI host.
      // This gate verifies rendering/validation; hardware frame pacing is measured separately.
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out while rendering TreeLayer with ${type}.`));
      }, 30_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        _animate: true,
        views: new MapView({id: 'tree-webgpu-test'}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 15, pitch: 45},
        layers: [
          new TreeLayer({
            id: `tree-${type}`,
            // Tree Lab uses local metre coordinates under MapView. In WebGPU, the first
            // TreeMesh pipeline must support its high/low position layout without exceeding
            // the device's eight-vertex-buffer limit.
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [0, 0, 0],
            data: (
              ['pine', 'oak', 'palm', 'birch', 'cherry', 'banyan', 'mangrove', 'citrus'] as const
            ).flatMap((species, i) =>
              (['summer', 'winter'] as const).map(season => ({
                position: [i * 12, 0] as [number, number],
                species,
                season
              }))
            ),
            getTree: datum => ({
              position: datum.position,
              species: datum.species,
              season: datum.season,
              height: 12,
              wind: true,
              characteristics: {seed: 19, branchLift: 0.8, leafSize: 1.1},
              crop: {
                kind:
                  datum.species === 'citrus'
                    ? 'lemon'
                    : datum.species === 'pine'
                      ? 'cone'
                      : 'fruit',
                color: [210, 70, 40, 255],
                count: 2,
                droppedCount: 1,
                radius: 0.05
              }
            }),
            maxCanopyPixels: 64 * 64,
            windTime: 1.25,
            pickable: true
          })
        ],
        onAfterRender: () => {
          if (++frames < 8) return;
          window.clearTimeout(timeout);
          resolve();
        },
        onError: error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
    });

    await nativeDevice?.queue.onSubmittedWorkDone();
    expect(device.type).toBe(type);
    expect(validationErrors).toEqual([]);
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    device?.destroy();
    parent.remove();
  }
}

describe('TreeLayer graphics backend compatibility', () => {
  it('renders connected mesh wood and Gaussian foliage on WebGL2', async () => {
    await renderTreeLayer('webgl');
  }, 40_000);

  it('renders connected mesh wood and Gaussian foliage on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderTreeLayer('webgpu');
  }, 40_000);

  it('keeps a dense hierarchical canopy opaque on both WebGL2 and WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }

    const webgl = await renderDenseCanopy('webgl');
    const webgpu = await renderDenseCanopy('webgpu');
    expect(webgl.greenPixels).toBeGreaterThan(100);
    expect(webgl.meanAlpha).toBeGreaterThan(100);
    expect(webgpu.greenPixels).toBeGreaterThan(webgl.greenPixels * 0.85);
    expect(webgpu.meanAlpha).toBeGreaterThan(webgl.meanAlpha * 0.9);
    expect(webgpu.meanAlpha).toBeLessThan(webgl.meanAlpha * 1.1);
  }, 60_000);
});
