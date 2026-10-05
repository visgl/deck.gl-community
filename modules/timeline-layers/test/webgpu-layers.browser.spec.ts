// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {TimeAxisLayer, TimelineLayer} from '../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

function createTimelineLayers() {
  return [
    new TimeAxisLayer({
      id: 'time-axis',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      startTimeMs: -30,
      endTimeMs: 30,
      tickCount: 4,
      y: 32,
      color: [15, 23, 42, 255]
    }),
    new TimelineLayer({
      id: 'timeline',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          id: 'track',
          name: 'WebGPU',
          clips: [
            {id: 'clip', label: 'portable', startMs: 0, endMs: 700, color: [14, 165, 233, 255]}
          ]
        }
      ],
      timelineStart: 0,
      timelineEnd: 1000,
      currentTimeMs: 500,
      x: -25,
      y: -5,
      width: 50,
      trackHeight: 10,
      trackSpacing: 2,
      showAxis: true,
      showClipLabels: true,
      showTrackLabels: true,
      showScrubber: true,
      pickable: true
    })
  ];
}

async function renderTimelineLayers(type: 'webgl' | 'webgpu'): Promise<void> {
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
        reject(new Error(`Timed out while rendering timeline labels with ${type}.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        views: new OrthographicView({id: 'timeline-webgpu-test', flipY: false}),
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers: createTimelineLayers(),
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

describe('timeline text graphics backend compatibility', () => {
  it('renders axis, track, clip, and scrubber labels on WebGL2', async () => {
    await renderTimelineLayers('webgl');
  }, 20_000);

  it('renders axis, track, clip, and scrubber labels on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderTimelineLayers('webgpu');
  }, 20_000);
});
