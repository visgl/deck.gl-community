// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, OrthographicView, type Effect, type View} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {Buffer, Texture, luma, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/core/webgl';
import {webgpuAdapter, type WebGPUDevice} from '@luma.gl/core/webgpu';
import {afterEach, describe, expect, it} from 'vitest';
import {requireWebGPUAdapter} from '../../../layers/test/common-layers/webgpu-test-utils';
import {CORTAOEffect} from '../../src';

type Backend = 'webgl' | 'webgpu';

const SIZE = 256;
/** Half the side of the box, in degrees. About 33 meters. */
const BOX = 0.0003;
const VIEW_STATE = {longitude: 0, latitude: -0.0006, zoom: 16.5, pitch: 50, bearing: 0};

function createLayers() {
  return [
    new SolidPolygonLayer({
      id: 'ground',
      data: [
        [
          [-0.01, -0.01],
          [0.01, -0.01],
          [0.01, 0.01],
          [-0.01, 0.01]
        ]
      ],
      getPolygon: polygon => polygon,
      getFillColor: [200, 200, 200]
    }),
    new SolidPolygonLayer({
      id: 'box',
      data: [
        [
          [-BOX, -BOX],
          [BOX, -BOX],
          [BOX, BOX],
          [-BOX, BOX]
        ]
      ],
      extruded: true,
      getPolygon: polygon => polygon,
      getElevation: 80,
      getFillColor: [200, 200, 200]
    })
  ];
}

// The tests use map and orthographic views, so the view state type is not fixed.
let deck: Deck<any> | null = null;
let device: Device | null = null;
let container: HTMLDivElement | null = null;
/** The WebGPU render target. The tests read it back with a texture copy. */
let framebuffer: Framebuffer | null = null;
let colorTexture: Texture | null = null;
const errors: string[] = [];

afterEach(async () => {
  if (device?.type === 'webgpu') {
    await (device as WebGPUDevice).handle.queue.onSubmittedWorkDone();
  }
  deck?.finalize();
  deck = null;
  framebuffer?.destroy();
  framebuffer = null;
  colorTexture?.destroy();
  colorTexture = null;
  device?.destroy();
  device = null;
  container?.remove();
  container = null;
  errors.length = 0;
});

/**
 * Creates a deck and waits for the first frame. On WebGPU, the deck renders into an offscreen
 * framebuffer, because a copy of a WebGPU canvas with `drawImage()` is empty on Linux Chrome with
 * SwiftShader.
 */
async function createDeck({
  type,
  effects,
  views = new MapView(),
  viewState = VIEW_STATE,
  layers = createLayers()
}: {
  type: Backend;
  effects: Effect[];
  views?: View | View[];
  viewState?: Record<string, unknown>;
  layers?: SolidPolygonLayer[];
}): Promise<Deck<any>> {
  container = document.createElement('div');
  container.style.cssText = `width: ${SIZE}px; height: ${SIZE}px`;
  document.body.append(container);
  device = await luma.createDevice({
    type,
    adapters: [webgl2Adapter, webgpuAdapter],
    createCanvasContext: {container, width: SIZE, height: SIZE, useDevicePixels: false},
    webgl: {preserveDrawingBuffer: true},
    onError: error => {
      errors.push(error.message);
      return true;
    }
  });
  if (type === 'webgpu') {
    colorTexture = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: device.preferredColorFormat,
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    framebuffer = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [colorTexture],
      depthStencilAttachment: 'depth24plus'
    });
  }
  await new Promise<void>((resolve, reject) => {
    deck = new Deck<any>({
      device: device!,
      parent: container!,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      views,
      initialViewState: viewState,
      effects,
      layers,
      _framebuffer: framebuffer,
      onError: reject,
      onAfterRender: () => resolve()
    });
  });
  deck!.redraw('test');
  return deck!;
}

/**
 * Waits for the submitted GPU work and checks that the device reported no errors. WebGPU reports
 * validation errors asynchronously, after the work that caused them.
 */
async function expectNoDeviceErrors(): Promise<void> {
  device!.submit();
  if (device!.type === 'webgpu') {
    await (device as WebGPUDevice).handle.queue.onSubmittedWorkDone();
  }
  // The browser dispatches the error events after the work is done.
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(errors).toEqual([]);
}

