// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  getShaderAssembler,
  LightingEffect,
  OrbitView,
  OrthographicViewport
} from '@deck.gl/core';
import {Buffer, luma, Texture, type Device, type TextureFormat} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {expect, it} from 'vitest';
import {requireWebGPUAdapter} from '../webgpu-test-utils';
import {
  getTreeRingRadius,
  TREE_STATE_ROWS_PER_LINE,
  TREE_STATE_TEXTURE_WIDTH,
  TREE_TEMPLATE_TEXTURE_WIDTH
} from '../../src/tree-layer/tree-photoreal-layout';
import {getTreeWgslTextures, treePhotorealWgsl} from '../../src/tree-layer/tree-photoreal-wgsl';
import {TreeStateStore} from '../../src/tree-layer/tree-state-store';
import {TreeLayer} from '../../src/tree-layer/tree-layer';

const SIZE = 128;
const FIRST_ROW = TREE_STATE_ROWS_PER_LINE - 1;
const WIDTH = TREE_TEMPLATE_TEXTURE_WIDTH;
const GROWTH = [0.5, 0.85];
const binding = getTreeWgslTextures([
  'treeState',
  'treeLimbs',
  'treeLeaves',
  'treeCropAnchors',
  'treeCropRanks'
]);

function createTemplateTexture(device: Device, channels: number, offset: number, value: number) {
  const data = new Float32Array(WIDTH * 2 * channels);
  data[(WIDTH - 1) * channels + offset] = value;
  data[WIDTH * channels + offset] = value * 2;
  return device.createTexture({
    format: (channels === 1 ? 'r32float' : 'rgba32float') satisfies TextureFormat,
    width: WIDTH,
    height: 2,
    data,
    mipLevels: 1
  });
}

