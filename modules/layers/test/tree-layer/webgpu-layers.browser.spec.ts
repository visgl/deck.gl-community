// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  OrbitView,
  type Effect,
  type FilterContext
} from '@deck.gl/core';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/core/webgl';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {describe, expect, inject, it} from 'vitest';

import {TreeLayer, type TreeSpec} from '../../src';
import {TreePhotorealLeafLayer} from '../../src/tree-layer/tree-photoreal-leaf-layer';
import {TreeShellLayer} from '../../src/tree-layer/tree-shell-layer';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

async function readFrame(
  device: Device,
  texture: Texture,
  framebuffer: Framebuffer
): Promise<Uint8Array> {
  if (device.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = (device as WebGLDevice).readPixelsToArrayWebGL(framebuffer) as Uint8Array;
    expect(gl.getError()).toBe(gl.NO_ERROR);
    return pixels;
  }
  device.submit();
  const buffer = device.createBuffer({
    byteLength: 128 * 128 * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: texture,
      destinationBuffer: buffer,
      bytesPerRow: 128 * 4,
      width: 128,
      height: 128
    });
    device.submit(encoder.finish());
    return new Uint8Array(await buffer.readAsync());
  } finally {
    buffer.destroy();
  }
}

type CanopyMetrics = {greenPixels: number; meanAlpha: number};

async function checkCanopyHandoff(type: 'webgl' | 'webgpu'): Promise<void> {
  const size = 128;
  const parent = document.createElement('div');
  document.body.append(parent);
  const device = await luma.createDevice({
    type,
    adapters: [webgl2Adapter, webgpuAdapter],
    createCanvasContext: {container: parent, width: size, height: size, useDevicePixels: false}
  });
  const texture = device.createTexture({
    width: size,
    height: size,
    format: 'rgba8unorm',
    usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
  });
  const framebuffer = device.createFramebuffer({
    width: size,
    height: size,
    colorAttachments: [texture],
    depthStencilAttachment: 'depth24plus'
  });
  const viewState = {target: [0, 0, 3], rotationOrbit: 20, rotationX: 15, zoom: 3.4};
  const errors: string[] = [];
  const drawn = new Set<'shell' | 'leaf'>();
  class CanopyTreeLayer extends TreeLayer<TreeSpec> {
    static componentName = 'CanopyTreeLayer';

    filterSubLayer(context: FilterContext): boolean {
      const {layer, renderPass} = context;
      if (!super.filterSubLayer(context)) return false;
      if (renderPass === 'shadow') return true;
      if (!layer.getNumInstances()) return false;
      if (layer instanceof TreeShellLayer) {
        drawn.add('shell');
        return true;
      }
      if (layer instanceof TreePhotorealLeafLayer) {
        drawn.add('leaf');
        return true;
      }
      return false;
    }
  }
  const deck = new Deck({
    device,
    parent,
    _framebuffer: framebuffer,
    width: size,
    height: size,
    useDevicePixels: false,
    views: new OrbitView({orbitAxis: 'Z', fovy: 50, near: 0.005, far: 1000}),
    viewState: viewState as never,
    effects: [
      new LightingEffect({
        ambient: new AmbientLight({color: [184, 209, 239], intensity: 1.2}),
        sun: new DirectionalLight({
          color: [255, 246, 221],
          intensity: 2,
          direction: [-1, -2, -3],
          _shadow: true
        })
      })
    ],
    onError: error => errors.push(error.message)
  });
  try {
    await expect.poll(() => deck.isInitialized, {timeout: 30_000}).toBe(true);
    deck['animationLoop']!.stop();
    async function render(zoom: number, expected: ('shell' | 'leaf')[]) {
      drawn.clear();
      deck.setProps({viewState: {...viewState, zoom} as never});
      deck.layerManager!.updateLayers();
      deck.redraw('compare shell and resolved canopy colors');
      expect([...drawn].sort()).toEqual(expected);
      const pixels = await readFrame(device, texture, framebuffer);
      const channels = [0, 0, 0];
      let opaque = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] < 245) continue;
        opaque++;
        for (let channel = 0; channel < 3; channel++) channels[channel] += pixels[offset + channel];
      }
      expect(opaque).toBeGreaterThan(1000);
      return channels.map(sum => sum / opaque);
    }
    function setCanopy(canopyColor: [number, number, number, number]) {
      deck.setProps({
        layers: [
          new CanopyTreeLayer({
            id: 'canopy-handoff',
            coordinateSystem: 'cartesian',
            data: [
              {
                position: [0, 0, 0] as [number, number, number],
                species: 'citrus' as const,
                height: 6,
                crownRadius: 2.6,
                canopyColor,
                wind: false,
                characteristics: {seed: 5, leafDensity: 0.55}
              }
            ],
            getTree: tree => tree,
            windTime: 0
          })
        ]
      });
    }
    const colors: [number, number, number, number][] = [
      [67, 112, 42, 255],
      [182, 121, 32, 255],
      [67, 139, 152, 255]
    ];
    for (const canopyColor of colors) {
      setCanopy(canopyColor);
      const shell = await render(3.4, ['shell']);
      const overlap = await render(3.5, ['leaf', 'shell']);
      const leaves = await render(3.6, ['leaf']);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(shell[channel] - leaves[channel])).toBeLessThan(12);
        expect(Math.abs(overlap[channel] - leaves[channel])).toBeLessThan(12);
      }
    }
    setCanopy([0, 0, 0, 255]);
    // WebGPU's material can still show a specular highlight on black foliage.
    const black = await render(3.4, ['shell']);
    expect(Math.max(...black)).toBeLessThan(2);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    framebuffer.destroy();
    texture.destroy();
    device.destroy();
    parent.remove();
  }
}

