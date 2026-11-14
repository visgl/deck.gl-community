// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, MapView, OrbitView, WebMercatorViewport} from '@deck.gl/core';
import {Buffer, Texture, luma} from '@luma.gl/core';
import {type WebGLDevice, webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {expect, it} from 'vitest';
import {GrassLayer} from '../../src/grass-layer/grass-layer';
import {requireWebGPUAdapter} from '../webgpu-test-utils';

const SIZE = 128;

async function createRenderTarget(backend: 'webgl' | 'webgpu') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const errors: string[] = [];
  const device = await luma.createDevice({
    type: backend,
    adapters: [webgl2Adapter, webgpuAdapter],
    createCanvasContext: {container: parent, width: SIZE, height: SIZE, useDevicePixels: false},
    onError: error => errors.push(error.message)
  });
  const texture = device.createTexture({
    width: SIZE,
    height: SIZE,
    format: 'rgba8unorm',
    usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
  });
  const target = device.createFramebuffer({
    width: SIZE,
    height: SIZE,
    colorAttachments: [texture],
    depthStencilAttachment: 'depth24plus'
  });
  const readback =
    backend === 'webgpu'
      ? device.createBuffer({
          byteLength: SIZE * SIZE * 4,
          usage: Buffer.COPY_DST | Buffer.MAP_READ
        })
      : null;
  async function readPixels() {
    if (!readback) return (device as WebGLDevice).readPixelsToArrayWebGL(target) as Uint8Array;
    device.submit();
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: texture,
      destinationBuffer: readback,
      bytesPerRow: SIZE * 4,
      width: SIZE,
      height: SIZE
    });
    device.submit(encoder.finish());
    return new Uint8Array(await readback.readAsync());
  }

  function destroy() {
    readback?.destroy();
    target.destroy();
    texture.destroy();
    device.destroy();
    parent.remove();
  }
  return {parent, device, target, errors, readPixels, destroy};
}

function getGrassPixels(pixels: Uint8Array, backend: 'webgl' | 'webgpu') {
  const visible: {x: number; y: number}[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const p = i * 4;
    if (pixels[p + 1] > 50 && pixels[p + 1] > pixels[p] * 2) {
      const row = Math.floor(i / SIZE);
      visible.push({x: i % SIZE, y: backend === 'webgl' ? SIZE - 1 - row : row});
    }
  }
  return visible;
}

it.for(['webgl', 'webgpu'] as const)(
  'renders deterministic, animated and pickable grass patches on %s',
  {timeout: 45_000},
  async (backend, {skip}) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    const {parent, device, target, errors, readPixels, destroy} = await createRenderTarget(backend);

    const rows = [
      {position: [-1.2, 0, 0] as const, density: 1},
      {position: [1.2, 0, 0] as const, density: 0}
    ];
    function layer(windTime: number, windStrength = 0) {
      return new GrassLayer<(typeof rows)[number]>({
        id: 'test-grass',
        data: rows,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: d => d.position,
        getSize: [1.5, 1.5],
        getHeight: 0.48,
        getBladeWidth: 0.09,
        getDensity: d => d.density,
        getSeed: 13,
        getColor: [65, 183, 43, 255],
        bladesPerPatch: 128,
        windTime,
        windStrength,
        pickable: true
      });
    }

    let draws = 0;
    const deck = new Deck({
      _framebuffer: target,
      device,
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      views: new OrbitView({orbitAxis: 'Z', fovy: 45}),
      initialViewState: {target: [0, 0, 0.15], zoom: 4.6, rotationX: 42, rotationOrbit: 0},
      layers: [layer(0)],
      onAfterRender: () => {
        draws++;
      },
      onError: error => {
        errors.push(error.message);
      }
    });
    try {
      await expect.poll(() => draws, {timeout: 10_000}).toBeGreaterThan(0);
      const still = await readPixels();
      const visible = getGrassPixels(still, backend);
      expect(visible.length).toBeGreaterThan(100);
      expect(visible.every(pixel => pixel.x < SIZE / 2)).toBe(true);

      const pixel = visible[Math.floor(visible.length / 2)];
      expect((await deck.pickObjectAsync({...pixel, radius: 2}))?.object).toBe(rows[0]);

      async function render(time: number, strength: number) {
        const before = draws;
        deck.setProps({layers: [layer(time, strength)]});
        await expect.poll(() => draws).toBeGreaterThan(before);
        return readPixels();
      }

      const frozen = await render(1.5, 0);
      expect(frozen.every((byte, index) => byte === still[index])).toBe(true);
      const moving = await render(0.25, 0.8);
      const later = await render(1.5, 0.8);
      expect(moving.filter((byte, index) => byte !== later[index]).length).toBeGreaterThan(100);
      expect(errors).toEqual([]);
    } finally {
      deck.finalize();
      destroy();
    }
  }
);

