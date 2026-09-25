// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, beforeEach, describe, expect, inject, it} from 'vitest';
import {requireWebGPUAdapter} from '../webgpu-test-utils';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter, type WebGPUDevice} from '@luma.gl/webgpu';
import {COORDINATE_SYSTEM, Deck, OrbitView, type Layer} from '@deck.gl/core';
import {
  _TerrainExtension as TerrainExtension,
  type TerrainExtensionProps
} from '@deck.gl/extensions';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {Geometry} from '@luma.gl/engine';
import type {FlameTrailLayerProps} from '../../src/index';
import {FlameTrailLayer} from '../../src/index';

const SIZE = 256;
const DATA = [
  {
    path: [
      [-100, 0],
      [100, 0]
    ],
    timestamps: [0, 100]
  }
];
// Keep slow software GPUs from accumulating frames while an async pixel read is pending.
class TestDeck extends Deck {
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

async function readFrame(): Promise<Uint8Array> {
  if (device!.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }
  // Submit the render pass before copying; WebGPU readback is asynchronous.
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
    // Normalize texture origin to WebGL's bottom-left pixel coordinates.
    for (let y = 0; y < SIZE; y++) {
      pixels.set(data.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), (SIZE - 1 - y) * SIZE * 4);
    }
    return pixels;
  } finally {
    buffer.destroy();
  }
}

// Isolate the real particle shader so the volume cannot satisfy the assertions.
class EmberTestLayer extends FlameTrailLayer {
  static layerName = 'EmberTestLayer';

  getShaders() {
    const shaders = super.getShaders();
    if (this.context.device.type === 'webgpu') {
      shaders.inject['  // DECKGL_FILTER_COLOR'] += '\nif (varyings.vFlame.z < 1.5) { discard; }';
    } else {
      shaders.inject['fs:DECKGL_FILTER_COLOR'] += '\nif (vFlame.z < 1.5) discard;';
    }
    return shaders;
  }
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

function renderFrame(
  props: Partial<FlameTrailLayerProps & TerrainExtensionProps> = {},
  sideView: boolean | number = false,
  rotationOrbit = 0,
  embersOnly = false,
  terrain?: Layer,
  timelineTime: number | null = 1000
): Promise<Uint8Array> {
  const LayerClass = embersOnly ? EmberTestLayer : FlameTrailLayer;
  const layer = new LayerClass({
    id: `fire-${props.terrainDrawMode ?? 'xyz'}-${embersOnly ? 'embers' : 'volume'}`,
    data: DATA,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    getPath: d => d.path,
    getTimestamps: d => d.timestamps,
    currentTime: 100,
    trailLength: 100,
    widthUnits: 'pixels',
    getWidth: 60,
    pickable: true,
    ...props
  });
  return new Promise((resolve, reject) => {
    // Freeze the renderer timeline for pixel comparisons, not the layer API.
    const onBeforeRender = () => {
      if (timelineTime !== null) {
        layer.context.timeline.pause();
        layer.context.timeline.setTime(timelineTime);
      }
    };
    let renderedFrames = 0;
    let captured = false;
    const onAfterRender = () => {
      // TerrainEffect registers a default shader module, which rebuilds the
      // source model on the next update before its height map is valid.
      if (
        captured ||
        (device!.type === 'webgpu' && layer.getModels().some(model => model.pipeline.isPending))
      )
        return;
      if (terrain && renderedFrames++ < 2) return;
      captured = true;
      deck!.pause();
      readFrame().then(resolve, reject);
    };
    if (deck) {
      deck.setProps({layers: [terrain, layer], onBeforeRender, onAfterRender, onError: reject});
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
        views: new OrbitView({orbitAxis: 'Z', orthographic: true}),
        initialViewState: {
          target: [0, 0, 0],
          zoom: 0,
          rotationX: typeof sideView === 'number' ? sideView : sideView ? 0 : 90,
          rotationOrbit
        },
        layers: [terrain, layer],
        onBeforeRender,
        onAfterRender,
        onError: reject
      });
    }
  });
}

