// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  Deck,
  DirectionalLight,
  getShaderAssembler,
  LightingEffect,
  OrbitView,
  OrthographicViewport
} from '@deck.gl/core';
import {Buffer, luma, Texture, type Device, type TextureFormat} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {expect, it} from 'vitest';
import {requireWebGPUAdapter} from '../webgpu-test-utils';
import {getTreeGrowthModel} from '../../src/tree-layer/tree-growth-model';
import {
  TreePhotorealCropLayer,
  type TreeCropData
} from '../../src/tree-layer/tree-photoreal-crop-layer';
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
      colorAttachmentFormats: ['rgba8unorm'],
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
          coordinateSystem: 'cartesian'
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
      species === 'pine'
        ? null
        : {
            kind: 'fruit' as const,
            count: species === 'palm' ? 120 : 48,
            radius: species === 'palm' ? 0.06 : 0.14,
            // Use a distinct test color to tell palm fruit from the shaft in the readback.
            color: species === 'palm' ? ([244, 38, 213] as const) : ([242, 123, 24] as const)
          }
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
            coordinateSystem: 'cartesian'
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
          // Allow the first frame to initialize the view. The readback already waits for the
          // next static frame's GPU work, so skip extra full redraws on software adapters.
          if (++drawCount !== 2) return;
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
    const isDate = (r: number, g: number, b: number) =>
      r > 100 && b > 85 && r > g * 1.8 && b > g * 1.8;
    const leaf = score(isGreen, 55, 340);
    const wood = score(isWood, 390, 525);
    const crop = score(isOrange, 55, 340);
    expect(leaf.count).toBeGreaterThan(4_000);
    expect(wood.count).toBeGreaterThan(100);
    expect(crop.count).toBeGreaterThan(100);
    const palm = score(isGreen, 610, 835);
    expect(palm.count).toBeGreaterThan(100);
    const dates = score(isDate, 610, 835);
    expect(dates.count).toBeGreaterThan(15);
    for (const {point, row} of [
      {point: crop.point, row: rows[0]},
      {point: dates.point, row: rows[2]}
    ]) {
      const cropPick = await deck!.pickObjectAsync({
        // Native WebGPU readback and Deck picking both use top-left pixel coordinates.
        ...point,
        radius: 2,
        layerIds: ['photoreal-tree-photoreal-crops']
      });
      expect(cropPick?.object).toEqual(row);
      expect(cropPick?.sourceLayer?.id).toContain('-photoreal-crops-');
    }
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
}, 120_000);

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
        coordinateSystem: 'cartesian',
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

