// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {GeoJsonLayer} from '@deck.gl/layers';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {GpuParticleSimulation} from '../../src/wind-layer/gpu-particle-simulation';
import {
  createWindField,
  DelaunayCoverLayer,
  ElevationLayer,
  ParticleLayer,
  WindLayer,
  type WindField,
  type WindStation
} from '../../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

const STATIONS: WindStation[] = [
  {name: 'southwest', long: 100, lat: 35, elv: 120},
  {name: 'southeast', long: 96, lat: 35, elv: 180},
  {name: 'northwest', long: 100, lat: 39, elv: 240},
  {name: 'northeast', long: 96, lat: 39, elv: 320}
];
const STATE_BOUNDARY = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'LineString' as const,
    coordinates: [
      [-100, 35],
      [-96, 35],
      [-96, 39],
      [-100, 39],
      [-100, 35]
    ]
  }
};

function createElevationData(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create the browser-test elevation image.');
  }

  const image = context.createImageData(canvas.width, canvas.height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 48 + ((offset / 4) % canvas.width) * 10;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function createLayers(
  field: WindField,
  time: number,
  elevationData: string,
  deviceType: 'webgl' | 'webgpu'
) {
  const particles = new ParticleLayer({
    id: 'test-wind-particles',
    windField: field,
    time,
    numParticles: 4096,
    trailLength: 4,
    elevationScale: 2
  });

  return [
    ...(deviceType === 'webgpu'
      ? []
      : [
          new ElevationLayer({
            id: 'test-wind-height-map',
            elevationData,
            bounds: [-100, 35, -96, 39],
            elevationRange: [0, 255],
            elevationScale: 2,
            meshMaxError: 4
          })
        ]),
    new DelaunayCoverLayer({id: 'test-wind-terrain', windField: field, elevationScale: 2}),
    new WindLayer({
      id: 'test-wind-arrows',
      windField: field,
      time,
      gridWidth: 8,
      gridHeight: 6,
      elevationScale: 2
    }),
    new GeoJsonLayer({
      id: 'test-wind-state-boundary',
      data: STATE_BOUNDARY,
      filled: false,
      stroked: true,
      getLineColor: [177, 188, 205, 255],
      getLineWidth: 1,
      lineWidthUnits: 'pixels'
    }),
    particles
  ];
}

describe('wind height-map setup', () => {
  it('constructs the original elevation terrain without a remote worker', () => {
    const layer = new ElevationLayer({
      id: 'test-height-map',
      elevationData: 'https://example.com/elevation.png',
      bounds: [-125, 24.4, -66.7, 49.6],
      elevationScale: 80
    });

    expect(layer.props.elevationScale).toBe(80);
    expect(layer.props.elevationData).toContain('elevation.png');
  });
});

async function renderWindLayers(type: 'webgl' | 'webgpu'): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '160px';
  parent.style.height = '120px';
  document.body.append(parent);

  const field = createWindField(STATIONS, [
    [
      [0, 10, 20],
      [1, 15, 25],
      [2, 20, 30],
      [3, 25, 35]
    ],
    [
      [1, 12, 21],
      [2, 17, 26],
      [3, 22, 31],
      [4, 27, 36]
    ]
  ]);

  let device: Device | undefined;
  let deck: Deck | undefined;
  let particleLayer: ParticleLayer | undefined;
  let nativeDevice: NativeGpuDevice | undefined;
  const validationErrors: string[] = [];
  const captureValidationError = (event: NativeGpuError): void => {
    validationErrors.push(event.error?.message ?? 'Unknown WebGPU validation error.');
  };
  const elevationData = createElevationData();

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
        reject(new Error(`Timed out while rendering wind showcase layers with ${type}.`));
      }, 10_000);
      let renderedAnimation = false;

      deck = new Deck({
        device,
        parent,
        width: 160,
        height: 120,
        views: new MapView({id: 'wind-test'}),
        initialViewState: {longitude: -98, latitude: 37, zoom: 4},
        layers: createLayers(field, 0, elevationData, type),
        onAfterRender: () => {
          if (!renderedAnimation) {
            renderedAnimation = true;
            const layers = createLayers(field, 0.5, elevationData, type);
            particleLayer = layers.find(layer => layer instanceof ParticleLayer) as ParticleLayer;
            deck?.setProps({layers});
            return;
          }
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
    expect(particleLayer?.state.gpu).toBeInstanceOf(GpuParticleSimulation);
    expect(particleLayer?.state.gpu?.particleCount).toBe(4096);
    expect(particleLayer?.state.particles).toHaveLength(0);
    expect(particleLayer?.state.gpu?.targetBuffer.byteLength).toBe(4096 * 4 * 4);
    if (type === 'webgl' && particleLayer?.state.gpu) {
      const sourceBytes = particleLayer.state.gpu.sourceBuffer.readSyncWebGL();
      const targetBytes = particleLayer.state.gpu.targetBuffer.readSyncWebGL();
      const sources = new Float32Array(
        sourceBytes.buffer,
        sourceBytes.byteOffset,
        sourceBytes.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      const targets = new Float32Array(
        targetBytes.buffer,
        targetBytes.byteOffset,
        targetBytes.byteLength / Float32Array.BYTES_PER_ELEMENT
      );

      for (let index = 0; index < sources.length; index += 4) {
        expect(Number.isFinite(sources[index])).toBe(true);
        expect(Number.isFinite(targets[index])).toBe(true);
        expect(
          Math.hypot(sources[index] - targets[index], sources[index + 1] - targets[index + 1])
        ).toBeLessThan(0.5);
      }
    }
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    device?.destroy();
    parent.remove();
  }
}

describe('wind showcase rendering', () => {
  it('renders and animates terrain, arrows, and particles on WebGL2', async () => {
    await renderWindLayers('webgl');
  }, 20_000);

  it('renders portable boundaries, arrows, station terrain, and particles on WebGPU', async ({
    skip
  }) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderWindLayers('webgpu');
  }, 20_000);
});