it('draws photoreal WebGPU geometry from packed state and template textures', async ({skip}) => {
  await requireWebGPUAdapter(skip);
  const device = await luma.createDevice({
    type: 'webgpu',
    featureLevel: 'core',
    adapters: [webgpuAdapter]
  });
  const errors: string[] = [];
  const handle = (device as Device & {handle: GPUDevice}).handle;
  const recordError = (event: GPUUncapturedErrorEvent) => errors.push(event.error.message);
  handle.addEventListener('uncapturederror', recordError);
  try {
    expect(handle.features.has('float32-filterable')).toBe(false);
    const store = new TreeStateStore(FIRST_ROW + 2);
    GROWTH.forEach((growth, index) => {
      store.setRow(
        FIRST_ROW + index,
        {position: [index ? 2 : -2, 0, 0], crownX: 1, crownY: 1, growth},
        {now: 0, clock: 0, isNew: true}
      );
    });
    const state = device.createTexture({
      format: 'rgba32float',
      width: TREE_STATE_TEXTURE_WIDTH,
      height: store.lineCount,
      data: store.data,
      mipLevels: 1
    });
    const limbs = createTemplateTexture(device, 4, 0, 0.125);
    const leaves = createTemplateTexture(device, 4, 1, 0.25);
    const anchors = createTemplateTexture(device, 4, 2, 0.375);
    const ranks = createTemplateTexture(device, 1, 0, 0.5);
    const color = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    const framebuffer = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [color]
    });
    const readback = device.createBuffer({
      usage: Buffer.COPY_DST | Buffer.MAP_READ,
      byteLength: SIZE * SIZE * 4
    });
    const model = new Model(device, {
      id: 'photoreal-tree-wgsl-layout-probe',
      shaderAssembler: getShaderAssembler('wgsl'),
      shaderLayout: binding.shaderLayout,
      modules: [treePhotorealWgsl],
      source: /* wgsl */ `
${binding.source}

struct Probe {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex fn vertexMain(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32
) -> Probe {
  let row = ${FIRST_ROW}u + instance;
  let life = treeReadLife(treeState, row);
  let place = treeReadPlace(treeState, row, life.growth);
  let points = array<vec3<f32>, 3>(
    vec3<f32>(-0.5, -0.5, 0.25),
    vec3<f32>(0.5, -0.5, 0.25),
    vec3<f32>(0.0, 0.5, 0.25)
  );
  let point = treeTurnYaw(treeToMetres(points[vertex], place.size), place.yaw);
  let projection = treeProject(point, place);
  let limb = treeLimbTexel(treeLimbs, 1023u + instance, 1u - instance);
  let leaf = treeLeafTexel(treeLeaves, 511u + instance, 3u - 3u * instance);
  let anchor = treeCropAnchorTexel(treeCropAnchors, 1023u + instance, 1u - instance);
  let rank = treeCropRankTexel(treeCropRanks, 62u, 1u + instance);
  let ring = treeRingRadius(1.0, 0.0, life);
  return Probe(projection.clipPosition, vec4<f32>(ring, limb.x + leaf.y, anchor.z * rank, 1.0));
}

@fragment fn fragmentMain(input: Probe) -> @location(0) vec4<f32> {
  return input.color;
}
`,
      vertexCount: 3,
      instanceCount: 2,
      isInstanced: true,
      parameters: {cullMode: 'none'}
    });
    try {
      model.shaderInputs.setProps({
        project: {
          viewport: new OrthographicViewport({
            width: SIZE,
            height: SIZE,
            zoom: 4,
            target: [0, 0, 4]
          }),
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
        },
        treePhotoreal: {shape: [0.25, 0, 0, 0], woodLevel: [0, 0, 0, 0]}
      });
      model.setBindings({
        treeState: state,
        treeLimbs: limbs,
        treeLeaves: leaves,
        treeCropAnchors: anchors,
        treeCropRanks: ranks
      });
      const pass = device.beginRenderPass({framebuffer, clearColor: [0, 0, 0, 0]});
      const drawn = model.draw(pass);
      pass.end();
      expect(drawn).toBe(true);
      device.submit();
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({
        sourceTexture: color,
        destinationBuffer: readback,
        bytesPerRow: SIZE * 4,
        width: SIZE,
        height: SIZE
      });
      device.submit(encoder.finish());
      const pixels = new Uint8Array(await readback.readAsync());
      expect(errors).toEqual([]);
      for (const [index, x] of [32, 96].entries()) {
        const start = (64 * SIZE + x) * 4;
        const factor = index + 1;
        const expected = [
          getTreeRingRadius(1, 0, GROWTH[index]),
          0.375 * factor,
          0.1875 * factor ** 2,
          1
        ];
        expected.forEach((value, channel) => {
          expect(Math.abs(pixels[start + channel] / 255 - value)).toBeLessThan(1 / 255);
        });
      }
      expect(pixels[(64 * SIZE + 64) * 4 + 3]).toBe(0);
    } finally {
      model.destroy();
      readback.destroy();
      framebuffer.destroy();
      color.destroy();
      ranks.destroy();
      anchors.destroy();
      leaves.destroy();
      limbs.destroy();
      state.destroy();
    }
  } finally {
    handle.removeEventListener('uncapturederror', recordError);
    device.destroy();
  }
}, 30_000);