it('draws WebGPU petals, tilted fruit, ground contact and close crop shadows', async ({skip}) => {
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
  // One known attachment keeps the pixel tests independent of the species' authored anchor order.
  const template = {
    ...getTreeGrowthModel('citrus'),
    cropAnchors: new Float32Array([0, 0, 0.5, 0.1, 0, 0, 0.23, 0]),
    cropAnchorCount: 1
  };
  const store = new TreeStateStore(1);
  const state = device.createTexture({
    format: 'rgba32float',
    width: TREE_STATE_TEXTURE_WIDTH,
    height: store.lineCount,
    data: store.data,
    mipLevels: 1
  });
  const light = new LightingEffect({
    sun: new DirectionalLight({direction: [-1, -2, -3], intensity: 2.4, _shadow: true})
  });
  const view = new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.05, far: 8});
  const initialViewState = {target: [0, 0, 1] as [number, number, number], zoom: 7};
  let frames = 0;
  const deck = new Deck({
    _framebuffer: framebuffer,
    _animate: true,
    device,
    parent,
    width: size,
    height: size,
    useDevicePixels: false,
    views: view,
    initialViewState,
    effects: [light],
    onAfterRender: () => frames++,
    onError: error => errors.push(error.message)
  });
  const shadowRead = new Model(device, {
    id: 'crop-shadow-readback',
    colorAttachmentFormats: ['rgba8unorm'],
    shaderLayout: {
      attributes: [],
      bindings: [
        {name: 'cropShadowMap', type: 'texture', viewDimension: '2d', group: 0, location: 0}
      ]
    },
    source: /* wgsl */ `
@group(0) @binding(0) var cropShadowMap: texture_2d<f32>;

@vertex fn vertexMain(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4<f32> {
  let p = array<vec2<f32>, 3>(vec2<f32>(-1,-1), vec2<f32>(3,-1), vec2<f32>(-1,3));
  return vec4<f32>(p[vertex], 0.0, 1.0);
}

@fragment fn fragmentMain(@builtin(position) pixel: vec4<f32>) -> @location(0) vec4<f32> {
  return textureLoad(cropShadowMap, vec2<i32>(pixel.xy), 0);
}
`,
    vertexCount: 3,
    topology: 'triangle-list'
  });
  const readPixels = async () => {
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
  const capture = async (
    kind: 'fruit' | 'flower',
    lod: number,
    zoom: number,
    rotationX: number,
    dropped = false,
    count = 1
  ) => {
    const target: [number, number, number] = [0, 0, dropped ? 0 : 1];
    const radius = kind === 'flower' || lod === 1 ? 0.33 : 0.16;
    store.setRow(
      0,
      {
        position: [0, 0, 0],
        growth: 1,
        height: 2.4,
        trunkHeight: 0.6,
        crownX: 1,
        crownY: 1,
        crops: [
          {count: dropped ? 0 : count, radius, color: [248, 136, 44], dropped: dropped ? count : 0}
        ]
      },
      {now: 0, clock: 0}
    );
    state.writeData(store.data);
    const refs = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      refs.set([0, index, dropped ? 2 : 0], index * 3);
    }
    const data: TreeCropData = {
      length: count,
      attributes: {instanceCropRef: {value: refs, size: 3}},
      *[Symbol.iterator]() {
        for (let index = 0; index < count; index++) yield undefined;
      }
    };
    const layer = new TreePhotorealCropLayer({
      id: `crop-${kind}-${lod}`,
      coordinateSystem: 'cartesian',
      template,
      data,
      stateTexture: state,
      kind,
      lod,
      shedding: dropped,
      parameters: {cullMode: kind === 'flower' ? 'none' : 'back'},
      material: {unlit: true}
    } as never);
    const start = frames;
    deck.setProps({layers: [layer], _animate: true, viewState: {target, zoom, rotationX}});
    await expect.poll(() => frames, {timeout: 15_000}).toBeGreaterThan(start + 6);
    deck.setProps({_animate: false});
    expect(errors.slice(0, 4)).toEqual([]);
    return {layer, pixels: await readPixels()};
  };
  const bounds = (pixels: Uint8Array) => {
    let left = size;
    let right = -1;
    let bottom = size;
    let top = -1;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 240) continue;
      const x = (i / 4) % size;
      const y = Math.floor(i / (4 * size));
      left = Math.min(left, x);
      right = Math.max(right, x);
      bottom = Math.min(bottom, y);
      top = Math.max(top, y);
      count++;
    }
    return {width: right - left + 1, height: top - bottom + 1, count};
  };
  try {
    for (const lod of [0, 1]) {
      const petals = bounds((await capture('flower', lod, lod === 0 ? 8 : 6, 84)).pixels);
      expect.soft(petals.count, `flower mesh ${lod} pixels`).toBeGreaterThan(50);
      expect.soft(petals.height / petals.width, `flower mesh ${lod} aspect`).toBeGreaterThan(0.6);
      expect.soft(petals.height / petals.width, `flower mesh ${lod} aspect`).toBeLessThan(1.6);
      const cluster = bounds(
        (await capture('flower', lod, lod === 0 ? 8 : 6, 84, false, 5)).pixels
      );
      expect
        .soft(cluster.count, `flower mesh ${lod} cluster pixels`)
        .toBeGreaterThan(petals.count * 1.3);
    }

    const tilted = bounds((await capture('fruit', 2, 5.6, -8)).pixels);
    expect.soft(tilted.count, 'tilted fruit pixels').toBeGreaterThan(80);
    expect.soft(tilted.height / tilted.width, 'tilted fruit aspect').toBeGreaterThan(0.8);

    for (const lod of [2, 3]) {
      const ground = await capture('fruit', lod, lod === 2 ? 5.6 : 4.6, 65, true);
      const contact = ground.pixels.filter(
        (value, i) => i % 4 === 3 && value > 2 && value < 230 && ground.pixels[i - 3] < 2
      );
      expect.soft(contact.length, `fallen fruit level ${lod} contact`).toBeGreaterThan(8);
    }

    // This crop is larger than the fine color band's upper bound. Only its caster can draw here.
    const close = await capture('fruit', 1, 8, 12);
    expect(bounds(close.pixels).count).toBe(0);
    const shadowMap = light.getShaderModuleProps(close.layer, {}).shadow.shadowMaps?.[0];
    expect(shadowMap).toBeTruthy();
    shadowRead.setBindings({cropShadowMap: shadowMap!});
    const pass = device.beginRenderPass({framebuffer, clearColor: [1, 1, 1, 1]});
    expect(shadowRead.draw(pass)).toBe(true);
    pass.end();
    const shadowPixels = await readPixels();
    expect(shadowPixels.filter((value, i) => i % 4 === 0 && value < 250).length).toBeGreaterThan(
      100
    );
    expect(errors.slice(0, 4)).toEqual([]);
  } finally {
    deck.finalize();
    handle.removeEventListener('uncapturederror', recordError);
    shadowRead.destroy();
    state.destroy();
    readback.destroy();
    framebuffer.destroy();
    color.destroy();
    device.destroy();
    parent.remove();
  }
}, 60_000);