function brightness(pixels: Uint8Array, x: number, y = SIZE / 2): number {
  const index = (y * SIZE + x) * 4;
  return pixels[index] + pixels[index + 1] + pixels[index + 2];
}

function totalBrightness(pixels: Uint8Array): number {
  return pixels.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : value), 0);
}

function createTerrain(height: (x: number, y: number) => number, draw = false, operation?: 'draw') {
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = 20;
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const x = -150 + col * 15;
      const y = -150 + row * 15;
      positions.push(x, y, height(x, y));
      if (row < segments && col < segments) {
        const vertex = row * (segments + 1) + col;
        indices.push(
          vertex,
          vertex + 1,
          vertex + segments + 1,
          vertex + 1,
          vertex + segments + 2,
          vertex + segments + 1
        );
      }
    }
  }
  return new SimpleMeshLayer({
    id: 'terrain',
    data: [{}],
    mesh: new Geometry({
      topology: 'triangle-list',
      indices: new Uint16Array(indices),
      attributes: {positions: {size: 3, value: new Float32Array(positions)}}
    }),
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    _instanced: false,
    getPosition: [0, 0, 0],
    getColor: [0, 0, 0],
    material: false,
    operation: operation ?? (draw ? 'terrain+draw' : 'terrain'),
    parameters: {depthWriteEnabled: true, cullMode: 'none'}
  });
}

