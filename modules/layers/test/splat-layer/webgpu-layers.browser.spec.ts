// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  OrbitView,
  OrthographicView
} from '@deck.gl/core';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, inject, it} from 'vitest';

import {SplatLayer, WindEffect} from '../../src';

class TestDeck extends Deck {
  pause() {
    this.animationLoop?.stop();
  }
  resume() {
    this.animationLoop?.start();
  }
}
async function readFrame(
  device: Device,
  texture?: Texture,
  framebuffer?: Framebuffer
): Promise<Uint8Array> {
  if (device.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = framebuffer
      ? ((device as WebGLDevice).readPixelsToArrayWebGL(framebuffer) as Uint8Array)
      : new Uint8Array(128 * 128 * 4);
    if (!framebuffer) gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
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
      sourceTexture: texture!,
      destinationBuffer: buffer,
      bytesPerRow: 128 * 4,
      width: 128,
      height: 128
    });
    device.submit(encoder.finish());
    const data = await buffer.readAsync();
    const pixels = new Uint8Array(data.length);
    for (let y = 0; y < 128; y++)
      pixels.set(data.subarray(y * 128 * 4, (y + 1) * 128 * 4), (127 - y) * 128 * 4);
    return pixels;
  } finally {
    buffer.destroy();
  }
}

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

async function requireWebGPU(skip: (reason: string) => void): Promise<void> {
  const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
  if (!gpu || !(await gpu.requestAdapter())) {
    if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
    skip('This browser does not expose an available WebGPU adapter.');
  }
}

