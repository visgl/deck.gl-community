// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {
  HorizonGraphLayer,
  MultiHorizonGraphLayer,
  VerticalGridLayer
} from '../../../dev/timeline-layers/src';
import {BlockLayer, FastTextLayer, TimeDeltaLayer} from '../../infovis-layers/src';
import {SkyboxLayer} from '../src';
import {GeometryLayer} from '../src/dependency-arrow-layer/geometry-layer';

type BrowserGpu = {
  requestAdapter: () => Promise<unknown>;
};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

function createPortableLayers() {
  return [
    new SkyboxLayer({id: 'webgpu-test-skybox', cubemap: null}),
    new BlockLayer({
      id: 'webgpu-test-block',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{position: [-20, -20, 0], size: [30, 20]}],
      sizeUnits: 'common',
      getPosition: datum => datum.position,
      getSize: datum => datum.size,
      getFillColor: [37, 99, 235, 255],
      getLineColor: [15, 23, 42, 255],
      pickable: true
    }),
    new FastTextLayer({
      id: 'webgpu-test-fast-text-bitmap',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{text: 'GPU', position: [-20, -8]}],
      characterSet: 'GPU',
      fontSettings: {sdf: false, fontSize: 32},
      size: 14,
      getColor: [255, 255, 255, 255]
    }),
    new FastTextLayer({
      id: 'webgpu-test-fast-text-sdf',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{text: 'SDF', position: [5, -8]}],
      characterSet: 'SDF',
      fontSettings: {sdf: true, fontSize: 32},
      size: 14,
      getColor: [15, 23, 42, 255]
    }),
    new GeometryLayer({
      id: 'webgpu-test-marker',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{source: [-25, 10, 0], target: [25, 10, 0]}],
      getSourcePosition: datum => datum.source,
      getTargetPosition: datum => datum.target,
      getColor: [16, 185, 129, 255],
      getSize: [10, 6],
      pickable: true
    }),
    new TimeDeltaLayer({
      id: 'webgpu-test-time-delta',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      header: true,
      startTimeMs: -15,
      endTimeMs: 15,
      y: -25,
      color: [15, 23, 42, 255]
    }),
    new VerticalGridLayer({
      id: 'webgpu-test-vertical-grid',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      xMin: -30,
      xMax: 30,
      yMin: -30,
      yMax: 30,
      tickCount: 4
    }),
    new HorizonGraphLayer({
      id: 'webgpu-test-horizon',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: new Float32Array([0, 25, -25, 50, -50, 100]),
      x: -30,
      y: 15,
      width: 60,
      height: 15,
      yAxisScale: 100,
      bands: 2
    }),
    new MultiHorizonGraphLayer({
      id: 'webgpu-test-multi-horizon',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {values: new Float32Array([0, 25, -25, 50]), scale: 100},
        {values: new Float32Array([50, -50, 25, 0]), scale: 100}
      ],
      getSeries: datum => datum.values,
      getScale: datum => datum.scale,
      x: -30,
      y: -5,
      width: 60,
      height: 18,
      dividerWidth: 2,
      bands: 2
    })
  ];
}

async function renderPortableLayers(type: 'webgl' | 'webgpu'): Promise<void> {
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
        reject(new Error(`Timed out while rendering community layers with ${type}.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        views: new OrthographicView({id: 'webgpu-layer-test', flipY: false}),
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers: createPortableLayers(),
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

describe('community graphics backend compatibility', () => {
  it('renders skybox, blocks, text, dependency markers, and horizon textures on WebGL2', async () => {
    await renderPortableLayers('webgl');
  }, 20_000);

  it('renders skybox, blocks, text, dependency markers, and horizon textures on WebGPU', async ({
    skip
  }) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderPortableLayers('webgpu');
  }, 20_000);
});
