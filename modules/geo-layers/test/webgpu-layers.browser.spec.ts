// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {GlobalGridLayer, SharedTile2DHeader, TileGridLayer, type GlobalGrid} from '../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

const TEST_GRID: GlobalGrid = {
  name: 'browser-test-grid',
  hasNumericRepresentation: false,
  cellToLngLat: () => [0, 0],
  cellToBoundary: () => [
    [-28, -20],
    [-4, -20],
    [-4, 4],
    [-28, 4]
  ]
};

function createPortableGeoLayers() {
  const tile = new SharedTile2DHeader({x: 0, y: 0, z: 0});
  tile.bbox = {left: 4, top: -20, right: 28, bottom: 4};

  return [
    new GlobalGridLayer({
      id: 'webgpu-global-grid',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{cellId: 'test-cell'}],
      globalGrid: TEST_GRID,
      filled: true,
      stroked: true,
      getFillColor: [14, 165, 233, 160],
      getLineColor: [3, 105, 161, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      pickable: true
    }),
    new TileGridLayer({
      id: 'webgpu-tile-grid',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      tile,
      showLabel: false,
      borderColor: [245, 158, 11, 255],
      borderWidthMinPixels: 2
    })
  ];
}

async function renderPortableGeoLayers(type: 'webgl' | 'webgpu'): Promise<void> {
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

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out while rendering portable geospatial layers with ${type}.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        views: new OrthographicView({id: 'geo-layers-webgpu-test', flipY: false}),
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers: createPortableGeoLayers(),
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

describe('geospatial graphics backend compatibility', () => {
  it('renders global-grid polygons and tile outlines on WebGL2', async () => {
    await renderPortableGeoLayers('webgl');
  }, 20_000);

  it('renders global-grid polygons and tile outlines on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderPortableGeoLayers('webgpu');
  }, 20_000);
});