/** Reads one RGBA pixel of the render target. `y` counts from the top, like deck.gl pixels. */
async function readPixel(x: number, y: number): Promise<number[]> {
  if (device!.type === 'webgpu') {
    // Submit the redraw before the copy.
    device!.submit();
    const buffer = device!.createBuffer({
      byteLength: 256,
      usage: Buffer.COPY_DST | Buffer.MAP_READ
    });
    try {
      const encoder = device!.createCommandEncoder();
      encoder.copyTextureToBuffer({
        sourceTexture: colorTexture!,
        destinationBuffer: buffer,
        origin: [Math.round(x), Math.round(y), 0],
        width: 1,
        height: 1,
        bytesPerRow: 256
      });
      device!.submit(encoder.finish());
      const [r, g, b, a] = Array.from((await buffer.readAsync()).subarray(0, 4));
      return colorTexture!.format === 'bgra8unorm' ? [b, g, r, a] : [r, g, b, a];
    } finally {
      buffer.destroy();
    }
  }
  const gl = (device as WebGLDevice).gl;
  const pixel = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(Math.round(x), SIZE - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return Array.from(pixel);
}

/** Reads several pixels of the render target. */
async function readPixels(pixels: [number, number][]): Promise<number[][]> {
  const values: number[][] = [];
  for (const pixel of pixels) {
    values.push(await readPixel(...pixel));
  }
  return values;
}

/** Gets the pixel of a ground position in a viewport. */
function project(lngLat: [number, number], viewportIndex = 0): [number, number] {
  const viewport = deck!.getViewports()[viewportIndex];
  const [x, y] = viewport.project([...lngLat, 0]);
  return [viewport.x + x, viewport.y + y];
}

/** Redraws the deck and reads pixels, then redraws without effects and reads the same pixels. */
async function readPixelsWithAndWithoutEffects(pixels: [number, number][]): Promise<{
  on: number[][];
  off: number[][];
}> {
  deck!.redraw('test');
  const on = await readPixels(pixels);
  deck!.setProps({effects: []});
  deck!.redraw('test');
  const off = await readPixels(pixels);
  return {on, off};
}

/** Skips a WebGPU test when the browser has no WebGPU adapter, unless CI requires one. */
async function requireBackend(type: Backend, skip: (message: string) => void): Promise<void> {
  if (type === 'webgpu') {
    await requireWebGPUAdapter(skip);
  }
}

// Software GPUs in CI compile the CORTAO shaders slowly.
const TIMEOUT = 120000;

async function testOcclusion(type: Backend, getEffects: (effect: CORTAOEffect) => Effect[]) {
  const effect = new CORTAOEffect({showOcclusion: true});
  await createDeck({type, effects: getEffects(effect)});
  expect(effect.backend).toBe(type);

  // The camera looks north. The ground in front of the south face is in contact with the box.
  const base = project([0, -BOX - 0.00002]);
  const openGround = project([0, -BOX * 4]);
  const [occlusionAtBase, occlusionOnOpenGround] = await readPixels([base, openGround]);
  expect(occlusionAtBase[0]).toBeLessThan(200);
  expect(occlusionOnOpenGround[0]).toBeGreaterThan(235);

  effect.setProps({showOcclusion: false});
  const {on, off} = await readPixelsWithAndWithoutEffects([base, openGround]);
  // An empty readback would pass the checks above, so check that the scene is there.
  expect(off[1]).toEqual([200, 200, 200, 255]);
  expect(on[0][0]).toBeLessThan(off[0][0] - 20);
  expect(Math.abs(on[1][0] - off[1][0])).toBeLessThanOrEqual(8);
  await expectNoDeviceErrors();
}

describe.each([
  ['webgl', 'WebGL 2'],
  ['webgpu', 'WebGPU']
] as const)('CORTAOEffect', (type, name) => {
  it(`darkens only the ground at the base of an extruded box on ${name}`, {
    timeout: TIMEOUT
  }, async ({skip}) => {
    await requireBackend(type, skip);
    await testOcclusion(type, effect => [effect]);
  });
});

it('passes the scene through for an orthographic view on WebGL 2', {timeout: TIMEOUT}, async () => {
  await createDeck({
    type: 'webgl',
    effects: [new CORTAOEffect()],
    views: new OrthographicView(),
    viewState: {target: [0, 0, 0], zoom: 14}
  });
  const center: [number, number] = [SIZE / 2, SIZE / 2];
  const {on, off} = await readPixelsWithAndWithoutEffects([center]);
  expect(off[0][3]).toBe(255);
  expect(on).toEqual(off);
});