it.for(['webgl', 'webgpu'] as const)(
  'places geographic grass at meter scale on %s',
  {timeout: 45_000},
  async (backend, {skip}) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    const {parent, device, target, errors, readPixels, destroy} = await createRenderTarget(backend);
    const center = {longitude: -122.451157, latitude: 62.345679};
    const viewportSize = {width: SIZE, height: SIZE};
    const origin = new WebMercatorViewport({...center, ...viewportSize});
    const zoom = Math.log2(10 / origin.distanceScales.unitsPerMeter[0]);
    const planView = {...center, zoom, pitch: 0, bearing: 0};
    const obliqueView = {...planView, pitch: 74};
    const planViewport = new WebMercatorViewport({...planView, ...viewportSize});
    const obliqueViewport = new WebMercatorViewport({...obliqueView, ...viewportSize});
    const ground = 1.1;
    const [longitude, latitude] = origin.addMetersToLngLat(
      [center.longitude, center.latitude],
      [1.35, -1.05]
    );
    const position: [number, number, number] = [longitude, latitude, ground];
    const patchSize: [number, number] = [6, 4];
    const nominalHeight = 3;
    function layer(size: [number, number], height: number) {
      return new GrassLayer({
        id: 'geographic-grass',
        data: [{position}],
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getSize: size,
        getHeight: height,
        getBladeWidth: 0.12,
        getSeed: 13,
        getColor: [65, 183, 43, 255],
        bladesPerPatch: 2048
      });
    }

    let draws = 0;
    const deck = new Deck({
      _framebuffer: target,
      device,
      parent,
      ...viewportSize,
      useDevicePixels: false,
      views: new MapView(),
      viewState: planView,
      layers: [layer(patchSize, 0.03)],
      onAfterRender: () => {
        draws++;
      },
      onError: error => errors.push(error.message)
    });
    try {
      await expect.poll(() => draws, {timeout: 10_000}).toBeGreaterThan(0);
      const overhead = getGrassPixels(await readPixels(), backend);
      expect(overhead.length).toBeGreaterThan(100);
      const [width, length] = patchSize;
      const [west, south] = origin.addMetersToLngLat(position, [-width / 2, -length / 2]);
      const [east, north] = origin.addMetersToLngLat(position, [width / 2, length / 2]);
      const [expectedLeft, expectedBottom] = planViewport.project([west, south, ground]);
      const [expectedRight, expectedTop] = planViewport.project([east, north, ground]);
      expect(Math.abs(Math.min(...overhead.map(p => p.x)) - expectedLeft)).toBeLessThan(3);
      expect(Math.abs(Math.max(...overhead.map(p => p.x)) - expectedRight)).toBeLessThan(3);
      expect(Math.abs(Math.min(...overhead.map(p => p.y)) - expectedTop)).toBeLessThan(3);
      expect(Math.abs(Math.max(...overhead.map(p => p.y)) - expectedBottom)).toBeLessThan(3);

      // A narrow strip makes the oblique silhouette's rise measure blade height, with little
      // contribution from the patch's ground footprint. Allow for seeded heights and blade bend.
      const before = draws;
      deck.setProps({viewState: obliqueView, layers: [layer([4, 0.1], nominalHeight)]});
      await expect.poll(() => draws).toBeGreaterThan(before);
      const oblique = getGrassPixels(await readPixels(), backend);
      expect(oblique.length).toBeGreaterThan(100);
      const [, baseY] = obliqueViewport.project(position);
      const [, minimumTipY] = obliqueViewport.project([
        longitude,
        latitude,
        ground + 0.9 * nominalHeight
      ]);
      const [, maximumTipY] = obliqueViewport.project([
        longitude,
        latitude,
        ground + 1.25 * nominalHeight
      ]);
      const tipY = Math.min(...oblique.map(pixel => pixel.y));
      expect(tipY).toBeLessThan(minimumTipY);
      expect(tipY).toBeGreaterThan(maximumTipY);
      expect(Math.abs(Math.max(...oblique.map(pixel => pixel.y)) - baseY)).toBeLessThan(3);
      expect(errors).toEqual([]);
    } finally {
      deck.finalize();
      destroy();
    }
  }
);
