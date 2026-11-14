// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  _GlobeView as GlobeView,
  AmbientLight,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  OrbitView,
  type Layer,
  type LayerManager
} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {afterEach, describe, expect, inject, it} from 'vitest';
import {TreeLayer, type TreeSpec, type TreeType} from '../../src';
import {TreePhotorealWoodLayer} from '../../src/tree-layer/tree-photoreal-wood-layer';

const SIZE = 256;

/** From the south at eye level, about 26 m away: +x is to the right, and a 12 m tree fills the view. */
const VIEW = new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.1, far: 12} as never);
const VIEW_STATE = {target: [0, 0, 5.5], rotationOrbit: 0, rotationX: 3, zoom: 3.2, maxZoom: 30};

const coordinates = {
  coordinateSystem: 'cartesian',
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};

function tree(species: TreeType, lifecycle: Partial<TreeSpec> = {}): TreeSpec {
  return {position: [0, 0, 0], species, height: 12, crownRadius: 3, ...lifecycle};
}

type Scene = {
  deck: Deck;
  errors: string[];
  glErrors: number[];
  layerManager(): LayerManager;
  render(layers: Layer[]): Promise<Uint8Array>;
  settle(frames?: number): Promise<Uint8Array>;
  cleanup(): void;
};

const scenes: Scene[] = [];