async function renderSplatLayer(
  type: 'webgl' | 'webgpu',
  mode: 'constant' | 'heterogeneous' | 'direct' = 'constant',
  transparency: 'weighted' | 'sorted' = 'weighted'
): Promise<void> {
  const heterogeneous = mode === 'heterogeneous';
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: TestDeck | undefined;
  let colorTexture: Texture | undefined;
  let framebuffer: Framebuffer | undefined;
  let pixels = new Uint8Array();
  let capturing = false;
  const source = {
    positions: new Float32Array([0, 0, 0, 0.4, 0, 0.2]),
    scales: new Float32Array([1.2, 0.3, 0.25, 0.4, 0.25, 0.1]),
    rotations: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
    colors: new Uint8Array([80, 180, 60, 255, 120, 200, 80, 255]),
    opacities: new Float32Array([0.85, 0.9])
  };
  const owner = {position: [0, 0] as [number, number], splats: source};
  const other = {
    position: [0.00003, 0] as [number, number],
    splats: {
      ...source,
      colors: new Uint8Array([200, 20, 40, 255, 200, 20, 40, 255]),
      opticalDepths: new Float32Array([-Math.log(0.15), -Math.log(0.1)])
    }
  };
  let frames = 0;
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

    await new Promise<void>((resolve, reject) => {
      // Cold software shader compilation can exceed 10 seconds on a busy CI host.
      // This gate verifies rendering/validation; hardware frame pacing is measured separately.
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out while rendering SplatLayer with ${type}.`));
      }, 30_000);

      deck = new TestDeck({
        _framebuffer: framebuffer,
        useDevicePixels: false,
        device,
        parent,
        width: 128,
        height: 128,
        _animate: true,
        views: new MapView({id: 'tree-webgpu-test'}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 20, pitch: 0},
        effects: [new WindEffect({strength: 0.025, time: 1.25})],
        layers: [
          new SplatLayer({
            id: `splats-${type}`,
            data: mode === 'direct' ? source : heterogeneous ? [owner, other] : [owner],
            ...(mode === 'direct' ? {} : {getSource: heterogeneous ? row => row.splats : source}),
            getPosition: mode === 'direct' ? [0, 0] : row => row.position,
            getTransformMatrix: heterogeneous
              ? [1, 0, 0, 0, 0.4, 1.3, 0, 0, 0, 0, 0.7, 0, 0, 0, 5, 1]
              : null,
            transparency,
            getTranslation: [0, 0, 5],
            getDeformation: [10, 0.7, 1],
            maxRenderPixels: mode === 'constant' ? Infinity : 64 * 64,
            pickable: true,
            material: {unlit: true}
          })
        ],
        onAfterRender: () => {
          if (++frames < 8 || capturing) return;
          capturing = true;
          deck!.pause();
          readFrame(device!, colorTexture, framebuffer).then(result => {
            pixels = result;
            let visible = 0;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 30) visible++;
            if (visible > 30) {
              window.clearTimeout(timeout);
              resolve();
            } else {
              capturing = false;
              deck!.resume();
            }
          }, reject);
        },
        onError: error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
    });

    let strongest = 0;
    for (let i = 3; i < pixels.length; i += 4)
      if (
        pixels[i] > pixels[strongest * 4 + 3] &&
        (!heterogeneous || pixels[i - 2] > pixels[i - 3])
      )
        strongest = (i - 3) / 4;
    expect(pixels[strongest * 4 + 1]).toBeGreaterThan(pixels[strongest * 4]);
    const picked = (
      await deck!.pickObjectAsync({x: strongest % 128, y: 127 - Math.floor(strongest / 128)})
    )?.object;
    if (mode === 'direct') expect(picked).toMatchObject({splats: source, position: [0, 0, 0]});
    else expect(picked).toBe(owner);
    await nativeDevice?.queue.onSubmittedWorkDone();
    expect(device.type).toBe(type);
    expect(validationErrors).toEqual([]);
    const stats = (deck!.props.layers[0] as SplatLayer).splatStats;
    expect(stats.sourceCount).toBe(heterogeneous ? 2 : 1);
    if (heterogeneous) {
      expect(stats.renderedSplats).toBe(4);
      const otherPixel = Array.from({length: 128 * 128}, (_, i) => i).find(
        i => pixels[i * 4] > pixels[i * 4 + 1] * 2 && pixels[i * 4 + 3] > 30
      )!;
      expect(otherPixel).toBeDefined();
      expect(
        (await deck!.pickObjectAsync({x: otherPixel % 128, y: 127 - Math.floor(otherPixel / 128)}))
          ?.object
      ).toBe(other);
    }
    if (mode === 'constant') {
      const baselineAlpha = pixels[strongest * 4 + 3];
      const drawViews = async (viewState?: Record<string, object>) => {
        const nextFrame = frames + 3;
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error('Overlapping view render timed out.')),
            15000
          );
          deck!.setProps({
            views: [
              new MapView({id: 'tree-webgpu-test'}),
              new MapView({id: 'overlap', clear: type === 'webgl'})
            ],
            ...(viewState ? {viewState} : {}),
            onAfterRender: () => {
              if (++frames >= nextFrame) {
                deck!.pause();
                window.clearTimeout(timeout);
                resolve();
              }
            }
          });
          deck!.resume();
        });
        return readFrame(device!, colorTexture, framebuffer);
      };
      // Each view contributes once. WebGL clears the underlying view; WebGPU
      // composites it because deck's nested View.clear render pass is unsupported.
      const overlap = await drawViews();
      const expectedAlpha =
        type === 'webgl' ? baselineAlpha : 255 * (1 - (1 - baselineAlpha / 255) ** 2);
      expect(Math.abs(overlap[strongest * 4 + 3] - expectedAlpha)).toBeLessThanOrEqual(2);
      // Another camera must not inherit the underlying view's optical buffer.
      const separate = await drawViews({
        'tree-webgpu-test': {longitude: 0, latitude: 0, zoom: 20},
        overlap: {longitude: 30, latitude: 0, zoom: 20}
      });
      if (type === 'webgl')
        expect(separate.some((channel, index) => index % 4 === 3 && channel > 1)).toBe(false);
      else expect(Math.abs(separate[strongest * 4 + 3] - baselineAlpha)).toBeLessThanOrEqual(2);
      expect(validationErrors).toEqual([]);
    }
    if (mode === 'constant') {
      // A one-pixel Gaussian four pixels outside the view still has visible filtered pixels.
      const edgeSource = {
        positions: new Float32Array([0, 0, 0]),
        scales: new Float32Array([1, 1, 1]),
        rotations: new Float32Array([1, 0, 0, 0]),
        colors: new Uint8Array([255, 255, 255, 255]),
        opacities: new Float32Array([0.9])
      };
      const edgeLayer = new SplatLayer({
        id: 'filtered-edge',
        data: [{}],
        getSource: edgeSource,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: [68, 0, -10],
        kernelVariance: 4,
        material: {unlit: true}
      });
      const at = frames;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error('Filtered edge render timed out.')),
          15000
        );
        deck!.setProps({
          views: new OrthographicView({id: 'filtered-edge-view'}),
          viewState: {target: [0, 0, 0], zoom: 0},
          layers: [edgeLayer],
          onAfterRender: () => {
            if (++frames > at + 4) {
              deck!.pause();
              window.clearTimeout(timeout);
              resolve();
            }
          }
        });
        deck!.resume();
      });
      pixels = await readFrame(device!, colorTexture, framebuffer);
      expect(pixels.some((channel, index) => index % 4 === 3 && channel > 2)).toBe(true);
      // A new restrictive peer and second view broaden filtering enough to reveal
      // an owner initially outside even the full-resolution padded frustum.
      const widerEdge = edgeLayer.clone({
        getPosition: [74, 0, -10],
        // A dense aggregate keeps the reduced-resolution tail above alphaCutoff.
        getSource: {...edgeSource, opticalDepths: new Float32Array([10])}
      });
      const peer = edgeLayer.clone({
        id: 'density-peer',
        getPosition: [0, 0, -10],
        maxRenderPixels: 64 * 64
      });
      const peerFrame = frames;
      let firstVisibility: number | undefined;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error('Shared filter edge render timed out.')),
          15000
        );
        deck!.setProps({
          views: [new OrthographicView({id: 'edge-a'}), new OrthographicView({id: 'edge-b'})],
          layers: [widerEdge, peer],
          onAfterRender: () => {
            firstVisibility ??= widerEdge.splatStats.visibleInstances;
            if (++frames > peerFrame + 5) {
              deck!.pause();
              window.clearTimeout(timeout);
              resolve();
            }
          }
        });
        deck!.resume();
      });
      expect(firstVisibility).toBe(0);
      expect(widerEdge.splatStats.visibleInstances).toBe(1);
      pixels = await readFrame(device!, colorTexture, framebuffer);
      expect(
        Array.from({length: 128}, (_, y) => pixels[(y * 128 + 127) * 4 + 3]).some(
          alpha => alpha > 0
        )
      ).toBe(true);
      expect(validationErrors).toEqual([]);
    }
    const empty = (deck!.props.layers[0] as SplatLayer).clone({data: []});
    const nextFrame = frames + 2;
    await new Promise<void>(resolve => {
      deck!.setProps({
        layers: [empty],
        onAfterRender: () => {
          if (++frames >= nextFrame) {
            deck!.pause();
            resolve();
          }
        }
      });
      deck!.resume();
    });
    expect(empty.getSubLayers()).toEqual([]);
    expect(empty.splatStats.renderedSplats).toBe(0);
    const cleared = await readFrame(device, colorTexture, framebuffer);
    expect(cleared.some((channel, index) => index % 4 === 3 && channel > 1)).toBe(false);
    expect(validationErrors).toEqual([]);
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    framebuffer?.destroy();
    colorTexture?.destroy();
    device?.destroy();
    parent.remove();
  }
}

async function renderParityScene(
  type: 'webgl' | 'webgpu',
  layers: SplatLayer[],
  viewState: {
    target: [number, number, number];
    zoom: number;
    rotationX: number;
    rotationOrbit: number;
  },
  effects?: LightingEffect[]
): Promise<Uint8Array> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: TestDeck | undefined;
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
        () => reject(new Error(`Timed out while rendering parity scene with ${type}.`)),
        30_000
      );
      deck = new TestDeck({
        _framebuffer: framebuffer,
        useDevicePixels: false,
        device,
        parent,
        width: 128,
        height: 128,
        _animate: true,
        views: new OrbitView({id: 'splat-parity', orbitAxis: 'Y', orthographic: true}),
        initialViewState: viewState,
        ...(effects ? {effects} : {}),
        layers,
        onAfterRender: () => {
          if (++frames < 8 || capturing) return;
          capturing = true;
          deck!.pause();
          readFrame(device!, colorTexture, framebuffer).then(
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
    return pixels;
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    framebuffer?.destroy();
    colorTexture?.destroy();
    device?.destroy();
    parent.remove();
  }
}

function sortedLayers(reverseLayerOrder = false): SplatLayer[] {
  const source = (color: number[], depths: number[]) => ({
    positions: new Float32Array(depths.flatMap(z => [0, 0, z])),
    scales: new Float32Array(depths.flatMap(() => [1.5, 1.5, 0.01])),
    rotations: new Float32Array(depths.flatMap(() => [1, 0, 0, 0])),
    colors: new Uint8Array(depths.flatMap(() => [...color, 255])),
    opacities: new Float32Array(depths.map(() => 0.9))
  });
  const red = source([255, 0, 0], [0.1, -0.2]);
  const blue = {
    ...source([0, 0, 255], [0, -0.3]),
    opticalDepths: new Float32Array([-Math.log(0.1), -Math.log(0.1)])
  };
  const assets = [red, blue].map(source => ({
    type: 'prepared-splats' as const,
    source,
    hierarchy: [{source, error: 0}]
  }));
  const layers = assets.map(
    (data, index) =>
      new SplatLayer({
        id: `parity-order-${index}`,
        data,
        kernelVariance: 0,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: [0, 0, 0],
        transparency: 'sorted',
        getTranslation: [0, 0, -1],
        material: {unlit: true}
      })
  );
  return reverseLayerOrder ? layers.reverse() : layers;
}

async function renderSortedFixture(
  type: 'webgl' | 'webgpu',
  rotationOrbit = 0,
  reverseLayerOrder = false
): Promise<number[]> {
  const pixels = await renderParityScene(type, sortedLayers(reverseLayerOrder), {
    target: [0, 0, -1],
    zoom: 5,
    rotationX: 0,
    rotationOrbit
  });
  const center = (64 * 128 + 64) * 4;
  return Array.from(pixels.slice(center, center + 4));
}

async function renderHighlightFixture(
  type: 'webgl' | 'webgpu',
  highlighted = true,
  transparency: 'weighted' | 'sorted' = 'sorted'
): Promise<number[]> {
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1.5, 1.5, 0.01]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([40, 180, 80, 255]),
    opacities: new Float32Array([0.5])
  };
  const data = {type: 'prepared-splats' as const, source, hierarchy: [{source, error: 0}]};
  const pixels = await renderParityScene(
    type,
    [
      new SplatLayer({
        id: 'parity-highlight',
        data,
        kernelVariance: 0,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: [0, 0, -1],
        transparency,
        ...(highlighted && {
          pickable: true,
          highlightedObjectIndex: 0,
          highlightColor: [255, 0, 0, 128]
        }),
        material: {unlit: true}
      })
    ],
    {target: [0, 0, -1], zoom: 5, rotationX: 0, rotationOrbit: 0}
  );
  const center = (64 * 128 + 64) * 4;
  return Array.from(pixels.slice(center, center + 4));
}

async function renderWeightedOverlapFixture(
  type: 'webgl' | 'webgpu',
  hierarchical = false
): Promise<number[]> {
  const count = hierarchical ? 16 : 2;
  const canopyColor = [72, 168, 56];
  const source = {
    positions: new Float32Array(Array.from({length: count}, () => [0, 0, 0]).flat()),
    scales: new Float32Array(Array.from({length: count}, () => [1.5, 1.5, 0.01]).flat()),
    rotations: new Float32Array(Array.from({length: count}, () => [1, 0, 0, 0]).flat()),
    colors: new Uint8Array(
      hierarchical
        ? Array.from({length: count}, () => [...canopyColor, 255]).flat()
        : [255, 0, 0, 255, 0, 0, 255, 255]
    ),
    opacities: new Float32Array(Array.from({length: count}, () => (hierarchical ? 0.9 : 0.5))),
    // Hierarchy aggregation stores extinction directly, unlike authored leaf splats.
    ...(hierarchical && {opticalDepths: new Float32Array(count).fill(-Math.log(0.9))})
  };
  const pixels = await renderParityScene(
    type,
    [
      new SplatLayer({
        id: 'weighted-overlap',
        data: [{}],
        getSource: source,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: [0, 0, -1],
        kernelVariance: 0,
        material: {unlit: true}
      })
    ],
    {target: [0, 0, -1], zoom: 5, rotationX: 0, rotationOrbit: 0}
  );
  const center = (64 * 128 + 64) * 4;
  return Array.from(pixels.slice(center, center + 4));
}

async function renderLitFixture(type: 'webgl' | 'webgpu'): Promise<number[]> {
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1.5, 1.5, 0.01]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([70, 150, 55, 255]),
    opacities: new Float32Array([0.85]),
    // Face the authored crown toward the sun rather than the camera, as tree canopies do.
    normals: new Float32Array([0.35, 0.35, 0.87])
  };
  const pixels = await renderParityScene(
    type,
    [
      new SplatLayer({
        id: 'parity-lit',
        data: [{}],
        getSource: source,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: [0, 0, -1],
        kernelVariance: 0,
        material: {ambient: 0.35, diffuse: 0.75, shininess: 1, specularColor: [0, 0, 0]}
      })
    ],
    {target: [0, 0, -1], zoom: 5, rotationX: 0, rotationOrbit: 0},
    [
      new LightingEffect({
        ambient: new AmbientLight({intensity: 0.2}),
        sun: new DirectionalLight({direction: [-1, -1, -2], intensity: 1.1})
      })
    ]
  );
  const center = (64 * 128 + 64) * 4;
  return Array.from(pixels.slice(center, center + 4));
}

function expectChannelsClose(actual: number[], expected: number[], tolerance = 4): void {
  expect(actual).toHaveLength(expected.length);
  const maxDifference = Math.max(
    ...actual.map((channel, index) => Math.abs(channel - expected[index]))
  );
  expect(maxDifference, `actual ${actual} vs expected ${expected}`).toBeLessThanOrEqual(tolerance);
}

describe('SplatLayer graphics backend compatibility', () => {
  it('renders prepared anisotropic Gaussians with deformation on WebGL2', async () => {
    await renderSplatLayer('webgl');
    await renderSplatLayer('webgl', 'heterogeneous');
    await renderSplatLayer('webgl', 'direct');
    await renderSplatLayer('webgl', 'constant', 'sorted');
    await renderSplatLayer('webgl', 'heterogeneous', 'sorted');
  }, 40_000);

  it('renders prepared anisotropic Gaussians with deformation on WebGPU', async ({skip}) => {
    await requireWebGPU(skip);

    await renderSplatLayer('webgpu');
    await renderSplatLayer('webgpu', 'heterogeneous');
    await renderSplatLayer('webgpu', 'direct');
    await renderSplatLayer('webgpu', 'constant', 'sorted');
    await renderSplatLayer('webgpu', 'heterogeneous', 'sorted');
  }, 40_000);

  it('keeps sorted front-to-back color order equivalent on WebGL2 and WebGPU', async ({skip}) => {
    await requireWebGPU(skip);

    const webglFront = await renderSortedFixture('webgl');
    const webgpuFront = await renderSortedFixture('webgpu');
    expectChannelsClose(webglFront, [232, 0, 23, 255]);
    expect(webglFront[0]).toBeGreaterThan(webglFront[2] * 4);
    expect(webgpuFront[0]).toBeGreaterThan(webgpuFront[2] * 4);
    expectChannelsClose(webgpuFront, webglFront);

    const webglReversed = await renderSortedFixture('webgl', 180);
    const webgpuReversed = await renderSortedFixture('webgpu', 180);
    expectChannelsClose(webglReversed, [23, 0, 232, 255]);
    expect(webglReversed[2]).toBeGreaterThan(webglReversed[0] * 4);
    expect(webgpuReversed[2]).toBeGreaterThan(webgpuReversed[0] * 4);
    expectChannelsClose(webgpuReversed, webglReversed);

    const webgpuReordered = await renderSortedFixture('webgpu', 0, true);
    expectChannelsClose(webgpuReordered, webgpuFront);
  }, 60_000);

  it('composites highlighted SplatLayer colors equivalently on WebGL2 and WebGPU', async ({
    skip
  }) => {
    await requireWebGPU(skip);

    const unhighlightedWebgl = await renderHighlightFixture('webgl', false);
    const unhighlightedWebgpu = await renderHighlightFixture('webgpu', false);
    expectChannelsClose(unhighlightedWebgl, [20, 90, 40, 127]);
    expectChannelsClose(unhighlightedWebgpu, unhighlightedWebgl);

    const webgl = await renderHighlightFixture('webgl');
    const webgpu = await renderHighlightFixture('webgpu');
    expectChannelsClose(webgl, [138, 45, 20, 191]);
    expect(webgl[0]).toBeGreaterThan(webgl[1] * 2);
    expect(webgl[3]).toBeGreaterThan(100);
    expectChannelsClose(webgpu, webgl);
  }, 40_000);

  it('composites weighted highlighted SplatLayer colors equivalently on WebGL2 and WebGPU', async ({
    skip
  }) => {
    await requireWebGPU(skip);

    const webgl = await renderHighlightFixture('webgl', true, 'weighted');
    const webgpu = await renderHighlightFixture('webgpu', true, 'weighted');
    expectChannelsClose(webgl, [92, 30, 13, 127]);
    expectChannelsClose(webgpu, webgl);
  }, 40_000);

  it('adds overlapping weighted optical depth equivalently on WebGL2 and WebGPU', async ({
    skip
  }) => {
    await requireWebGPU(skip);

    const webgl = await renderWeightedOverlapFixture('webgl');
    const webgpu = await renderWeightedOverlapFixture('webgpu');
    // Two half-opaque coincident Gaussians resolve to 1 - (1 - .5)^2 = .75 alpha.
    // A WebGPU MRT target with blending disabled would retain only the final .5 depth.
    expectChannelsClose(webgl, [96, 0, 96, 191]);
    expect(webgl[3]).toBeGreaterThan(185);
    expectChannelsClose(webgpu, webgl);
  }, 40_000);

  it('composites hierarchical canopy optical depth equivalently on WebGL2 and WebGPU', async ({
    skip
  }) => {
    await requireWebGPU(skip);

    const webgl = await renderWeightedOverlapFixture('webgl', true);
    const webgpu = await renderWeightedOverlapFixture('webgpu', true);
    // TreeLayer hierarchy sources use opticalDepths. Sixteen 10% transmittance splats resolve
    // to 1 - .9^16 alpha; an unblended MRT transmission target would only retain one 10% splat.
    expect(webgl[1]).toBeGreaterThan(130);
    expect(webgl[3]).toBeGreaterThan(200);
    expectChannelsClose(webgpu, webgl);
  }, 40_000);

  it('applies authored Phong foliage lighting equivalently on WebGL2 and WebGPU', async ({
    skip
  }) => {
    await requireWebGPU(skip);

    const webgl = await renderLitFixture('webgl');
    const webgpu = await renderLitFixture('webgpu');
    // The directional term visibly modulates the unlit, alpha-premultiplied green value.
    expect(Math.abs(webgl[1] - 150 * 0.85)).toBeGreaterThan(8);
    expect(webgl[3]).toBeGreaterThan(200);
    expectChannelsClose(webgpu, webgl, 5);
  }, 40_000);
});
