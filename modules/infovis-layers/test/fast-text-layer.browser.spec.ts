// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {releaseBrowserTestDevice} from '../../../test/browser-test-device';
import {FastTextLayer} from '../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

async function renderFastText(type: 'webgl' | 'webgpu', sdf: boolean): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: Deck<OrthographicView> | undefined;
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

    const layer = new FastTextLayer({
      id: `fast-text-${type}-${sdf ? 'sdf' : 'bitmap'}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{text: 'WebGPU', position: [0, 0]}],
      characterSet: 'WebGPU',
      fontSettings: {fontSize: 32, sdf},
      size: 24,
      getColor: [37, 99, 235, 255],
      textAnchor: 'middle',
      alignmentBaseline: 'center'
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out rendering ${type} ${sdf ? 'SDF' : 'bitmap'} fast text.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        views: new OrthographicView({id: 'fast-text-test', flipY: false}),
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers: [layer],
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
    expect(layer.state.glyphData?.length).toBe(6);
    expect(layer.state.atlasTexture?.mipLevels).toBeGreaterThan(1);
    expect(layer.state.model).toBeDefined();
    expect(validationErrors).toEqual([]);
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    releaseBrowserTestDevice(device);
    parent.remove();
  }
}

describe('FastTextLayer graphics backend compatibility', () => {
  it('renders bitmap and signed-distance-field text on WebGL2', async () => {
    await renderFastText('webgl', false);
    await renderFastText('webgl', true);
  }, 25_000);

  it('renders bitmap and signed-distance-field text on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderFastText('webgpu', false);
    await renderFastText('webgpu', true);
  }, 25_000);
});