function getCanopyMetrics(pixels: Uint8Array): CanopyMetrics {
  let greenPixels = 0;
  let alpha = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const [red, green, blue, opacity] = pixels.subarray(index, index + 4);
    if (opacity > 16 && green > red * 1.2 && green > blue * 1.4) {
      greenPixels++;
      alpha += opacity;
    }
  }
  return {greenPixels, meanAlpha: alpha / Math.max(1, greenPixels)};
}

async function renderDenseCanopy(type: 'webgl' | 'webgpu'): Promise<CanopyMetrics> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: Deck | undefined;
  let colorTexture: Texture | undefined;
  let framebuffer: Framebuffer | undefined;
  let nativeDevice: NativeGpuDevice | undefined;
  const validationErrors: string[] = [];
  const captureValidationError = (event: NativeGpuError): void => {
    validationErrors.push(event.error?.message ?? 'Unknown WebGPU validation error.');
  };

  try {
    device = await luma.createDevice({
      type,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container: parent, width: 128, height: 128, useDevicePixels: false}
    });
    colorTexture = device.createTexture({
      width: 128,
      height: 128,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    framebuffer = device.createFramebuffer({
      width: 128,
      height: 128,
      colorAttachments: [colorTexture],
      depthStencilAttachment: 'depth24plus'
    });
    if (type === 'webgpu') {
      nativeDevice = (device as Device & {handle?: NativeGpuDevice}).handle;
      nativeDevice?.addEventListener('uncapturederror', captureValidationError);
    }

    const pixels = await new Promise<Uint8Array>((resolve, reject) => {
      let frames = 0;
      let capturing = false;
      const timeout = window.setTimeout(
        () => reject(new Error(`Timed out while rendering dense TreeLayer canopy with ${type}.`)),
        30_000
      );
      deck = new Deck({
        _framebuffer: framebuffer,
        useDevicePixels: false,
        device,
        parent,
        width: 128,
        height: 128,
        _animate: true,
        views: new MapView({id: 'dense-canopy', nearZMultiplier: 0.02}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 19, pitch: 72, bearing: 20},
        layers: [
          new TreeLayer({
            id: `dense-canopy-${type}`,
            coordinateSystem: 'meter-offsets',
            coordinateOrigin: [0, 0, 0],
            data: Array.from({length: 4}, (_, index) => ({
              position: [((index % 2) - 0.5) * 2, (Math.floor(index / 2) - 0.5) * 2] as [
                number,
                number
              ],
              species: 'citrus' as const,
              season: 'summer' as const,
              height: 4.8,
              crownRadius: 2.4,
              trunkRadius: 0.1,
              wind: false,
              canopyColor: [33, 112, 29, 255] as [number, number, number, number]
            })),
            getTree: datum => datum
            // One coarse cluster per visible crown forces TreeLayer's hierarchy representation,
            // whose sources carry opticalDepths rather than the authored leaf opacities.
          })
        ],
        onAfterRender: () => {
          if (++frames < 12 || capturing) return;
          capturing = true;
          readFrame(device!, colorTexture!, framebuffer!).then(
            result => {
              window.clearTimeout(timeout);
              resolve(result);
            },
            error => {
              window.clearTimeout(timeout);
              reject(error);
            }
          );
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
    return getCanopyMetrics(pixels);
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    framebuffer?.destroy();
    colorTexture?.destroy();
    device?.destroy();
    parent.remove();
  }
}

async function renderTreeLayer(type: 'webgl' | 'webgpu', effects: Effect[] = []): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: Deck | undefined;
  let nativeDevice: NativeGpuDevice | undefined;
  let frames = 0;
  const errors: string[] = [];
  const validationErrors: string[] = [];
  const passes = new Set<string>();
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

    const scene = new Deck({
      device,
      parent,
      width: 128,
      height: 128,
      useDevicePixels: false,
      views: new MapView({id: 'tree-webgpu-test'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 15, pitch: 45},
      layerFilter: ({renderPass}) => {
        passes.add(renderPass);
        return true;
      },
      onAfterRender: () => frames++,
      onError: error => errors.push(error.message)
    });
    deck = scene;
    await expect.poll(() => scene.isInitialized, {timeout: 30_000}).toBe(true);
    scene['animationLoop']!.stop();
    scene.setProps({
      layers: [
        new TreeLayer({
          id: `tree-${type}`,
          // Exercise WebGPU's high/low position layout for local metres under MapView.
          coordinateSystem: 'meter-offsets',
          coordinateOrigin: [0, 0, 0],
          data: (
            ['pine', 'oak', 'palm', 'birch', 'cherry', 'banyan', 'mangrove', 'citrus'] as const
          ).flatMap((species, i) =>
            (['summer', 'winter'] as const).map(season => ({
              position: [i * 12, 0] as [number, number],
              species,
              season
            }))
          ),
          getTree: datum => ({
            position: datum.position,
            species: datum.species,
            season: datum.season,
            height: 12,
            wind: true,
            characteristics: {seed: 19, branchLift: 0.8, leafSize: 1.1},
            crop: {
              kind:
                datum.species === 'citrus' ? 'lemon' : datum.species === 'pine' ? 'cone' : 'fruit',
              color: [210, 70, 40, 255],
              count: 2,
              droppedCount: 1,
              radius: 0.05
            }
          }),
          windTime: 1.25,
          pickable: true
        })
      ]
    });

    const render = async (withShadows: boolean) => {
      const before = frames;
      passes.clear();
      // Refresh the models after changing lighting, then submit one complete frame.
      scene.layerManager!.updateLayers();
      scene.redraw('verify TreeLayer backend compatibility');
      expect(frames).toBe(before + 1);
      expect(passes.has('screen')).toBe(true);
      expect(passes.has('shadow')).toBe(withShadows);
      device!.submit();
      await nativeDevice?.queue.onSubmittedWorkDone();
      expect(errors).toEqual([]);
      expect(validationErrors).toEqual([]);
    };
    expect(device.type).toBe(type);
    await render(false);
    if (effects.length) {
      scene.setProps({effects});
      await render(true);
    }
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    device?.destroy();
    parent.remove();
  }
}

describe('TreeLayer graphics backend compatibility', () => {
  it('keeps canopy shell and individual leaves in the same palette on WebGL2', async () => {
    await checkCanopyHandoff('webgl');
  }, 40_000);

  it('keeps canopy shell and individual leaves in the same palette on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }
    await checkCanopyHandoff('webgpu');
  }, 60_000);

  it('renders connected wood and foliage on WebGL2', async () => {
    await renderTreeLayer('webgl');
  }, 40_000);

  it('renders connected wood and foliage on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderTreeLayer('webgpu', [
      new LightingEffect({
        ambient: new AmbientLight({intensity: 0.6}),
        sun: new DirectionalLight({direction: [1, 0, -1], intensity: 0.8, _shadow: true})
      })
    ]);
  }, 60_000);

  it('keeps a dense canopy opaque on both WebGL2 and WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }

    const webgl = await renderDenseCanopy('webgl');
    const webgpu = await renderDenseCanopy('webgpu');
    expect(webgl.greenPixels).toBeGreaterThan(100);
    expect(webgl.meanAlpha).toBeGreaterThan(100);
    expect(webgpu.greenPixels).toBeGreaterThan(webgl.greenPixels * 0.85);
    expect(webgpu.meanAlpha).toBeGreaterThan(webgl.meanAlpha * 0.9);
    expect(webgpu.meanAlpha).toBeLessThan(webgl.meanAlpha * 1.1);
  }, 60_000);
});
