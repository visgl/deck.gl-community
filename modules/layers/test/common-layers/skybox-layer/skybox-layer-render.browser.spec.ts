// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/core/webgl';
import {webgpuAdapter, type WebGPUDevice} from '@luma.gl/core/webgpu';
import {Deck, FirstPersonView} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core/matrix';
import {requireWebGPUAdapter} from '../webgpu-test-utils';
import {SkyboxLayer} from '../../../src';

const SIZE = 64;

// One solid colour per face, so each pixel shows which face the sky draws there.
const FACE_COLORS = {
  '+X': '#ff0000',
  '-X': '#00ff00',
  '+Y': '#0000ff',
  '-Y': '#ffff00',
  '+Z': '#ff00ff',
  '-Z': '#00ffff'
} as const;

function createFaceUrl(color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 4, 4);
  return canvas.toDataURL();
}

// Keep one manifest object so a new modelMatrix does not reload the cubemap.
const CUBEMAP = {
  shape: 'image-texture-cube' as const,
  faces: Object.fromEntries(
    Object.entries(FACE_COLORS).map(([face, color]) => [face, createFaceUrl(color)])
  ) as Record<keyof typeof FACE_COLORS, string>
};

// Keep slow software GPUs from drawing more frames while an async pixel read is pending.
class TestDeck extends Deck<FirstPersonView> {
  pause() {
    this.animationLoop?.stop();
  }
  resume() {
    this.animationLoop?.start();
  }
}

let deck: TestDeck | undefined;
let container: HTMLDivElement | undefined;
let device: Device | undefined;
let framebuffer: Framebuffer | undefined;
let colorTexture: Texture | undefined;
const validationErrors: string[] = [];

/** Reads the frame bottom row first, like WebGL `readPixels`. */
async function readFrame(): Promise<Uint8Array> {
  if (device!.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }
  device!.submit();
  const buffer = device!.createBuffer({
    byteLength: SIZE * SIZE * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    const encoder = device!.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: colorTexture!,
      destinationBuffer: buffer,
      bytesPerRow: SIZE * 4,
      width: SIZE,
      height: SIZE
    });
    device!.submit(encoder.finish());
    const data = await buffer.readAsync();
    const pixels = new Uint8Array(data.length);
    for (let y = 0; y < SIZE; y++) {
      pixels.set(data.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), (SIZE - 1 - y) * SIZE * 4);
    }
    return pixels;
  } finally {
    buffer.destroy();
  }
}

/** Renders the skybox with a model matrix and returns the frame once the cubemap is ready. */
function renderSkybox(modelMatrix: Matrix4 | null): Promise<Uint8Array> {
  const layer = new SkyboxLayer({id: 'skybox', cubemap: CUBEMAP, modelMatrix});
  return new Promise((resolve, reject) => {
    let captured = false;
    const onAfterRender = () => {
      const {model, cubemapTexture} = layer.state ?? {};
      // The animation loop draws again until the texture and the WebGPU pipeline are ready.
      const pending = device!.type === 'webgpu' && model?.pipeline.isPending;
      if (captured || !cubemapTexture?.isReady || !model || pending) return;
      captured = true;
      deck!.pause();
      readFrame().then(resolve, reject);
    };
    const props = {layers: [layer], onAfterRender, onError: reject};
    if (deck) {
      deck.setProps(props);
      deck.resume();
    } else {
      deck = new TestDeck({
        device,
        _framebuffer: device!.type === 'webgpu' ? framebuffer : undefined,
        parent: container,
        width: SIZE,
        height: SIZE,
        useDevicePixels: false,
        _animate: true,
        views: new FirstPersonView({fovy: 120}),
        // Look along +Y with +Z up, so world X runs along the screen columns.
        initialViewState: {position: [0, 0, 0], bearing: 0, pitch: 0},
        ...props
      });
    }
  });
}

function getPixel(pixels: Uint8Array, x: number, y: number): number[] {
  const index = (y * SIZE + x) * 4;
  return Array.from(pixels.subarray(index, index + 4));
}

/** Expects the pixel at `x` in the middle row to show a face colour. */
function expectFace(pixels: Uint8Array, x: number, face: keyof typeof FACE_COLORS): void {
  const hex = FACE_COLORS[face];
  const expected = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const actual = getPixel(pixels, x, SIZE / 2).slice(0, 3);
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(actual[channel] - expected[channel]), `${face} at x=${x}`).toBeLessThan(8);
  }
}

/** Counts the pixels that show the transparent clear colour, where the sky is not drawn. */
function countClearPixels(pixels: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) count++;
  }
  return count;
}

/** Returns the fraction of pixels that differ between `a` and `b` mirrored left to right. */
function getMirrorMismatch(a: Uint8Array, b: Uint8Array, mirror: boolean): number {
  let mismatches = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const left = getPixel(a, x, y);
      const right = getPixel(b, mirror ? SIZE - 1 - x : x, y);
      if (left.some((value, channel) => Math.abs(value - right[channel]) > 8)) mismatches++;
    }
  }
  return mismatches / (SIZE * SIZE);
}

afterEach(async () => {
  deck?.pause();
  if (device?.type === 'webgpu') await (device as WebGPUDevice).handle.queue.onSubmittedWorkDone();
  deck?.finalize();
  framebuffer?.destroy();
  colorTexture?.destroy();
  device?.destroy();
  container?.remove();
  deck = undefined;
  device = undefined;
  framebuffer = undefined;
  colorTexture = undefined;
  expect(validationErrors.splice(0)).toEqual([]);
});

describe.each(['webgl', 'webgpu'] as const)('SkyboxLayer %s modelMatrix rendering', backend => {
  beforeEach(async ({skip}) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    container = document.createElement('div');
    container.style.cssText = `width: ${SIZE}px; height: ${SIZE}px`;
    document.body.appendChild(container);
    device = await luma.createDevice({
      type: backend,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container, width: SIZE, height: SIZE, useDevicePixels: false}
    });
    expect(device.type).toBe(backend);
    if (backend === 'webgpu') {
      (device as WebGPUDevice).handle.addEventListener('uncapturederror', event => {
        validationErrors.push(event.error.message);
      });
    }
    colorTexture = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    framebuffer = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [colorTexture],
      depthStencilAttachment: 'depth24plus'
    });
  });

  it('draws a mirrored sky and ignores a nonuniform scale', async () => {
    const identity = await renderSkybox(null);
    // The camera looks at +Y, with -X on the left and +X on the right.
    expect(countClearPixels(identity)).toBe(0);
    expectFace(identity, SIZE / 2, '+Y');
    expectFace(identity, 1, '-X');
    expectFace(identity, SIZE - 2, '+X');
    // The image is not symmetric, so the mirror check below has meaning.
    expect(getMirrorMismatch(identity, identity, true)).toBeGreaterThan(0.2);

    // A reflection of X reverses the winding. The inside faces must stay visible.
    const mirrored = await renderSkybox(new Matrix4().scale([-1, 1, 1]));
    expect(countClearPixels(mirrored)).toBe(0);
    expectFace(mirrored, SIZE / 2, '+Y');
    expectFace(mirrored, 1, '+X');
    expectFace(mirrored, SIZE - 2, '-X');
    expect(getMirrorMismatch(mirrored, identity, true)).toBeLessThan(0.02);

    // Scale does not distort the sky.
    const scaled = await renderSkybox(new Matrix4().scale([3, 0.2, 1.5]));
    expect(countClearPixels(scaled)).toBe(0);
    expect(getMirrorMismatch(scaled, identity, false)).toBeLessThan(0.02);
  }, 30_000);
});