it('draws and picks the photoreal TreeLayer wood, blades and crop on WebGPU', async ({skip}) => {
  await requireWebGPUAdapter(skip);
  const width = 896;
  const height = 448;
  const parent = document.createElement('div');
  document.body.append(parent);
  const errors: string[] = [];
  const device = await luma.createDevice({
    type: 'webgpu',
    featureLevel: 'core',
    adapters: [webgpuAdapter],
    onError: error => {
      errors.push(error.message);
    },
    createCanvasContext: {container: parent, width, height, useDevicePixels: false}
  });
  const handle = (device as Device & {handle: GPUDevice}).handle;
  const recordError = (event: GPUUncapturedErrorEvent) => errors.push(event.error.message);
  handle.addEventListener('uncapturederror', recordError);
  const color = device.createTexture({
    width,
    height,
    format: 'rgba8unorm',
    usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
  });
  const framebuffer = device.createFramebuffer({
    width,
    height,
    colorAttachments: [color],
    depthStencilAttachment: 'depth24plus'
  });
  const readback = device.createBuffer({
    byteLength: width * height * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  const rows = (['citrus', 'pine', 'palm'] as const).map((species, index) => ({
    position: [(index - 1) * 3.2, 0, 0] as [number, number, number],
    species,
    height: 4.8,
    crownRadius: 1.4,
    growth: 1,
    crop:
      species === 'citrus'
        ? {
            kind: 'fruit' as const,
            count: 48,
            radius: 0.14,
            ripeness: 1,
            color: [242, 123, 24] as const
          }
        : null
  }));
  let drawCount = 0;
  let deck: Deck | undefined;
  try {
    const pixels = await new Promise<Uint8Array>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('TreeLayer did not render')),
        45_000
      );
      deck = new Deck({
        _framebuffer: framebuffer,
        _animate: true,
        device,
        parent,
        width,
        height,
        useDevicePixels: false,
        views: new OrbitView({orbitAxis: 'Z', fovy: 40}),
        initialViewState: {target: [0, 0, 2.2], zoom: 6.3, rotationX: 28, rotationOrbit: 0},
        layers: [
          new TreeLayer({
            id: 'photoreal-tree',
            data: rows,
            pickable: true,
            getTree: row => row,
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
          })
        ],
        effects: [
          new LightingEffect({
            ambient: new AmbientLight({color: [180, 205, 239], intensity: 1.2}),
            sun: new DirectionalLight({
              color: [255, 241, 207],
              direction: [-1, -2, -3],
              intensity: 2
            })
          })
        ],
        onAfterRender() {
          if (++drawCount !== 12) return;
          window.clearTimeout(timeout);
          deck?.setProps({_animate: false});
          device.submit();
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer({
            sourceTexture: color,
            destinationBuffer: readback,
            bytesPerRow: width * 4,
            width,
            height
          });
          device.submit(encoder.finish());
          readback.readAsync().then(data => resolve(new Uint8Array(data)), reject);
        },
        onError(error) {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
    });
    const score = (
      predicate: (r: number, g: number, b: number) => boolean,
      left: number,
      right: number
    ) => {
      let count = 0;
      let point = {x: 0, y: 0};
      let highest = 0;
      for (let y = 2; y < height - 2; y++) {
        for (let x = left; x < right; x++) {
          const pixel = (y * width + x) * 4;
          const [r, g, b, a] = pixels.subarray(pixel, pixel + 4);
          if (a < 16 || !predicate(r, g, b)) continue;
          count++;
          const strength =
            predicate(pixels[pixel - 4], pixels[pixel - 3], pixels[pixel - 2]) &&
            predicate(pixels[pixel + 4], pixels[pixel + 5], pixels[pixel + 6])
              ? r + g + b
              : 0;
          if (strength > highest) {
            point = {x, y};
            highest = strength;
          }
        }
      }
      return {count, point};
    };
    const isGreen = (r: number, g: number, b: number) => g > 25 && g > r * 1.2 && g > b * 1.2;
    const isWood = (r: number, g: number, b: number) => r > 12 && r > g * 1.2 && r > b * 2;
    const isOrange = (r: number, g: number, b: number) =>
      r > 125 && g > 45 && r > g * 1.2 && g > b * 2;
    const leaf = score(isGreen, 55, 340);
    const wood = score(isWood, 390, 525);
    const crop = score(isOrange, 55, 340);
    expect(leaf.count).toBeGreaterThan(4_000);
    expect(wood.count).toBeGreaterThan(100);
    expect(crop.count).toBeGreaterThan(100);
    const palm = score(isGreen, 610, 835);
    expect(palm.count).toBeGreaterThan(100);
    const cropPick = await deck!.pickObjectAsync({
      x: crop.point.x,
      y: height - 1 - crop.point.y,
      radius: 2,
      layerIds: ['photoreal-tree-photoreal-crops']
    });
    expect(cropPick?.object).toEqual(rows[0]);
    expect(cropPick?.sourceLayer?.id).toContain('-photoreal-crops-');
    expect(errors.slice(0, 2)).toEqual([]);
  } finally {
    deck?.finalize();
    handle.removeEventListener('uncapturederror', recordError);
    readback.destroy();
    framebuffer.destroy();
    color.destroy();
    device.destroy();
    parent.remove();
  }
}, 60_000);

it('casts and receives directional shadows on the highest-detail WebGPU tree', async ({skip}) => {
  await requireWebGPUAdapter(skip);
  const size = 256;
  const parent = document.createElement('div');
  document.body.append(parent);
  const errors: string[] = [];
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    onError: error => errors.push(error.message),
    createCanvasContext: {container: parent, width: size, height: size, useDevicePixels: false}
  });
  const handle = (device as Device & {handle: GPUDevice}).handle;
  const recordError = (event: GPUUncapturedErrorEvent) => errors.push(event.error.message);
  handle.addEventListener('uncapturederror', recordError);
  const color = device.createTexture({
    width: size,
    height: size,
    format: 'rgba8unorm',
    usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
  });
  const framebuffer = device.createFramebuffer({
    width: size,
    height: size,
    colorAttachments: [color],
    depthStencilAttachment: 'depth24plus'
  });
  const readback = device.createBuffer({
    byteLength: size * size * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  const light = new LightingEffect({
    ambient: new AmbientLight({intensity: 0.7}),
    sun: new DirectionalLight({direction: [-1, -2, -3], intensity: 2.4, _shadow: true})
  });
  let frames = 0;
  const deck = new Deck({
    _framebuffer: framebuffer,
    _animate: false,
    device,
    parent,
    width: size,
    height: size,
    useDevicePixels: false,
    views: new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.25, far: 5}),
    initialViewState: {target: [0, 0, 2.3], zoom: 5.6, rotationX: 28, rotationOrbit: 0},
    layers: [
      new TreeLayer({
        id: 'shadowed-tree',
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: [{position: [0, 0, 0], species: 'citrus', height: 4.8, crownRadius: 1.4}],
        lodBias: -2
      })
    ],
    effects: [light],
    onAfterRender: () => frames++,
    onError: error => errors.push(error.message)
  });
  const capture = async () => {
    const start = frames;
    await new Promise<void>(resolve => {
      deck.setProps({
        _animate: true,
        onAfterRender() {
          if (++frames < start + 3) return;
          deck.setProps({_animate: false});
          resolve();
        }
      });
    });
    device.submit();
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: color,
      destinationBuffer: readback,
      bytesPerRow: size * 4,
      width: size,
      height: size
    });
    device.submit(encoder.finish());
    return new Uint8Array(await readback.readAsync());
  };
  try {
    const shadowed = await capture();
    const layer = deck.layerManager!.getLayers().find(layer => layer instanceof TreeLayer);
    expect(layer?.state.photoreal?.groups.values().next().value?.buckets[0]).toHaveLength(1);
    deck.setProps({layerFilter: ({renderPass}) => renderPass !== 'shadow'});
    const lit = await capture();
    let dimmed = 0;
    for (let i = 0; i < lit.length; i += 4) {
      if (lit[i + 3] > 0 && shadowed[i + 3] === lit[i + 3] && lit[i + 1] - shadowed[i + 1] > 8) {
        dimmed++;
      }
    }
    expect(dimmed).toBeGreaterThan(150);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    handle.removeEventListener('uncapturederror', recordError);
    readback.destroy();
    framebuffer.destroy();
    color.destroy();
    device.destroy();
    parent.remove();
  }
}, 90_000);