describe.each(['webgl', 'webgpu'] as const)('FlameTrailLayer %s rendering', backend => {
  beforeEach(async ({skip}) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    container = document.createElement('div');
    container.style.cssText = `width: ${SIZE}px; height: ${SIZE}px`;
    document.body.appendChild(container);
    device = await luma.createDevice({
      type: backend,
      _cacheShaders: true,
      _cachePipelines: true,
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
  it('keeps a static trip burning without prop updates or forced Deck animation', async () => {
    const props = {currentTime: 50, fadeTrail: false};
    const live = await renderFrame(props, false, 0, false, undefined, null);
    // No prop updates and no forced Deck animation: the layer requests redraws.
    deck!.setProps({_animate: false});
    const later = await new Promise<Uint8Array>((resolve, reject) => {
      let frames = 0;
      deck!.setProps({
        onAfterRender: () => {
          if (++frames !== 3) return;
          deck!.pause();
          readFrame().then(resolve, reject);
        }
      });
      deck!.resume();
    });
    expect(later.some((value, index) => value !== live[index])).toBe(true);
    // Automatic animation never exposes future path segments.
    for (let x = 135; x < SIZE; x++) expect(brightness(later, x)).toBe(0);
  });

  describe.skipIf(backend === 'webgpu' && !inject('terrainWebGPU'))('GPU terrain fitting', () => {
    it('fits the full flame and its embers to GPU terrain heights', async () => {
      const height = (x: number) => 40 + x * 0.15;
      const props = {currentTime: 180, fadeTrail: false, getWidth: 20};
      const extensions = [new TerrainExtension()];
      const elevatedData = [{...DATA[0], path: DATA[0].path.map(([x, y]) => [x, y, height(x)])}];
      for (const embersOnly of [false, true]) {
        const reference = await renderFrame(
          {...props, data: elevatedData},
          35,
          0,
          embersOnly,
          undefined,
          0
        );
        const fitted = await renderFrame(
          {...props, extensions, terrainDrawMode: 'offset'},
          35,
          0,
          embersOnly,
          createTerrain(height),
          0
        );
        expect(totalBrightness(reference)).toBeGreaterThan(50);
        let difference = 0;
        for (let i = 0; i < fitted.length; i++) {
          if (i % 4 !== 3) difference += Math.abs(fitted[i] - reference[i]);
        }
        // GPU sampling agrees with the same surface supplied as explicit XYZ.
        expect(difference / totalBrightness(reference)).toBeLessThan(0.06);
      }
    });

    it('lets foreground terrain occlude the flame', async () => {
      const height = (_x: number, y: number) =>
        20 + 80 * Math.exp(-(((Math.abs(y) - 45) / 20) ** 2));
      const props = {
        currentTime: 100,
        fadeTrail: false,
        getWidth: 20,
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'offset' as const
      };
      const unobstructed = await renderFrame(props, 25, 0, false, createTerrain(height));
      const occluded = await renderFrame(props, 25, 0, false, createTerrain(height, true));
      expect(totalBrightness(unobstructed)).toBeGreaterThan(1000);
      expect(totalBrightness(occluded)).toBeLessThan(totalBrightness(unobstructed) * 0.5);
    });
  });

  it('renders elevated XYZ flames and respects terrain depth on either backend', async () => {
    const props = {currentTime: 100, fadeTrail: false, getWidth: 20};
    const flat = await renderFrame(props, 25);
    const data = [{...DATA[0], path: DATA[0].path.map(([x, y]) => [x, y, 20])}];
    const elevated = await renderFrame({...props, data}, 25);
    const height = (_x: number, y: number) => 20 + 80 * Math.exp(-(((Math.abs(y) - 45) / 20) ** 2));
    const occluded = await renderFrame(
      {...props, data},
      25,
      0,
      false,
      createTerrain(height, true, 'draw')
    );
    expect(totalBrightness(elevated)).toBeGreaterThan(1000);
    expect(elevated.some((value, index) => value !== flat[index])).toBe(true);
    expect(totalBrightness(occluded)).toBeLessThan(totalBrightness(elevated) * 0.5);
  });

  it('supports analytic antialiasing and highlighted picking colors', async () => {
    const props = {currentTime: 75, trailLength: 50, antialiasing: true};
    const normal = await renderFrame(props);
    expect(brightness(normal, 138)).toBeGreaterThan(20);
    expect((await deck!.pickObjectAsync({x: 138, y: 128}))?.object).toBe(DATA[0]);
    const highlighted = await renderFrame({
      ...props,
      highlightedObjectIndex: 0,
      highlightColor: [0, 255, 0, 255]
    });
    expect(highlighted.some((value, index) => value !== normal[index])).toBe(true);
    expect(highlighted[(128 * SIZE + 138) * 4 + 1]).toBeGreaterThan(
      highlighted[(128 * SIZE + 138) * 4]
    );
    expect(brightness(highlighted, 218)).toBe(0);
  });

  it('keeps a continuous flame when a path is subdivided into short segments', async () => {
    const createPath = (segments: number) => [
      {
        path: Array.from({length: segments + 1}, (_, i) => {
          const x = -100 + (i * 200) / segments;
          return [x, x * x * 0.002];
        }),
        timestamps: Array.from({length: segments + 1}, (_, i) => (i * 2) / segments)
      }
    ];
    // No timestamp bin reaches an ember emission. Only the volume is compared.
    const props = {currentTime: 2, fadeTrail: false, getWidth: 35};
    const coarse = await renderFrame({...props, data: createPath(40)}, 20, 25);
    const dense = await renderFrame({...props, data: createPath(200)}, 20, 25);
    let difference = 0;
    let samples = 0;
    for (let i = 0; i < coarse.length; i += 4) {
      if (coarse[i] + dense[i] < 10) continue;
      for (let c = 0; c < 3; c++) difference += Math.abs(coarse[i + c] - dense[i + c]);
      samples += 3;
    }
    expect(samples).toBeGreaterThan(1000);
    expect(difference / samples).toBeLessThan(3);
  });

  // Sample an active burst; quiet intervals intentionally contain no particles.
  it('renders sparse, warm embers that stay near the plume', async () => {
    const pixels = await renderFrame(
      {currentTime: 180, fadeTrail: false, getWidth: 20},
      true,
      0,
      true,
      undefined,
      0
    );
    let emberPixels = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (brightness(pixels, x, y) <= 10) continue;
        emberPixels++;
        // Small airborne flecks within 2.75 path widths of the ground.
        expect(y).toBeGreaterThan(140);
        expect(y).toBeLessThan(184);
        const offset = (y * SIZE + x) * 4;
        expect(pixels[offset]).toBeGreaterThan(pixels[offset + 1] * 1.5);
      }
    }
    expect(emberPixels).toBeGreaterThan(0);
    expect(emberPixels).toBeLessThan(40);
    const later = await renderFrame(
      {currentTime: 180, fadeTrail: false, getWidth: 20},
      true,
      0,
      true,
      undefined,
      1250
    );
    expect(later.some((value, index) => value !== pixels[index])).toBe(true);
  });

  it('renders above the ground plane when viewed from the side', async () => {
    const pixels = await renderFrame({currentTime: 95, fadeTrail: false}, true);
    // In this view the path itself is edge-on at y=128. Pixels above it prove
    // the flame occupies world-space height rather than a ground-plane ribbon.
    let raisedPixels = 0;
    for (let y = 150; y < 215; y++) {
      for (let x = 30; x < 220; x++) {
        if (brightness(pixels, x, y) > 25) raisedPixels++;
      }
    }
    expect(raisedPixels).toBeGreaterThan(100);
  });

  it('does not raise sentinel segments between disconnected paths', async () => {
    const pixels = await renderFrame(
      {
        data: [
          {
            path: [
              [-110, 0],
              [-40, 0]
            ],
            timestamps: [0, 100]
          },
          {
            path: [
              [40, 0],
              [110, 0]
            ],
            timestamps: [0, 100]
          }
        ],
        currentTime: 150,
        fadeTrail: false
      },
      true
    );
    expect(totalBrightness(pixels)).toBeGreaterThan(1000);
    for (let y = 135; y < 245; y++) expect(brightness(pixels, 128, y)).toBe(0);
  });

  it('compiles, renders varying colors, respects the time window, and preserves picking', async () => {
    const pixels = await renderFrame({currentTime: 75, trailLength: 50});
    expect(brightness(pixels, 38)).toBe(0); // timestamp 5: expired
    expect(brightness(pixels, 218)).toBe(0); // timestamp 95: future
    expect(brightness(pixels, 138)).toBeGreaterThan(20); // timestamp 55: burning
    const colors = new Set<string>();
    for (let x = 90; x < 165; x++)
      colors.add(String(pixels.slice((128 * SIZE + x) * 4, (128 * SIZE + x) * 4 + 3)));
    expect(colors.size).toBeGreaterThan(20);
    expect((await deck!.pickObjectAsync({x: 138, y: 128}))?.object).toBe(DATA[0]);
    expect(await deck!.pickObjectAsync({x: 218, y: 128})).toBeNull();
  });

  it('ignores trailLength when fadeTrail is false', async () => {
    const first = await renderFrame({currentTime: 150, fadeTrail: false, trailLength: 10});
    const repeat = await renderFrame({currentTime: 150, fadeTrail: false, trailLength: 900});
    expect(repeat.every((value, index) => value === first[index])).toBe(true);
    const next = await renderFrame({currentTime: 160, fadeTrail: false});
    expect(next.some((value, index) => value !== first[index])).toBe(true);
    expect(brightness(first, 38)).toBeGreaterThan(20);
  });

  it('handles zero-length trails, tint, accessor alpha, and layer opacity', async () => {
    const empty = await renderFrame({trailLength: 0});
    expect(totalBrightness(empty)).toBe(0);
    const full = await renderFrame({fadeTrail: false});
    const translucent = await renderFrame({fadeTrail: false, opacity: 0.3});
    expect(totalBrightness(translucent)).toBeLessThan(totalBrightness(full) * 0.8);
    expect(totalBrightness(translucent)).toBeGreaterThan(0);
    const transparent = await renderFrame({fadeTrail: false, getColor: [255, 255, 255, 0]});
    expect(totalBrightness(transparent)).toBe(0);
    const red = await renderFrame({fadeTrail: false, getColor: [255, 0, 0]});
    expect(totalBrightness(red)).toBeGreaterThan(0);
    expect(red.every((value, index) => index % 4 === 0 || index % 4 === 3 || value === 0)).toBe(
      true
    );
  });
});
