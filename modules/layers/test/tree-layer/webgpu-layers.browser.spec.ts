// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {TreeLayer} from '../../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

async function renderTreeLayer(type: 'webgl' | 'webgpu'): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: Deck | undefined;
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
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out while rendering TreeLayer with ${type}.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        views: new MapView({id: 'tree-webgpu-test'}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 18, pitch: 45},
        layers: [
          new TreeLayer({
            id: `tree-${type}`,
            data: (['pine', 'oak', 'palm', 'birch', 'cherry'] as const).flatMap((species, i) =>
              (['summer', 'winter'] as const).map(season => ({
                position: [i * 0.00002, 0] as [number, number],
                species,
                season
              }))
            ),
            getPosition: datum => datum.position,
            getTreeType: datum => datum.species,
            getSeason: datum => datum.season,
            getCrop: () => ({color: [210, 70, 40, 255], count: 2, droppedCount: 1, radius: 0.15}),
            windStrength: 0.025,
            windTime: 1.25,
            getHeight: () => 12,
            pickable: true
          })
        ],
        onAfterRender: () => {
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
  it('renders procedural SimpleMeshLayer geometry on WebGL2', async () => {
    await renderTreeLayer('webgl');
  }, 20_000);

  it('renders procedural SimpleMeshLayer geometry on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderTreeLayer('webgpu');
  }, 20_000);
});