function mount({
  effects = [],
  views = VIEW,
  viewState = VIEW_STATE
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
    effects,
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

function trees(data: TreeSpec[], props: Record<string, unknown> = {}, Layer = TreeLayer<TreeSpec>) {
  return new Layer({
    ...coordinates,
    id: 'trees',
    data,
    getTree: (row: TreeSpec) => row,
    pickable: true,
    windTime: 1,
    updateTriggers: {getTree: JSON.stringify(data)},
    ...props
  });
}

/** Draws only the part of a tree whose sub-layers have this in their id. */
function partOfTree(part: string) {
  return class PartTreeLayer extends TreeLayer<TreeSpec> {
    static layerName = 'PartTreeLayer';
    filterSubLayer({layer}: {layer: Layer}) {
      return part === 'canopy' ? isCanopy(layer) : layer.id.includes(part);
    }
  };
}

function treeLayer(scene: Scene): TreeLayer<TreeSpec> {
  return scene
    .layerManager()
    .getLayers()
    .find(layer => layer.id === 'trees') as unknown as TreeLayer<TreeSpec>;
}

function isCanopy(layer: Layer): boolean {
  return (
    !layer.id.endsWith('-shadow') &&
    (layer.id.includes('-photoreal-leaves-') || layer.id.includes('-canopy-'))
  );
}

function canopyLevel(scene: Scene): number {
  let level = Infinity;
  for (const group of treeLayer(scene).state.photoreal?.groups.values() ?? []) {
    for (const [tier, bucket] of group.buckets.entries()) {
      if (bucket.some(row => row?.object)) level = Math.min(level, tier);
    }
  }
  return level;
}

/** Pixels with anything drawn, and where they are on average, from the left and from the top. */
function measure(pixels: Uint8Array) {
  let count = 0,
    x = 0,
    y = 0,
    top = SIZE;
  for (let row = 0; row < SIZE; row++)
    for (let column = 0; column < SIZE; column++) {
      if (pixels[((SIZE - 1 - row) * SIZE + column) * 4 + 3] === 0) continue;
      count++;
      x += column;
      y += row;
      top = Math.min(top, row);
    }
  return {count, x: count ? x / count : 0, y: count ? y / count : 0, top};
}

describe('TreeLayer species lifecycle', () => {
  it.each([
    'citrus',
    'pine',
    'palm'
  ] as const)('%s grows, leans, breaks, decays and vanishes', async species => {
    const scene = mount({viewState: {...VIEW_STATE, zoom: 4}});
    const view = async (lifecycle: Partial<TreeSpec>) =>
      measure(await scene.render([trees([tree(species, lifecycle)])]));
    const mature = await view({});
    expect(mature.count).toBeGreaterThan(200);

    expect((await view({growth: 0})).count).toBe(0);
    const small = await view({growth: 0.2});
    const young = await view({growth: 0.6});
    expect(small.count).toBeGreaterThan(0);
    expect(young.count).toBeGreaterThan(small.count);
    expect(mature.count).toBeGreaterThan(young.count);
    // Everything grows up from the same place.
    expect(small.top).toBeGreaterThan(young.top);
    expect(young.top).toBeGreaterThan(mature.top);

    // To the right of the view.
    const east = await view({lean: [50, 90]});
    const west = await view({lean: [50, 270]});
    expect(east.x).toBeGreaterThan(mature.x + 10);
    expect(west.x).toBeLessThan(mature.x - 10);
    expect(east.top).toBeGreaterThan(mature.top);

    const broken = await view({damage: 1});
    expect(broken.count).toBeGreaterThan(0);
    expect(broken).not.toEqual(mature);

    const settled = await view({decay: 0.5});
    expect(settled.count).toBeLessThan(mature.count);
    expect(settled.count).toBeGreaterThan(0);
    expect((await view({decay: 1})).count).toBe(0);
    expect(scene.deck.pickObjects({x: 0, y: 0, width: SIZE, height: SIZE})).toEqual([]);

    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 180000);

  it('thins a crown with foliage, and tints it with health and flush', async () => {
    const scene = mount({
      effects: [
        new LightingEffect({
          ambient: new AmbientLight({intensity: 1}),
          sun: new DirectionalLight({direction: [0, 1, -1], intensity: 1})
        })
      ]
    });
    const canopyOnly = (lifecycle: Partial<TreeSpec>) =>
      scene.render([
        trees(
          [tree('oak', {canopyColor: [30, 120, 30, 255], ...lifecycle})],
          {},
          partOfTree('canopy')
        )
      ]);
    const color = (pixels: Uint8Array) => {
      let red = 0,
        green = 0,
        alpha = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        // A shaded color with its alpha taken out.
        const a = pixels[offset + 3];
        if (a < 200) continue;
        red += pixels[offset];
        green += pixels[offset + 1];
        alpha++;
      }
      return {red: red / alpha, green: green / alpha};
    };
    const alphaSum = (pixels: Uint8Array) => {
      let sum = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) sum += pixels[offset];
      return sum;
    };
    const healthy = await canopyOnly({});
    const sick = await canopyOnly({health: 0});
    expect(color(sick).red / color(sick).green).toBeGreaterThan(
      color(healthy).red / color(healthy).green + 0.02
    );
    const flushing = await canopyOnly({flush: 1});
    expect(color(flushing).green).toBeGreaterThan(color(healthy).green);
    const thin = await canopyOnly({foliage: 0.25});
    expect(alphaSum(thin)).toBeLessThan(alphaSum(healthy) * 0.8);
    expect(alphaSum(thin)).toBeGreaterThan(0);
    expect(alphaSum(await canopyOnly({foliage: 0}))).toBe(0);
    expect(scene.errors).toEqual([]);
  }, 180000);

  it('draws and picks a leaning tree with shadows on a map', async () => {
    const scene = mount({
      views: new MapView(),
      viewState: {longitude: 0, latitude: 0, zoom: 20, pitch: 50, bearing: 0},
      effects: [
        new LightingEffect({
          ambient: new AmbientLight({intensity: 0.6}),
          sun: new DirectionalLight({direction: [1, 0.2, -1], intensity: 1.2, _shadow: true})
        })
      ]
    });
    const data = [
      tree('oak', {lean: [50, 90], decay: 0.25}),
      tree('palm', {position: [0.0001, 0.00005, 0], lean: [35, 20], decay: 0.15, damage: 0.4})
    ];
    const pixels = await scene.render([
      trees(data, {coordinateSystem: 'lnglat', windStrength: 0.05})
    ]);
    expect(measure(pixels).count).toBeGreaterThan(200);
    expect(
      scene.deck
        .pickObjects({x: 0, y: 0, width: SIZE, height: SIZE})
        .map(info => info.object)
        .includes(data[0])
    ).toBe(true);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it("draws the same pose on a globe, with wind in the tree's own east and north", async () => {
    const scene = mount({
      views: new GlobeView(),
      viewState: {longitude: -81.5, latitude: 28, zoom: 10.5}
    });
    const data = [
      tree('oak', {position: [-81.5, 28, 0], lean: [50, 90], decay: 0.25}),
      tree('pine', {position: [-81.46, 28, 0], damage: 0.5})
    ];
    const pixels = await scene.render([
      trees(data, {
        coordinateSystem: 'lnglat',
        sizeScale: 300,
        windStrength: 0.2,
        windDirection: 45
      })
    ]);
    expect(measure(pixels).count).toBeGreaterThan(50);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('picks a leaning tree where it now is, not where it stood', async () => {
    const scene = mount();
    const data = [tree('oak')];
    const standing = measure(await scene.render([trees(data)]));
    const crown = {x: Math.round(standing.x), y: Math.round(standing.y), radius: 3};
    expect(scene.deck.pickObject(crown)?.object === data[0]).toBe(true);
    const leaning = [tree('oak', {lean: [85, 90]})];
    const fallen = measure(await scene.render([trees(leaning)]));
    expect(fallen.x).toBeGreaterThan(standing.x + 20);
    expect(scene.deck.pickObject(crown)).toBe(null);
    const where = {x: Math.round(fallen.x), y: Math.round(fallen.y), radius: 6};
    expect(scene.deck.pickObject(where)?.object === leaning[0]).toBe(true);
    expect(scene.errors).toEqual([]);
  }, 120000);
});

describe('TreeLayer directional wind', () => {
  const CROP = {color: [240, 140, 20, 255], count: 40, radius: 0.14} as const;
  const windView = {...VIEW_STATE, zoom: 4};

  it.each(['wood', 'canopy', 'crops'])('bends %s toward the bearing', async part => {
    const scene = mount({viewState: windView});
    const data = [tree('oak', {crop: CROP})];
    const Part = partOfTree(part);
    const view = async (props: Record<string, unknown>) =>
      measure(await scene.render([trees(data, props, Part)]));
    const calm = await view({});
    expect(calm.count).toBeGreaterThan(5);
    const east = await view({windStrength: 0.3, windDirection: 90});
    const west = await view({windStrength: 0.3, windDirection: 270});
    // Most of a part is well up the tree, so it moves by about the strength times the height there.
    expect(east.x).toBeGreaterThan(calm.x + 4);
    expect(west.x).toBeLessThan(calm.x - 4);
    // Away from the camera, a tree only comes down a little.
    const north = await view({windStrength: 0.3, windDirection: 0});
    expect(Math.abs(north.x - calm.x)).toBeLessThan(Math.abs(east.x - calm.x) * 0.5);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('moves all the parts of a tree alike, in a steady wind and as gusts pass', async () => {
    const shift = async (part: string) => {
      const scene = mount({viewState: windView});
      const data = [tree('oak', {crop: CROP})];
      const Part = partOfTree(part);
      const view = async (props: Record<string, unknown>) =>
        measure(await scene.render([trees(data, props, Part)])).x;
      const calm = await view({});
      const gusts = [];
      for (const windTime of [1, 1.8, 2.6])
        gusts.push((await view({windStrength: 0.2, windDirection: 90, windTime})) - calm);
      expect(scene.errors).toEqual([]);
      return gusts;
    };
    const canopyShift = await shift('canopy');
    const cropShift = await shift('crops');
    // Crops and leaves occupy different heights. Check downwind motion and compare the
    // relative change in each centroid as the gust advances.
    canopyShift.forEach((value, index) => {
      expect(value).toBeGreaterThan(2);
      expect(cropShift[index]).toBeGreaterThan(value * 0.5);
      expect(cropShift[index]).toBeLessThan(value * 2);
      expect(Math.abs(cropShift[index] / cropShift[0] - value / canopyShift[0])).toBeLessThan(0.08);
    });
    // Gusts move it: the same wind at other moments.
    expect(Math.max(...canopyShift) - Math.min(...canopyShift)).toBeGreaterThan(0.5);
  }, 180000);

  it('lays a tree over in a hurricane, and keeps it above the ground and in one piece', async () => {
    const scene = mount({viewState: windView});
    const data = [tree('oak')];
    const calm = measure(await scene.render([trees(data)]));
    const hurricane = measure(
      await scene.render([trees(data, {windStrength: 1, windDirection: 90, windTime: 1})])
    );
    expect(hurricane.top).toBeGreaterThan(calm.top + 10);
    expect(hurricane.x).toBeGreaterThan(calm.x + 15);
    expect(hurricane.count).toBeGreaterThan(calm.count * 0.4);
    // Nothing below the base of the tree, which is near the bottom of this view.
    const pixels = await scene.settle();
    let below = 0;
    for (let row = 225; row < SIZE; row++)
      for (let column = 0; column < SIZE; column++)
        if (pixels[((SIZE - 1 - row) * SIZE + column) * 4 + 3] > 0) below++;
    expect(below).toBe(0);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('sways with no direction at any strength', async () => {
    const scene = mount();
    const data = [tree('oak')];
    for (const windStrength of [0.1, 0.6, 1]) {
      const pixels = await scene.render([trees(data, {windStrength})]);
      expect(measure(pixels).count).toBeGreaterThan(100);
    }
    expect(treeLayer(scene).props.windDirection).toBe(null);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);
});

describe('TreeLayer lifecycle transitions', () => {
  /** A timeline that only moves when told to, on a scene with nothing drawn yet. */
  async function stepped(viewState = VIEW_STATE) {
    const scene = mount({viewState});
    await scene.render([]);
    const {timeline} = scene.layerManager().context;
    timeline.pause();
    timeline.setTime(1000);
    return {scene, timeline};
  }

  it('moves through a tween with sub-layer data in place, and rests where it ends', async () => {
    const viewState = {...VIEW_STATE, target: [3.5, 0, 5.5], zoom: 4.1};
    const {scene, timeline} = await stepped(viewState);
    const data = [tree('oak'), tree('pine', {position: [7, 0, 0]})];
    const make = (growth: number) =>
      trees(data, {
        lodBias: -2,
        getGrowth: () => growth,
        transitions: {getGrowth: 2000},
        updateTriggers: {getGrowth: growth}
      });
    const small = measure(await scene.render([make(0.2)]));
    await scene.render([make(0.9)]);
    const parts = () =>
      scene
        .layerManager()
        .getLayers()
        .filter(layer => layer instanceof TreePhotorealWoodLayer);
    const before = new Map(parts().map(layer => [layer.id, layer.props.data]));
    const rows = treeLayer(scene).state.photoreal!.rows.slice();
    timeline.setTime(2000);
    await scene.settle();
    const middle = measure(await scene.settle());
    expect(treeLayer(scene).state.ticking).toBe(true);
    expect(treeLayer(scene).state.store!.getRowValues(0).growth).toBeCloseTo(0.55, 5);
    expect(middle.count).toBeGreaterThan(small.count);
    expect(middle.top).toBeLessThan(small.top);
    // Compared as booleans: a failure must not print rows, which reach the whole deck.
    for (const layer of parts())
      expect(layer.props.data === before.get(layer.id), layer.id).toBe(true);
    expect(treeLayer(scene).state.photoreal!.rows.every((row, i) => row === rows[i])).toBe(true);
    timeline.setTime(3100);
    await scene.settle();
    const final = measure(await scene.settle());
    expect(treeLayer(scene).state.ticking).toBe(false);
    expect(final.count).toBeGreaterThan(middle.count);
    // What a tree with these values looks like when it has always been so.
    const atRest = mount({viewState});
    const rest = measure(await atRest.render([make(0.9)]));
    expect(Math.abs(final.top - rest.top)).toBeLessThanOrEqual(2);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 180000);

  it('keeps a crown its level of detail through a tween', async () => {
    const {scene, timeline} = await stepped();
    const data = [tree('oak')];
    const make = (growth: number) =>
      trees(data, {
        getGrowth: () => growth,
        transitions: {getGrowth: 4000},
        updateTriggers: {getGrowth: growth}
      });
    await scene.render([make(0.8)]);
    const initialTier = canopyLevel(scene);
    expect(initialTier).toBeLessThan(Infinity);
    await scene.render([make(1)]);
    for (const time of [1500, 2000, 2500, 3000]) {
      timeline.setTime(time);
      await scene.settle();
      expect(treeLayer(scene).state.ticking).toBe(true);
      expect(canopyLevel(scene)).toBeLessThanOrEqual(initialTier);
    }
    expect(scene.errors).toEqual([]);
  }, 180000);

  it('fades a canopy out with a tween on foliage, however bare the season it goes to', async () => {
    const {scene, timeline} = await stepped();
    const make = (season: 'summer' | 'winter') =>
      trees([tree('oak', {season})], {transitions: {getTree: 2000}});
    const alpha = (pixels: Uint8Array) => {
      let sum = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) sum += pixels[offset];
      return sum;
    };
    const summer = alpha(await scene.render([make('summer')]));
    await scene.render([make('winter')]);
    timeline.setTime(2000);
    await scene.settle();
    const fading = alpha(await scene.settle());
    expect(fading).toBeGreaterThan(0);
    timeline.setTime(3100);
    await scene.settle();
    const winter = alpha(await scene.settle());
    expect(fading).toBeLessThan(summer);
    expect(fading).toBeGreaterThan(winter);
    expect(scene.errors).toEqual([]);
  }, 180000);
});

describe('TreeLayer lifecycle and wind on WebGPU', () => {
  it('renders with no validation errors', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter: () => Promise<unknown>}}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('A WebGPU adapter is required for this gate.');
      skip('This browser does not expose an available WebGPU adapter.');
    }
    const parent = document.createElement('div');
    parent.style.cssText = 'width:128px;height:128px';
    document.body.append(parent);
    const validationErrors: string[] = [];
    let device: Device | undefined;
    let deck: Deck<MapView> | undefined;
    type NativeDevice = {
      addEventListener: (
        type: 'uncapturederror',
        listener: (event: {error?: {message?: string}}) => void
      ) => void;
      queue: {onSubmittedWorkDone: () => Promise<void>};
    };
    try {
      device = await luma.createDevice({
        type: 'webgpu',
        adapters: [webgl2Adapter, webgpuAdapter],
        createCanvasContext: {container: parent}
      });
      const native = (device as Device & {handle?: NativeDevice}).handle;
      native?.addEventListener('uncapturederror', event =>
        validationErrors.push(event.error?.message ?? 'unknown')
      );
      await new Promise<void>((resolve, reject) => {
        let frames = 0;
        const timeout = window.setTimeout(
          () => reject(new Error('Timed out while rendering TreeLayer.')),
          30000
        );
        deck = new Deck({
          device,
          parent,
          width: 128,
          height: 128,
          _animate: true,
          views: new MapView({id: 'tree-lifecycle-webgpu'}),
          initialViewState: {longitude: 0, latitude: 0, zoom: 16, pitch: 45},
          layers: [
            new TreeLayer<TreeSpec>({
              id: 'trees',
              coordinateSystem: 'meter-offsets',
              coordinateOrigin: [0, 0, 0],
              data: [
                tree('citrus', {growth: 0.5, health: 0.6, flush: 0.4, damage: 0.3}),
                tree('pine', {position: [12, 0, 0], lean: [40, 90], decay: 0.3}),
                tree('palm', {position: [-12, 0, 0], foliage: 0.5})
              ],
              getTree: (row: TreeSpec) => row,
              windStrength: 0.4,
              windDirection: 60,
              windTime: 1.25,
              pickable: true
            })
          ],
          onAfterRender: () => {
            if (++frames < 8) return;
            window.clearTimeout(timeout);
            resolve();
          },
          onError: error => {
            window.clearTimeout(timeout);
            reject(error);
          }
        });
      });
      await native?.queue.onSubmittedWorkDone();
      expect(validationErrors).toEqual([]);
    } finally {
      deck?.finalize();
      device?.destroy();
      parent.remove();
    }
  }, 60000);
});
