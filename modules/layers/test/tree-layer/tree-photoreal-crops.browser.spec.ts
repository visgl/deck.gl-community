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
  type Layer,
  type LayerManager
} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SelectionPulseExtension, TreeLayer, type CropConfig, type TreeSpec} from '../../src';
import {getTreeCropTable} from '../../src/tree-layer/tree-crop';
import {TreePhotorealCropLayer} from '../../src/tree-layer/tree-photoreal-crop-layer';
import {
  TREE_CROP_ANCHOR_STRIDE,
  treeTemplateToMetres
} from '../../src/tree-layer/tree-photoreal-layout';
import {TreePhotorealLeafLayer} from '../../src/tree-layer/tree-photoreal-leaf-layer';
import {TreePhotorealWoodLayer} from '../../src/tree-layer/tree-photoreal-wood-layer';

const SIZE = 256;

/** A camera in metres: about 11 m away, level with the middle of a 6 m tree. */
const ORBIT_VIEW = new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.05, far: 8} as never);
const ORBIT_STATE = {target: [0, 0, 2.8], rotationOrbit: 20, rotationX: 4, zoom: 4.7, maxZoom: 30};

const coordinates = {
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};

/** A color no leaf, bark or sky comes near. */
const MAGENTA = [255, 0, 255, 255] as [number, number, number, number];

function fruit(fields: Partial<CropConfig> = {}): CropConfig {
  return {color: MAGENTA, unripeColor: MAGENTA, count: 60, radius: 0.09, ...fields};
}

/** Leafless, so a test sees what its crops do. Foliage has its own tests. */
const TREE: TreeSpec = {
  species: 'citrus',
  position: [0, 0, 0],
  height: 6,
  crownRadius: 2.6,
  foliage: 0
};

type Scene = {
  deck: Deck;
  errors: string[];
  glErrors: number[];
  layerManager(): LayerManager;
  setViewState(viewState: unknown): void;
  render(layers: Layer[]): Promise<Uint8Array>;
  settle(frames?: number): Promise<Uint8Array>;
  cleanup(): void;
};

const scenes: Scene[] = [];

function mount({
  effects,
  views = ORBIT_VIEW,
  viewState = ORBIT_STATE
}: {
  effects?: LightingEffect[];
  views?: unknown;
  viewState?: unknown;
} = {}): Scene {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.append(parent);
  let pixels = new Uint8Array(),
    frames = 0;
  const errors: string[] = [];
  const glErrors: number[] = [];
  const deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: views as never,
    viewState: viewState as never,
    effects: effects ?? [],
    layers: [],
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error) glErrors.push(error);
      frames++;
    }
  });
  const settle = async (count = 3) => {
    const before = frames;
    await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThan(before + count);
    return pixels;
  };
  const scene: Scene = {
    deck,
    errors,
    glErrors,
    settle,
    layerManager: () => (deck as unknown as {layerManager: LayerManager}).layerManager,
    setViewState: state => deck.setProps({viewState: state as never}),
    render(layers) {
      deck.setProps({layers});
      return settle();
    },
    cleanup() {
      deck.finalize();
      parent.remove();
    }
  };
  scenes.push(scene);
  return scene;
}

afterEach(() => {
  for (const scene of scenes.splice(0)) scene.cleanup();
});

/** One tree whose crops are in `tree.crop`. CI renders in software, and a coarse mesh tests the same. */
function trees(tree: TreeSpec, props: Record<string, unknown> = {}, data: TreeSpec[] = [tree]) {
  return new TreeLayer<TreeSpec>({
    ...coordinates,
    id: 'trees',
    data,
    getTree: (row: TreeSpec) => row,
    pickable: true,
    windTime: 1,
    lodBias: 1,
    ...props
  });
}

function isMagenta(pixels: Uint8Array, offset: number): boolean {
  const green = pixels[offset + 1];
  return pixels[offset + 3] > 0 && pixels[offset] > green + 50 && pixels[offset + 2] > green + 30;
}

/** Crop pixels in a window, x and y as on screen. */
function countCrop(pixels: Uint8Array, x0 = 0, y0 = 0, x1 = SIZE, y1 = SIZE): number {
  let count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (isMagenta(pixels, ((SIZE - 1 - y) * SIZE + x) * 4)) count++;
  return count;
}

function cropMask(pixels: Uint8Array): Uint8Array {
  const mask = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < mask.length; i++) mask[i] = isMagenta(pixels, i * 4) ? 1 : 0;
  return mask;
}

function subLayers(scene: Scene): Layer[] {
  return scene.layerManager().getLayers();
}

function cropLayers(scene: Scene): Layer[] {
  return subLayers(scene).filter(layer => layer instanceof TreePhotorealCropLayer);
}

function treeLayer(scene: Scene): TreeLayer<TreeSpec> {
  return subLayers(scene).find(layer => layer.id === 'trees') as TreeLayer<TreeSpec>;
}

/** Pixels that differ between two frames. */
function countDifferent(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < a.length; offset += 4) {
    if (
      a[offset] !== b[offset] ||
      a[offset + 1] !== b[offset + 1] ||
      a[offset + 2] !== b[offset + 2]
    )
      count++;
  }
  return count;
}

