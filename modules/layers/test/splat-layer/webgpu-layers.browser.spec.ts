// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, inject, it} from 'vitest';

import {SplatLayer} from '../../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

async function renderSplatLayer(type: 'webgl' | 'webgpu'): Promise<void> {
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
        reject(new Error(`Timed out while rendering SplatLayer with ${type}.`));
      }, 30_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        _animate: true,
        views: new MapView({id: 'tree-webgpu-test'}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 18, pitch: 45},
        layers: [
          new SplatLayer({
            id: `splats-${type}`,
            data: [{position: [0, 0] as [number, number]}],
            source: {
              positions: new Float32Array([0, 0, 0, 0.4, 0, 0.2]),
              scales: new Float32Array([1.2, 0.3, 0.25, 0.4, 0.25, 0.1]),
              rotations: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
              colors: new Uint8Array([80, 180, 60, 255, 120, 200, 80, 255]),
              opacities: new Float32Array([0.85, 0.9])
            },
            getTranslation: [0, 0, 5],
            getDeformation: [10, 0.7, 1],
            deformationStrength: 0.025,
            deformationTime: 1.25,
            maxRenderPixels: 64 * 64,
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

describe('SplatLayer graphics backend compatibility', () => {
  it('renders prepared anisotropic Gaussians with deformation on WebGL2', async () => {
    await renderSplatLayer('webgl');
  }, 40_000);

  it('renders prepared anisotropic Gaussians with deformation on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderSplatLayer('webgpu');
  }, 40_000);
});