describe('TreeLayer photoreal crops', () => {
  it('keeps photoreal crops in a crop-only pass without preparing canopy geometry', async () => {
    const scene = mount();
    const data = [{...TREE, foliage: 1, crop: fruit({count: 300})}];
    const preparation = TreeLayer.prototype as unknown as {
      updateNearLeaves(...args: unknown[]): void;
      updateLeafSelection(...args: unknown[]): void;
    };
    const prepareLeaves = vi.spyOn(preparation, 'updateNearLeaves');
    const selectLeaves = vi.spyOn(preparation, 'updateLeafSelection');
    try {
      const lodBias = -1;
      const pixels = await scene.render([trees(data[0], {_cropOnly: true, lodBias}, data)]);
      expect(countCrop(pixels)).toBeGreaterThan(10);
      expect(cropLayers(scene).some(layer => layer.props.visible)).toBe(true);
      expect(subLayers(scene).some(layer => layer instanceof TreePhotorealLeafLayer)).toBe(false);
      expect(subLayers(scene).some(layer => layer instanceof TreePhotorealWoodLayer)).toBe(false);
      expect(prepareLeaves).not.toHaveBeenCalled();
      expect(selectLeaves).not.toHaveBeenCalled();

      // Switching the same layer back restores its canopy and the normal per-leaf preparation.
      await scene.render([trees(data[0], {_cropOnly: false, lodBias}, data)]);
      expect(subLayers(scene).some(layer => layer instanceof TreePhotorealLeafLayer)).toBe(true);
      expect(subLayers(scene).some(layer => layer instanceof TreePhotorealWoodLayer)).toBe(true);
      expect(selectLeaves).toHaveBeenCalled();
      expect(scene.errors).toEqual([]);
      expect(scene.glErrors).toEqual([]);
    } finally {
      prepareLeaves.mockRestore();
      selectLeaves.mockRestore();
    }
  });

  it('draws fruit only once growth reaches its anchors', async () => {
    const scene = mount();
    const at = (growth: number, crop: CropConfig | null) =>
      trees({...TREE, growth, crop}, {id: `trees-${growth}`});
    // A citrus has no crop anchor before growth 0.13, whatever the count says.
    const seedling = await scene.render([at(0.1, fruit({count: 3000}))]);
    expect(countCrop(seedling)).toBe(0);
    expect(countDifferent(seedling, await scene.render([at(0.1, null)]))).toBe(0);
    // A few anchors have come, then many.
    const young = countCrop(await scene.render([at(0.45, fruit({count: 3000}))]));
    const grown = countCrop(await scene.render([at(1, fruit({count: 3000}))]));
    expect(young).toBeGreaterThan(0);
    expect(grown).toBeGreaterThan(young * 2);
    // A smaller count means the same number of crops on the wood there is, young or grown.
    const youngSmall = countCrop(await scene.render([at(0.45, fruit({count: 12}))]));
    const grownSmall = countCrop(await scene.render([at(1, fruit({count: 12}))]));
    expect(youngSmall).toBeGreaterThan(0);
    expect(youngSmall).toBeLessThan(grownSmall * 2.5);
    expect(grownSmall).toBeLessThan(youngSmall * 2.5);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('draws nothing at count 0, or at a radius of 0', async () => {
    const scene = mount();
    const bare = await scene.render([trees(TREE)]);
    for (const crop of [
      fruit({count: 0}),
      fruit({radius: 0}),
      [fruit({count: 0}), fruit({count: 0})]
    ]) {
      const pixels = await scene.render([trees({...TREE, crop: crop as TreeSpec['crop']})]);
      expect(countCrop(pixels)).toBe(0);
      expect(countDifferent(pixels, bare)).toBe(0);
    }
    expect(countCrop(await scene.render([trees({...TREE, crop: fruit()})]))).toBeGreaterThan(100);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('picks the source row at a fruit, and maps past rows that were skipped', async () => {
    const scene = mount();
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0, zoom: 4.4});
    const left = {...TREE, position: [-3.4, 0, 0], crop: fruit({radius: 0.16})} as TreeSpec;
    const right = {...TREE, position: [3.4, 0, 0], crop: fruit({radius: 0.16})} as TreeSpec;
    // Row 0 has no position, so its state row is not its index.
    const skipped = {species: 'citrus'} as TreeSpec;
    const data = [skipped, left, right];
    const pixels = await scene.render([
      trees(right, {getPosition: (row: TreeSpec) => row.position}, data)
    ]);
    let hits = 0;
    for (const [side, object, index] of [
      [0, left, 1],
      [128, right, 2]
    ] as const) {
      let x = -1,
        y = -1;
      for (let py = 0; py < SIZE && x < 0; py += 2)
        for (let px = side; px < side + 128; px += 2)
          if (isMagenta(pixels, ((SIZE - 1 - py) * SIZE + px) * 4)) {
            x = px;
            y = py;
            break;
          }
      expect(x).toBeGreaterThanOrEqual(0);
      const info = scene.deck.pickObject({x, y, radius: 1});
      // Compared by name and identity: a failure must not print a layer, which reaches the whole deck.
      expect(info?.object === object).toBe(true);
      expect(info?.index).toBe(index);
      expect(info?.sourceLayer?.constructor.name).toBe('TreePhotorealCropLayer');
      hits++;
    }
    expect(hits).toBe(2);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('finds a tree once through its crops in a multi-depth pick', async () => {
    const scene = mount();
    const tree = {...TREE, crop: fruit({radius: 0.16})};
    await scene.render([trees(tree)]);
    const picked = scene.deck.pickObjects({x: 0, y: 0, width: SIZE, height: SIZE});
    expect(picked.filter(info => info.object === tree).length).toBeGreaterThan(0);
    expect(picked.every(info => info.object === tree)).toBe(true);
    const multi = scene.deck.pickMultipleObjects({x: 128, y: 100, radius: 40, depth: 4});
    expect(multi.every(info => info.object === tree)).toBe(true);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('adds crops as count rises, and leaves those it had where they were', async () => {
    const scene = mount();
    const make = (count: number) => trees({...TREE, crop: fruit({count})});
    const refs = () =>
      (
        cropLayers(scene)[0].props.data as unknown as {
          attributes: {instanceCropRef: {value: Float32Array}};
        }
      ).attributes.instanceCropRef.value;
    const few = cropMask(await scene.render([make(16)]));
    const fewRefs = refs().slice();
    const many = cropMask(await scene.render([make(64)]));
    const manyRefs = refs();
    expect(manyRefs.length).toBeGreaterThan(fewRefs.length);
    expect(Array.from(manyRefs.subarray(0, fewRefs.length))).toEqual(Array.from(fewRefs));
    let kept = 0,
      had = 0,
      added = 0;
    for (let i = 0; i < few.length; i++) {
      if (few[i]) {
        had++;
        if (many[i]) kept++;
      } else if (many[i]) added++;
    }
    expect(had).toBeGreaterThan(50);
    expect(added).toBeGreaterThan(had);
    // Crops near the end of a count are still swelling, so a pixel at an edge may differ.
    expect(kept / had).toBeGreaterThan(0.95);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('turns from unripe to ripe in color alone', async () => {
    const scene = mount();
    const make = (ripeness: number) =>
      trees({
        ...TREE,
        crop: {
          color: [244, 140, 24, 255],
          unripeColor: [86, 128, 44, 255],
          count: 60,
          radius: 0.09,
          ripeness
        }
      });
    const bare = await scene.render([trees(TREE)]);
    const unripe = await scene.render([make(0)]);
    const middle = await scene.render([make(0.5)]);
    const ripe = await scene.render([make(1)]);
    // What differs from the bare tree are its crops.
    const covered = (pixels: Uint8Array) => {
      const mask: number[] = [];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          pixels[offset] !== bare[offset] ||
          pixels[offset + 1] !== bare[offset + 1] ||
          pixels[offset + 2] !== bare[offset + 2]
        )
          mask.push(offset);
      }
      return mask;
    };
    const unripeMask = covered(unripe);
    const ripeMask = covered(ripe);
    expect(unripeMask.length).toBeGreaterThan(100);
    // The same pixels, but for one of a soft edge that rounds to the color behind it.
    const apart = (a: number[], b: number[]) => {
      const inB = new Set(b);
      const inA = new Set(a);
      return (
        a.filter(offset => !inB.has(offset)).length + b.filter(offset => !inA.has(offset)).length
      );
    };
    expect(apart(unripeMask, ripeMask)).toBeLessThan(ripeMask.length * 0.01);
    expect(apart(covered(middle), ripeMask)).toBeLessThan(ripeMask.length * 0.01);
    const mean = (pixels: Uint8Array, channel: number) =>
      ripeMask.reduce((sum, offset) => sum + pixels[offset + channel], 0) / ripeMask.length;
    expect(mean(ripe, 0)).toBeGreaterThan(mean(unripe, 0) * 1.5);
    expect(mean(unripe, 1) / mean(unripe, 0)).toBeGreaterThan(mean(ripe, 1) / mean(ripe, 0));
    expect(mean(middle, 0)).toBeGreaterThan(mean(unripe, 0));
    expect(mean(middle, 0)).toBeLessThan(mean(ripe, 0));
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('animates count, radius, ripeness and fallen with no attribute written, below capacity', async () => {
    const scene = mount();
    const make = (
      count: number,
      ripeness: number,
      fallen: number,
      radius: number,
      windTime: number
    ) =>
      trees(
        {
          ...TREE,
          crop: [
            fruit({count, ripeness, fallen, radius}),
            fruit({count: 8, kind: 'flower', radius: 0.03})
          ]
        },
        {
          updateTriggers: {getTree: `${count}-${ripeness}-${fallen}-${radius}-${windTime}`},
          windTime
        }
      );
    await scene.render([make(40, 0, 0, 0.09, 10)]);
    const before = cropLayers(scene);
    expect(before.length).toBeGreaterThan(0);
    const data = new Map(before.map(layer => [layer.id, layer.props.data]));
    const rows = treeLayer(scene).state.photoreal!.rows.slice();
    const attributeWrites = before.map(layer =>
      vi.spyOn(layer.getAttributeManager()!.attributes.instanceCropRef, 'setData')
    );
    const others = subLayers(scene).filter(
      layer => layer instanceof TreePhotorealWoodLayer || layer instanceof TreePhotorealLeafLayer
    );
    const otherWrites = others.flatMap(layer => {
      const {instanceTreeRow, instanceLeafRef} = layer.getAttributeManager()!.attributes;
      return [instanceTreeRow, instanceLeafRef]
        .filter(Boolean)
        .map(attribute => vi.spyOn(attribute, 'updateBuffer'));
    });
    expect(otherWrites.length).toBeGreaterThan(0);
    const texture = treeLayer(scene).state.stateTexture!;
    const upload = vi.spyOn(Object.getPrototypeOf(texture), 'writeData');
    const frames: [number, number, number, number, number][] = [
      [50, 0.25, 0.1, 0.095, 10 + 1 / 60],
      [60, 0.5, 0.2, 0.1, 10 + 2 / 60],
      [33, 0.75, 0.5, 0.08, 10 + 3 / 60],
      [64, 1, 1, 0.09, 10 + 4 / 60]
    ];
    for (const frame of frames) await scene.render([make(...frame)]);
    expect(scene.errors).toEqual([]);
    expect(upload).toHaveBeenCalled();
    upload.mockRestore();
    for (const write of attributeWrites) expect(write).not.toHaveBeenCalled();
    for (const write of otherWrites) expect(write).not.toHaveBeenCalled();
    // Compared as booleans: a failure must not print rows, which reach the whole deck.
    const after = treeLayer(scene);
    expect(after.state.photoreal!.rows.every((row, index) => row === rows[index])).toBe(true);
    for (const layer of cropLayers(scene))
      expect(layer.props.data === data.get(layer.id)).toBe(true);
    // Past its capacity it does build new instances, once.
    await scene.render([make(65, 1, 1, 0.09, 11)]);
    expect(cropLayers(scene).some(layer => layer.props.data !== data.get(layer.id))).toBe(true);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('keeps growth from writing attributes while capacity holds', async () => {
    const scene = mount();
    const make = (growth: number) =>
      trees({...TREE, growth, crop: fruit({count: 30})}, {updateTriggers: {getTree: growth}});
    await scene.render([make(0.97)]);
    const data = new Map(cropLayers(scene).map(layer => [layer.id, layer.props.data]));
    for (const growth of [0.98, 0.99, 1, 0.985]) await scene.render([make(growth)]);
    for (const layer of cropLayers(scene))
      expect(layer.props.data === data.get(layer.id)).toBe(true);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('leaves fruit on the ground at fallen 1, and none hanging', async () => {
    const scene = mount();
    const make = (fallen: number, windTime: number) =>
      trees(
        {...TREE, crop: fruit({count: 120, fallen})},
        {updateTriggers: {getTree: `${fallen}-${windTime}`}, windTime}
      );
    // Below this line of the view lies the ground, and everything within a few decimetres of it.
    const hanging = await scene.render([make(0, 100)]);
    const groundFrom = 180;
    expect(countCrop(hanging, 0, 0, SIZE, groundFrom)).toBeGreaterThan(500);
    // A clock jump means no rate at all: they are simply down, as at a random-access frame.
    const fallen = await scene.render([make(1, 200)]);
    expect(countCrop(fallen, 0, 0, SIZE, groundFrom)).toBe(0);
    expect(countCrop(fallen, 0, groundFrom, SIZE, SIZE)).toBeGreaterThan(100);
    // And about half for half.
    const half = await scene.render([make(0.5, 300)]);
    const up = countCrop(half, 0, 0, SIZE, groundFrom);
    expect(up).toBeGreaterThan(countCrop(hanging, 0, 0, SIZE, groundFrom) * 0.25);
    expect(up).toBeLessThan(countCrop(hanging, 0, 0, SIZE, groundFrom) * 0.75);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('darkens the ground under fruit at rest, whatever level draws it', async () => {
    // Isolate the crop contact pass so dark bark cannot contribute to the patch measurement.
    const countPatch = (pixels: Uint8Array) => {
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const dark = pixels[offset] <= 2 && pixels[offset + 1] <= 2 && pixels[offset + 2] <= 2;
        if (dark && pixels[offset + 3] > 12) count++;
      }
      return count;
    };
    const near = {...ORBIT_STATE, target: [1.2, 0, 0], rotationX: 30, zoom: 7.6};
    const make = (fallen: number, windTime: number) =>
      trees(
        {...TREE, canopyColor: [0, 0, 0, 0], crop: fruit({count: 240, radius: 0.12, fallen})},
        {_cropOnly: true, lodBias: 0, updateTriggers: {getTree: `${fallen}-${windTime}`}, windTime}
      );
    const scene = mount({viewState: near});
    expect(countPatch(await scene.render([make(0, 100)]))).toBeLessThan(20);
    const atRest = await scene.render([make(1, 200)]);
    const meshes = cropLayers(scene).filter(
      layer => (layer.props as never as {lod: number}).lod < 2 && layer.getNumInstances() > 0
    );
    expect(meshes.length).toBeGreaterThan(0);
    expect(countCrop(atRest)).toBeGreaterThan(100);
    const under = countPatch(atRest);
    expect(under).toBeGreaterThan(100);

    // Far away it is still there, under the point that draws each.
    scene.setViewState({...near, zoom: 5.4});
    expect(countPatch(await scene.settle())).toBeGreaterThan(20);

    // In the sun it reaches away from the light.
    const meanPatchX = (pixels: Uint8Array) => {
      let sum = 0;
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const dark = pixels[offset] <= 2 && pixels[offset + 1] <= 2 && pixels[offset + 2] <= 2;
        if (dark && pixels[offset + 3] > 12) {
          sum += (offset / 4) % SIZE;
          count++;
        }
      }
      return sum / Math.max(count, 1);
    };
    const inSun = async (toward: number) => {
      const lit = mount({
        viewState: {...near, target: [0, 0, 0], rotationOrbit: 0, zoom: 5.4},
        effects: [
          new LightingEffect({
            ambient: new AmbientLight({intensity: 1}),
            sun: new DirectionalLight({intensity: 2, direction: [toward, 0, -0.6]})
          })
        ]
      });
      const pixels = await lit.render([make(1, 300)]);
      expect(lit.errors).toEqual([]);
      return meanPatchX(pixels);
    };
    expect(await inSun(1)).toBeGreaterThan((await inSun(-1)) + 3);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('drops fruit through the air while fallen rises, and leaves none there when it stops', async () => {
    const scene = mount();
    const make = (fallen: number, windTime: number) =>
      trees(
        {...TREE, crop: fruit({count: 240, fallen})},
        {updateTriggers: {getTree: `${fallen}-${windTime}`}, windTime}
      );
    // All of the crown, with the ground out of it.
    const band = (pixels: Uint8Array) => countCrop(pixels, 0, 0, SIZE, 175);
    const settled = band(await scene.render([make(0, 100)]));
    const fallenAlready = band(await scene.render([make(0.2, 150)]));
    expect(fallenAlready).toBeLessThan(settled);
    let t = 200;
    const falling: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      t += 1 / 60;
      const pixels = await scene.render([make(0.2 + frame * 0.004, t)]);
      falling.push(band(pixels));
    }
    const fallRate = treeLayer(scene).state.store!.data[11 * 4 + 3];
    expect(fallRate).toBeGreaterThan(0.1);
    // The value stops. Within a few frames its rate is gone, and everything has landed.
    let rate = 1;
    for (let frame = 0; frame < 8; frame++) {
      t += 1 / 60;
      await scene.render([make(0.244, t)]);
      rate = treeLayer(scene).state.store!.data[11 * 4 + 3];
    }
    expect(rate).toBe(0);
    const landed = band(await scene.settle());
    expect(landed).toBeLessThan(fallenAlready);
    // In the air they were still up there.
    expect(Math.max(...falling)).toBeGreaterThan(landed * 1.05);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('keeps droppedCount on the ground, independent of attached crops, and tweens it', async () => {
    const scene = mount();
    const make = (droppedCount: number, count = 0) =>
      trees(
        {...TREE, crop: fruit({count, droppedCount})},
        {transitions: {getCrop: 2000}, updateTriggers: {getTree: `${droppedCount}-${count}`}}
      );
    await scene.render([]);
    const timeline = scene.layerManager().context.timeline;
    timeline.pause();
    timeline.setTime(1000);
    const none = countCrop(await scene.render([make(0)]));
    expect(none).toBe(0);
    await scene.render([make(200)]);
    // Halfway there it holds half.
    timeline.setTime(2000);
    await scene.settle();
    expect(treeLayer(scene).state.store!.getRowValues(0).crops[0].dropped).toBeCloseTo(100);
    timeline.setTime(3000);
    const pixels = await scene.settle();
    const dropped = countCrop(pixels, 0, 180, SIZE, SIZE);
    expect(dropped).toBeGreaterThan(100);
    expect(countCrop(pixels, 0, 0, SIZE, 180)).toBe(0);
    await scene.render([make(200, 60)]);
    timeline.setTime(6000);
    const settled = await scene.settle();
    expect(countCrop(settled, 0, 0, SIZE, 180)).toBeGreaterThan(100);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('takes a blossom and a fruit together, and each keeps its slot when the other goes', async () => {
    const scene = mount();
    const blossom: CropConfig = {
      kind: 'flower',
      color: [255, 252, 240, 255],
      count: 400,
      radius: 0.04
    };
    const orange = fruit({count: 60});
    const fruitOnly = cropMask(await scene.render([trees({...TREE, crop: [blossom, orange]})]));
    const ids = cropLayers(scene).map(layer => layer.id);
    expect(ids.some(id => id.includes('-flower-'))).toBe(true);
    expect(ids.some(id => id.includes('-fruit-'))).toBe(true);
    const slotsBefore = treeLayer(scene).state.cropKinds.slice(0, 2);
    expect(slotsBefore).toEqual(['flower', 'fruit']);
    // The blossom goes: the fruit stays in its slot, with the same crops.
    const after = cropMask(
      await scene.render([trees({...TREE, crop: orange}, {updateTriggers: {getTree: 'gone'}})])
    );
    expect(treeLayer(scene).state.cropKinds[1]).toBe('fruit');
    let kept = 0,
      had = 0;
    for (let i = 0; i < fruitOnly.length; i++) {
      if (fruitOnly[i]) {
        had++;
        if (after[i]) kept++;
      }
    }
    expect(had).toBeGreaterThan(100);
    expect(kept / had).toBeGreaterThan(0.9);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('keeps two crops of a kind apart, on the same anchors', async () => {
    const scene = mount();
    const one = countCrop(await scene.render([trees({...TREE, crop: fruit({count: 40})})]));
    const crop = [fruit({count: 40}), fruit({count: 40})];
    const two = countCrop(await scene.render([trees({...TREE, crop}, {id: 'trees-two'})]));
    expect(two).toBeGreaterThan(one * 1.6);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('drifts petals to the ground as fallen rises, and they rest there', async () => {
    const scene = mount();
    const make = (fallen: number, windTime: number) =>
      trees(
        {
          ...TREE,
          crop: {
            kind: 'flower',
            color: MAGENTA,
            unripeColor: MAGENTA,
            count: 800,
            radius: 0.04,
            fallen
          }
        },
        {updateTriggers: {getTree: `${fallen}-${windTime}`}, windTime}
      );
    const attached = await scene.render([make(0, 100)]);
    expect(countCrop(attached, 0, 0, SIZE, 180)).toBeGreaterThan(100);
    // They lie as far as a few metres behind the tree, which is this far up the view.
    const rest = await scene.render([make(1, 200)]);
    expect(countCrop(rest, 0, 0, SIZE, 170)).toBe(0);
    expect(countCrop(rest, 0, 170, SIZE, SIZE)).toBeGreaterThan(50);
    // Rising, between two frames, there are petals outside the crown's shape.
    await scene.render([make(0, 300)]);
    let t = 400;
    for (let frame = 0; frame < 6; frame++) {
      t += 1 / 60;
      await scene.render([make(0.3 + frame * 0.002, t)]);
    }
    const falling = await scene.settle();
    const inAir = countCrop(falling, 0, 0, SIZE, 170);
    expect(inAir).toBeGreaterThan(countCrop(rest, 0, 0, SIZE, 170));
    expect(scene.errors).toEqual([]);
  }, 120000);

  it.each([
    'fruit',
    'lemon',
    'cone',
    'acorn',
    'catkin',
    'propagule',
    'flower'
  ] as const)('renders %s at every mesh level, and in the shadow pass', async kind => {
    const scene = mount({
      effects: [
        new LightingEffect({
          ambient: new AmbientLight({intensity: 0.6}),
          sun: new DirectionalLight({direction: [1, 0.3, -1], intensity: 1.2, _shadow: true})
        })
      ]
    });
    const crop = {kind, color: MAGENTA, unripeColor: MAGENTA, count: 200, radius: 0.09};
    const seen: Record<string, number> = {};
    for (const [zoom, lodBias] of [
      [9.2, 0],
      [7, 0],
      [6.2, -1],
      [4.7, 1],
      [2.5, 1],
      [0.5, 1]
    ] as const) {
      scene.setViewState({...ORBIT_STATE, zoom});
      const pixels = await scene.render([trees({...TREE, crop}, {lodBias})]);
      for (const layer of cropLayers(scene)) {
        if ((layer.props.data as unknown as {length: number}).length) {
          seen[layer.id.split('-').at(-1) as string] = countCrop(pixels);
        }
      }
      expect(scene.errors).toEqual([]);
      expect(scene.glErrors).toEqual([]);
    }
    // A close view takes a finer level than a far one, and every level shows something.
    expect(Object.keys(seen).length).toBeGreaterThanOrEqual(2);
    for (const pixels of Object.values(seen)) expect(pixels).toBeGreaterThan(0);
  }, 120000);

  it('draws a crop once and whole at every size on screen, through all its levels', async () => {
    const scene = mount({
      views: new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.02, far: 40} as never)
    });
    const crop = fruit({count: 1, radius: 0.09});
    const tree = {...TREE, crop};
    let target = [0, 0, 2.8];
    // Where the fruit is on screen from this orbit, and the move of the target that brings it to the middle.
    const look = async (zoom: number, orbit: number) => {
      scene.setViewState({...ORBIT_STATE, target, zoom, rotationOrbit: orbit, rotationX: 0});
      const pixels = await scene.render([trees(tree, {lodBias: 0, shadowEnabled: false})]);
      let sumX = 0,
        sumY = 0,
        n = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++)
          if (isMagenta(pixels, ((SIZE - 1 - y) * SIZE + x) * 4)) {
            sumX += x;
            sumY += y;
            n++;
          }
      expect(n, `at zoom ${zoom} orbit ${orbit} target ${target}`).toBeGreaterThan(0);
      const right = (sumX / n - SIZE / 2) / 2 ** zoom;
      const down = (sumY / n - SIZE / 2) / 2 ** zoom;
      const azimuth = (orbit * Math.PI) / 180;
      target = [
        target[0] + right * Math.cos(azimuth),
        target[1] - right * Math.sin(azimuth),
        target[2] - down
      ];
      return n;
    };
    // First where it is, then from outside the crown, so no wood passes in front of it.
    await look(4, 0);
    await look(4, 90);
    await look(4, 0);
    const outside = (Math.atan2(target[0], -target[1]) * 180) / Math.PI;
    // Follow it in from afar, keeping it at the middle of the view in all three directions.
    const levels = new Set<string>();
    for (let zoom = 4; zoom <= 10; zoom += 0.5) {
      await look(zoom, outside + 90);
      await look(zoom, outside);
      const n = await look(zoom, outside);
      for (const layer of cropLayers(scene)) {
        if ((layer.props.data as unknown as {length: number}).length) {
          levels.add(layer.id.split('-').at(-1) as string);
        }
      }
      // About the disc of a fruit of this size, with no second copy from another level, and no gap between them.
      const radiusPixels = 0.09 * 0.92 * 2 ** zoom;
      if (radiusPixels > 3) {
        const area = Math.PI * radiusPixels * radiusPixels;
        expect(n / area, `at zoom ${zoom}`).toBeGreaterThan(0.5);
        expect(n / area, `at zoom ${zoom}`).toBeLessThan(1.6);
      }
    }
    expect(levels.has('0')).toBe(true);
    expect(levels.has('1')).toBe(true);
    expect(levels.has('2')).toBe(true);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 300000);

  it('hangs a fruit right under its twig, on a short stem, with no reach', async () => {
    const scene = mount({
      views: new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.02, far: 40} as never)
    });
    const radius = 0.06;
    const tree = {...TREE, crop: fruit({count: 1, radius})};
    const props = {lodBias: 0, shadowEnabled: false, windStrength: 0};
    await scene.render([trees(tree, props)]);
    const layer = treeLayer(scene);
    const {model} = [...layer.state.photoreal!.groups.values()][0];
    const {data} = layer.state.store!;
    const yaw = data[3];
    const [crownX, crownY, height, trunkHeight] = data.subarray(8, 12);
    const anchor = getTreeCropTable(model).order[0] * TREE_CROP_ANCHOR_STRIDE;
    const [x, y, z] = treeTemplateToMetres(
      model.cropAnchors.subarray(anchor, anchor + 3),
      {crownX, crownY, height, trunkHeight},
      model.forkZ
    );
    const twig = [x * Math.cos(yaw) - y * Math.sin(yaw), x * Math.sin(yaw) + y * Math.cos(yaw), z];
    // The fruit's middle on screen from an orbit, as metres from the twig, to the right and up.
    const zoom = 9;
    const look = async (orbit: number) => {
      scene.setViewState({
        ...ORBIT_STATE,
        target: twig,
        zoom,
        rotationOrbit: orbit,
        rotationX: 0
      });
      const pixels = await scene.settle();
      let sumX = 0,
        sumY = 0,
        n = 0;
      for (let py = 0; py < SIZE; py++)
        for (let px = 0; px < SIZE; px++)
          if (isMagenta(pixels, ((SIZE - 1 - py) * SIZE + px) * 4)) {
            sumX += px;
            sumY += py;
            n++;
          }
      expect(n, `from orbit ${orbit}`).toBeGreaterThan(200);
      return [(sumX / n - SIZE / 2) / 2 ** zoom, -(sumY / n - SIZE / 2) / 2 ** zoom];
    };
    const [east, upEast] = await look(0);
    const [west, upWest] = await look(90);
    // It lies about a stem and a radius below the twig: 8 to 10 cm here, at most a little to one side.
    for (const up of [upEast, upWest]) {
      expect(up).toBeLessThan(-0.055);
      expect(up).toBeGreaterThan(-0.13);
    }
    expect(Math.hypot(east, west)).toBeLessThan(0.06);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('darkens fruit on the side of a full crown away from the sun, at any level', async () => {
    const scene = mount({
      effects: [
        new LightingEffect({
          ambient: new AmbientLight({intensity: 0.5}),
          sun: new DirectionalLight({intensity: 2.2, direction: [-1, 0, -0.5]})
        })
      ]
    });
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0});
    const tree: TreeSpec = {
      species: 'citrus',
      position: [0, 0, 0],
      height: 6,
      crownRadius: 2.6,
      crop: fruit({count: 900, radius: 0.09})
    };
    const brightness = (pixels: Uint8Array, x0: number, x1: number) => {
      let sum = 0,
        n = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = x0; x < x1; x++) {
          const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
          if (isMagenta(pixels, offset)) {
            sum += pixels[offset];
            n++;
          }
        }
      expect(n).toBeGreaterThan(20);
      return sum / n;
    };
    // The sun is on the right of this view. Far away a dot faces the viewer, so only the crown makes this differ.
    const pixels = await scene.render([trees(tree, {lodBias: 0, shadowEnabled: false})]);
    expect(brightness(pixels, 150, SIZE)).toBeGreaterThan(brightness(pixels, 0, 106) * 1.2);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('takes fog, rain and rime, whatever level draws it', async () => {
    const scene = mount();
    const tree = {...TREE, crop: fruit({count: 240, radius: 0.09})};
    const make = (props: Record<string, unknown>) =>
      trees(tree, {lodBias: 0, shadowEnabled: false, ...props});
    for (const zoom of [4.7, 7.6]) {
      scene.setViewState({...ORBIT_STATE, zoom});
      const plain = await scene.render([make({})]);
      // Pixels all of a crop, as those at an edge take in what lies behind them.
      const mask: number[] = [];
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (isMagenta(plain, i * 4) && plain[i * 4 + 3] === 255) mask.push(i * 4);
      }
      expect(mask.length, `at zoom ${zoom}`).toBeGreaterThan(100);
      const mean = (pixels: Uint8Array, channel: number) =>
        mask.reduce((sum, offset) => sum + pixels[offset + channel], 0) / mask.length;
      // Lost in fog a surface shows exactly its color.
      const fogged = await scene.render([make({fog: {color: [40, 200, 120], density: 60}})]);
      expect(Math.abs(mean(fogged, 0) - 40), `at zoom ${zoom}`).toBeLessThan(6);
      expect(Math.abs(mean(fogged, 1) - 200), `at zoom ${zoom}`).toBeLessThan(6);
      expect(Math.abs(mean(fogged, 2) - 120), `at zoom ${zoom}`).toBeLessThan(6);
      // Rime is pale: the green these have none of comes up.
      const rimed = await scene.render([make({frost: 1})]);
      expect(mean(rimed, 1), `at zoom ${zoom}`).toBeGreaterThan(mean(plain, 1) + 5);
      // Rain changes all of them, though it hardly darkens a rind: a film mirrors the sky.
      const wet = await scene.render([make({wetness: 1})]);
      expect(countDifferent(plain, wet), `at zoom ${zoom}`).toBeGreaterThan(mask.length * 0.5);
    }
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 180000);

  it('adds about as much color to a crown near and far', async () => {
    const scene = mount();
    const tree: TreeSpec = {species: 'citrus', position: [0, 0, 0], height: 6, crownRadius: 2.6};
    const crop = {
      kind: 'fruit',
      color: [244, 140, 24, 255],
      unripeColor: [86, 128, 44, 255],
      count: 600,
      radius: 0.04
    } as CropConfig;
    const props = {lodBias: 0, shadowEnabled: false, windStrength: 0};
    // How much redder than green the crown gets, per pixel of it. Nothing else is drawn in these views.
    const shift = async (zoom: number) => {
      scene.setViewState({...ORBIT_STATE, zoom});
      const bare = await scene.render([trees(tree, {...props, id: 'bare'})]);
      const borne = await scene.render([trees({...tree, crop}, {...props, id: 'borne'})]);
      let sum = 0,
        n = 0;
      for (let offset = 0; offset < bare.length; offset += 4) {
        if (bare[offset + 3] === 0) continue;
        n++;
        sum += borne[offset] - borne[offset + 1] - (bare[offset] - bare[offset + 1]);
      }
      return sum / Math.max(n, 1);
    };
    const near = await shift(5.2);
    const middle = await shift(3.8);
    const far = await shift(2.8);
    expect(near).toBeGreaterThan(0.2);
    for (const value of [middle, far]) {
      expect(value).toBeGreaterThan(near / 3);
      expect(value).toBeLessThan(near * 3);
    }
    expect(scene.errors).toEqual([]);
  }, 180000);

  it('sizes its levels and dots in CSS pixels, whatever the device pixel ratio', async () => {
    const draw = async (useDevicePixels: number) => {
      const parent = document.createElement('div');
      parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
      document.body.append(parent);
      let share = 0,
        frames = 0;
      const deck = new Deck({
        parent,
        width: SIZE,
        height: SIZE,
        useDevicePixels,
        _animate: true,
        deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
        views: ORBIT_VIEW as never,
        viewState: {...ORBIT_STATE, zoom: 5.4} as never,
        layers: [trees({...TREE, crop: fruit({count: 120, radius: 0.09})}, {lodBias: 0})],
        onAfterRender({gl}) {
          const {drawingBufferWidth: width, drawingBufferHeight: height} = gl;
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let count = 0;
          for (let i = 0; i < width * height; i++) if (isMagenta(pixels, i * 4)) count++;
          share = count / (width * height);
          frames++;
        }
      });
      await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThan(4);
      deck.finalize();
      parent.remove();
      return share;
    };
    const one = await draw(1);
    const two = await draw(2);
    expect(one).toBeGreaterThan(0.002);
    expect(two / one).toBeGreaterThan(0.85);
    expect(two / one).toBeLessThan(1.15);
  }, 120000);

  it('releases its rank texture with its layers', async () => {
    const scene = mount();
    await scene.render([trees({...TREE, crop: fruit()})]);
    const layer = cropLayers(scene)[0];
    const ranks = (layer.state as {cropRanks: object}).cropRanks;
    const destroy = vi.spyOn(Object.getPrototypeOf(ranks), 'destroy');
    await scene.render([]);
    expect(destroy.mock.contexts.includes(ranks)).toBe(true);
    destroy.mockRestore();
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('thins crops far away, with fewer instances the further it goes', async () => {
    const scene = mount();
    const tree = {...TREE, crop: fruit({count: 800, radius: 0.04})};
    const instances = () =>
      cropLayers(scene).reduce(
        (sum, layer) => sum + (layer.props.data as unknown as {length: number}).length,
        0
      );
    scene.setViewState({...ORBIT_STATE, zoom: 6});
    await scene.render([trees(tree, {lodBias: 0})]);
    const near = instances();
    expect(near).toBeGreaterThanOrEqual(800);
    scene.setViewState({...ORBIT_STATE, zoom: -2});
    await scene.settle();
    const far = instances();
    expect(far).toBeLessThan(near / 3);
    expect(far).toBeGreaterThan(0);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('renders in a map at longitude and latitude', async () => {
    const scene = mount({
      views: new MapView(),
      viewState: {longitude: -81.5, latitude: 28, zoom: 20, pitch: 50, bearing: 20}
    });
    const tree = {
      ...TREE,
      position: [-81.5, 28, 0],
      crop: fruit({count: 200, radius: 0.1})
    } as TreeSpec;
    const pixels = await scene.render([trees(tree, {coordinateSystem: COORDINATE_SYSTEM.LNGLAT})]);
    expect(countCrop(pixels)).toBeGreaterThan(50);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('highlights a tree through its crops, and takes a color filter extension', async () => {
    const scene = mount();
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0, zoom: 4.4});
    const crop = fruit({color: [240, 240, 240, 255], radius: 0.16});
    const left = {...TREE, position: [-3.4, 0, 0], crop} as TreeSpec;
    const right = {...TREE, position: [3.4, 0, 0], crop} as TreeSpec;
    const data = [left, right];
    const plain = await scene.render([trees(left, {}, data)]);
    const lit = await scene.render([
      trees(left, {highlightedObjectIndex: 1, highlightColor: [255, 0, 0, 255]}, data)
    ]);
    const redness = (pixels: Uint8Array, x0: number, x1: number) => {
      let sum = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = x0; x < x1; x++) {
          const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
          sum += Math.max(0, pixels[offset] - pixels[offset + 1]);
        }
      return sum;
    };
    expect(redness(lit, 146, 240)).toBeGreaterThan(redness(plain, 146, 240) * 1.5);
    expect(Math.abs(redness(lit, 16, 110) / redness(plain, 16, 110) - 1)).toBeLessThan(0.02);
    // An extension's accessor reads the source row, also for a crop.
    const seen = new Set<TreeSpec>();
    await scene.render([
      trees(
        left,
        {
          id: 'pulsing-trees',
          extensions: [new SelectionPulseExtension()],
          getSelected: (row: TreeSpec) => {
            seen.add(row);
            return row === right;
          },
          pulseColor: [255, 255, 255],
          pulseStrength: 1,
          pulsePeriod: 0
        },
        data
      )
    ]);
    expect(seen.has(left)).toBe(true);
    expect(seen.has(right)).toBe(true);
    expect(seen.size).toBe(2);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('highlights the hovered tree through its crops with autoHighlight', async () => {
    const scene = mount();
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0, zoom: 4.4});
    const crop = fruit({color: [240, 240, 240, 255], radius: 0.16});
    const left = {...TREE, position: [-3.4, 0, 0], crop} as TreeSpec;
    const right = {...TREE, position: [3.4, 0, 0], crop} as TreeSpec;
    const make = () =>
      trees(left, {autoHighlight: true, highlightColor: [255, 0, 0, 255]}, [left, right]);
    const plain = await scene.render([make()]);
    const redness = (pixels: Uint8Array, x0: number, x1: number) => {
      let sum = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = x0; x < x1; x++) {
          const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
          sum += Math.max(0, pixels[offset] - pixels[offset + 1]);
        }
      return sum;
    };
    const hovered = scene.deck.pickObject({x: 186, y: 100, radius: 40})!;
    expect(hovered.object === right).toBe(true);
    (
      treeLayer(scene) as unknown as {_updateAutoHighlight(info: unknown): void}
    )._updateAutoHighlight(hovered);
    const highlighted = await scene.settle();
    expect(redness(highlighted, 146, 240)).toBeGreaterThan(redness(plain, 146, 240) * 1.5);
    expect(Math.abs(redness(highlighted, 16, 110) / redness(plain, 16, 110) - 1)).toBeLessThan(
      0.02
    );
    // The hover leaves.
    (
      treeLayer(scene) as unknown as {_updateAutoHighlight(info: unknown): void}
    )._updateAutoHighlight({...hovered, picked: false, index: -1, object: null, color: null});
    const left2 = await scene.settle();
    expect(Math.abs(redness(left2, 146, 240) / redness(plain, 146, 240) - 1)).toBeLessThan(0.02);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('takes a crop tween through the transitions prop on a stepped timeline', async () => {
    const scene = mount();
    await scene.render([]);
    const timeline = scene.layerManager().context.timeline;
    timeline.pause();
    timeline.setTime(1000);
    const make = (count: number, ripeness: number) =>
      trees(
        {
          ...TREE,
          crop: {
            color: [244, 140, 24, 255],
            unripeColor: [86, 128, 44, 255],
            count,
            radius: 0.09,
            ripeness
          }
        },
        {transitions: {getCrop: 2000}, updateTriggers: {getTree: `${count}-${ripeness}`}}
      );
    await scene.render([make(40, 0)]);
    await scene.render([make(60, 1)]);
    const instanced = cropLayers(scene)[0].props.data;
    timeline.setTime(2000);
    await scene.settle();
    const {crops} = treeLayer(scene).state.store!.getRowValues(0);
    expect(crops[0].count).toBeCloseTo(50);
    expect(crops[0].ripeness).toBeCloseTo(0.5);
    expect(treeLayer(scene).state.ticking).toBe(true);
    timeline.setTime(3000);
    await scene.settle();
    expect(treeLayer(scene).state.ticking).toBe(false);
    expect(cropLayers(scene)[0].props.data === instanced).toBe(true);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('follows limb breaks and lean, and stays out of the ground', async () => {
    const scene = mount();
    const make = (fields: Partial<TreeSpec>) =>
      trees(
        {...TREE, crop: fruit({count: 120}), ...fields},
        {updateTriggers: {getTree: JSON.stringify(fields)}}
      );
    const upright = await scene.render([make({})]);
    const lying = await scene.render([make({lean: [85, 90]})]);
    expect(countCrop(lying, 0, 0, SIZE, 90)).toBeLessThan(countCrop(upright, 0, 0, SIZE, 90) * 0.2);
    expect(countCrop(lying)).toBeGreaterThan(100);
    const broken = await scene.render([make({damage: 1})]);
    expect(countCrop(broken)).toBeGreaterThan(100);
    expect(scene.errors).toEqual([]);
  }, 120000);
});

describe('TreeLayer crop configurations and transitions', () => {
  it('takes one config or an array, and tweens its fields', async () => {
    const scene = mount();
    const crop = fruit({count: 40, radius: 0.1});
    const single = await scene.render([trees({...TREE, crop}, {id: 'crop-single'})]);
    const array = await scene.render([trees({...TREE, crop: [crop]}, {id: 'crop-array'})]);
    expect(countDifferent(single, array)).toBe(0);
    await scene.render([
      trees({...TREE, crop: [crop, {...crop, kind: 'flower'}]}, {id: 'crop-two'})
    ]);
    const ids = subLayers(scene).map(layer => layer.id);
    expect(ids.some(id => id.includes('photoreal-crops') && id.includes('-fruit-'))).toBe(true);
    expect(ids.some(id => id.includes('photoreal-crops') && id.includes('-flower-'))).toBe(true);

    const timeline = scene.layerManager().context.timeline;
    timeline.pause();
    timeline.setTime(1000);
    const make = (droppedCount: number) =>
      trees(
        {...TREE, crop: {...crop, droppedCount}},
        {
          id: 'crop-tween',
          transitions: {getCrop: 2000},
          updateTriggers: {getTree: droppedCount}
        }
      );
    await scene.render([make(0)]);
    await scene.render([make(20)]);
    timeline.setTime(2000);
    await scene.settle();
    expect(treeLayer2(scene).state.store!.getRowValues(0).crops[0].dropped).toBeCloseTo(10);
    expect(scene.errors).toEqual([]);
  }, 120000);
});

function treeLayer2(scene: Scene): TreeLayer<TreeSpec> {
  return subLayers(scene).find(layer => layer.id === 'crop-tween') as TreeLayer<TreeSpec>;
}
