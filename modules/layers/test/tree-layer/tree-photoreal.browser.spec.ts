// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  _GlobeView as GlobeView,
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LayerExtension,
  LightingEffect,
  MapView,
  OrbitView,
  type Layer,
  type LayerManager
} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {CubeGeometry} from '@luma.gl/engine';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SelectionPulseExtension, TreeLayer, type TreeSpec} from '../../src';
import {TreePhotorealLeafLayer} from '../../src/tree-layer/tree-photoreal-leaf-layer';
import {TreePhotorealWoodLayer} from '../../src/tree-layer/tree-photoreal-wood-layer';
import {TreeShellLayer} from '../../src/tree-layer/tree-shell-layer';
import {getTreeRenderTiers} from './tree-grove-test-utils';

const SIZE = 256;
const CUBE = new CubeGeometry();

/** A camera in metres: about 8 m away, level with the middle of a 6 m tree. */
const ORBIT_VIEW = new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.05, far: 8} as never);
const ORBIT_STATE = {target: [0, 0, 2.8], rotationOrbit: 20, rotationX: 8, zoom: 5.2, maxZoom: 30};

const coordinates = {
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};

const CITRUS: TreeSpec = {
  species: 'citrus',
  position: [0, 0, 0],
  height: 6,
  crownRadius: 2.6
};

type Scene = {
  deck: Deck;
  errors: string[];
  glErrors: number[];
  /** deck.gl keeps it protected, and this suite reads the layers it renders. */
  layerManager(): LayerManager;
  setViewState(viewState: unknown): void;
  render(layers: Layer[]): Promise<Uint8Array>;
  /** Layers are in place; frames keep drawing. */
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

function trees(props: Record<string, unknown> = {}, data: TreeSpec[] = [CITRUS]) {
  return new TreeLayer<TreeSpec>({
    ...coordinates,
    id: 'trees',
    data,
    getTree: (row: TreeSpec) => row,
    pickable: true,
    // CI renders in software, and few of these tests care how many leaves make up a crown.
    lodBias: 1.5,
    ...props
  });
}

function countPixels(pixels: Uint8Array): number {
  let count = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] > 0) count++;
  return count;
}

function subLayers(scene: Scene): Layer[] {
  return scene.layerManager().getLayers();
}

/** Mean sRGB color, 0-255, of what is drawn in a region. */
function meanColor(
  pixels: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number, number] {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
      if (pixels[offset + 3] === 0) continue;
      for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[offset + channel];
      count++;
    }
  }
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

/** Median sRGB color, 0-255, of what is drawn in a region. */
function medianColor(
  pixels: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number, number] {
  const channels: [number[], number[], number[]] = [[], [], []];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
      if (pixels[offset + 3] === 0) continue;
      for (let channel = 0; channel < 3; channel++)
        channels[channel].push(pixels[offset + channel]);
    }
  }
  const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];
  return [middle(channels[0]), middle(channels[1]), middle(channels[2])];
}

function photorealLayers(scene: Scene): Layer[] {
  return subLayers(scene).filter(
    layer => layer instanceof TreePhotorealWoodLayer || layer instanceof TreePhotorealLeafLayer
  );
}

function treeLayer(scene: Scene): TreeLayer<TreeSpec> {
  return subLayers(scene).find(layer => layer.id === 'trees') as TreeLayer<TreeSpec>;
}

function ground() {
  return new SimpleMeshLayer({
    ...coordinates,
    id: 'ground',
    data: [{}],
    mesh: CUBE,
    getPosition: [0, 0, -0.05],
    getScale: [60, 60, 0.05],
    getColor: [230, 230, 230, 255],
    material: {ambient: 0.6, diffuse: 0.6, shininess: 1, specularColor: [0, 0, 0]},
    shadowEnabled: false
  } as never);
}

// By default from the camera's left, so the shadow falls to the right of the tree.
function lighting(shadow: boolean, direction: [number, number, number] = [1, 0.2, -1]) {
  return new LightingEffect({
    ambient: new AmbientLight({intensity: 0.6}),
    sun: new DirectionalLight({direction, intensity: 1.2, _shadow: shadow})
  });
}

function brightness(pixels: Uint8Array, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0,
    count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
      sum += pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
      count++;
    }
  return sum / (count * 3);
}

/** Shift the receivers on screen, leaving the light, geometry and shadow map unchanged. */
class ShiftShadowReceivers extends LayerExtension<{pixels: number}> {
  static extensionName = 'ShiftShadowReceivers';

  getShaders() {
    return {
      modules: [
        {
          name: 'shiftShadowReceivers',
          vs: 'layout(std140) uniform shiftShadowReceiversUniforms { float offset; } shiftShadowReceivers;',
          uniformTypes: {offset: 'f32'},
          inject: {
            'vs:DECKGL_FILTER_GL_POSITION': {
              order: 100,
              injection: `
#ifdef MODULE_SHADOW
  if (!shadow.drawShadowMap) position.x += shiftShadowReceivers.offset * position.w;
#endif
`
            }
          }
        }
      ]
    };
  }

  draw(this: Layer, _params: unknown, extension: this) {
    const offset = (2 * extension.opts.pixels) / SIZE;
    for (const model of this.getModels()) {
      model.shaderInputs.setProps({shiftShadowReceivers: {offset}});
    }
  }
}

describe('TreeLayer photoreal rendering', () => {
  it('draws nothing at growth 0, and more as growth rises', async () => {
    const scene = mount();
    const counts: number[] = [];
    for (const growth of [0, 0.05, 0.1, 0.3, 0.6, 1]) {
      const pixels = await scene.render([
        trees({
          getGrowth: () => growth,
          updateTriggers: {getGrowth: growth}
        })
      ]);
      counts.push(countPixels(pixels));
    }
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
    expect(counts[0]).toBe(0);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    expect(counts[2]).toBeLessThan(counts[5] * 0.5);
    expect(counts[5]).toBeGreaterThan(5000);
  }, 120000);

  it.each([
    'citrus',
    'oak',
    'pine',
    'palm'
  ] as const)('renders %s wood and foliage through the shared renderer', async species => {
    const scene = mount();
    const tree: TreeSpec = {...CITRUS, species};
    const pixels = await scene.render([trees({lodBias: 0}, [tree])]);
    const parts = photorealLayers(scene);
    expect(
      parts.some(
        layer => layer instanceof TreePhotorealWoodLayer && layer.props.species === species
      )
    ).toBe(true);
    expect(
      parts.some(
        layer => layer instanceof TreePhotorealLeafLayer && layer.props.species === species
      )
    ).toBe(true);
    expect(countPixels(pixels)).toBeGreaterThan(150);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('picks the source row at the trunk and in the crown', async () => {
    const scene = mount();
    const left = {...CITRUS, position: [-3.4, 0, 0]} as TreeSpec;
    const right = {...CITRUS, position: [3.4, 0, 0]} as TreeSpec;
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0, zoom: 4.6});
    await scene.render([trees({windTime: 0}, [left, right])]);
    // Everything in a rectangle, once. Crowns in the upper half of the view, each on its own side.
    const hits = (x: number, y: number, width: number, height: number) =>
      new Set(scene.deck.pickObjects({x, y, width, height}).map(info => info.object));
    const crownLeft = hits(30, 40, 80, 90);
    const crownRight = hits(146, 40, 80, 90);
    expect(crownLeft.size).toBe(1);
    expect(crownLeft.has(left)).toBe(true);
    expect(crownRight.size).toBe(1);
    expect(crownRight.has(right)).toBe(true);
    // The same trees an hour later, all their leaves on the ground: only wood answers, low on the trunk.
    await scene.render([
      trees({getFoliage: () => 0, updateTriggers: {getFoliage: 'bare'}, windTime: 3600}, [
        left,
        right
      ])
    ]);
    const trunk = scene.deck.pickObject({x: 45, y: 172, radius: 5});
    expect(trunk?.object === left).toBe(true);
    // Compared by name: a failure must not print a layer, which reaches the whole deck.
    expect(trunk?.sourceLayer?.constructor.name).toBe('TreePhotorealWoodLayer');
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('casts on the ground with a shadow LightingEffect, and still picks', async () => {
    const scene = mount({
      effects: [lighting(true)],
      viewState: {...ORBIT_STATE, rotationOrbit: 0, rotationX: 28, zoom: 4.4, target: [0, 0, 1.5]}
    });
    const bareGround = await scene.render([ground()]);
    const shadowed = await scene.render([ground(), trees({shadowEnabled: true})]);
    const lit = await scene.render([ground(), trees({shadowEnabled: false})]);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
    // Find ground pixels that stay uncovered by the tree. Most of the shadow falls down-sun, to its right.
    let left = 0;
    let right = 0;
    for (let offset = 0; offset < lit.length; offset += 4) {
      if (
        [0, 1, 2].some(
          channel => Math.abs(lit[offset + channel] - bareGround[offset + channel]) > 2
        )
      )
        continue;
      const dimming = [0, 1, 2].reduce(
        (sum, channel) => sum + lit[offset + channel] - shadowed[offset + channel],
        0
      );
      if (dimming < 30) continue;
      if ((offset / 4) % SIZE > SIZE / 2) right++;
      else left++;
    }
    expect(right).toBeGreaterThan(200);
    expect(right).toBeGreaterThan(left * 4);
    // Picking runs with the shadow module bound to its fallback samplers.
    const picked = scene.deck.pickObject({x: 128, y: 100, radius: 6});
    expect(picked?.object === CITRUS).toBe(true);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('receives shadows on direct light only, and never on the shadow color', async () => {
    // deck.gl fits the shadow map to the view frustum, and clips what lies toward the light beyond it.
    // So the sun comes from over the camera's shoulder, and the slab hangs between the sun and the crown,
    // out of view but inside that fit.
    const scene = mount({effects: [lighting(true, [1, 0.6, -1])]});
    const slab = (shadowEnabled: boolean) =>
      new SimpleMeshLayer({
        ...coordinates,
        id: 'slab',
        data: [{}],
        mesh: CUBE,
        getPosition: [-3.5, -2.1, 6.3],
        getScale: [2.4, 2.4, 0.05],
        getColor: [90, 90, 200, 255],
        material: {unlit: true},
        shadowEnabled
      } as never);
    const shaded = await scene.render([slab(true), trees()]);
    const sunny = await scene.render([slab(false), trees()]);
    expect(scene.errors).toEqual([]);
    const crown = [100, 60, 156, 120] as const;
    const canopyBrightness = (pixels: Uint8Array) =>
      meanColor(pixels, ...crown).reduce((sum, value) => sum + value, 0) / 3;
    expect(canopyBrightness(shaded)).toBeLessThan(canopyBrightness(sunny) * 0.85);
    // Ambient remains: a shaded crown is not black.
    expect(canopyBrightness(shaded)).toBeGreaterThan(4);
  }, 120000);

  it('keeps close shadow filtering stable when the same leaves move across the screen', async () => {
    const scene = mount({
      effects: [lighting(true, [1, 0.6, -1])],
      viewState: {...ORBIT_STATE, zoom: 7.6, target: [0, -0.9, 3.4]}
    });
    const shift = new ShiftShadowReceivers({pixels: 0});
    const original = await scene.render([
      trees({lodBias: -2, windStrength: 0, windTime: 0, extensions: [shift]})
    ]);
    const offset = 16;
    shift.opts.pixels = offset;
    const shifted = await scene.settle();
    expect(
      photorealLayers(scene).some(
        layer => /-leaves-.*-(fine|macro)$/.test(layer.id) && layer.getNumInstances() > 0
      )
    ).toBe(true);
    let sum = 0;
    let samples = 0;
    for (let y = 16; y < SIZE - 16; y++) {
      for (let x = 16; x < SIZE - offset - 16; x++) {
        const a = (y * SIZE + x) * 4;
        const b = a + 4 * offset;
        if (!original[a + 3] || !shifted[b + 3]) continue;
        for (let channel = 0; channel < 3; channel++) {
          sum += Math.abs(original[a + channel] - shifted[b + channel]);
        }
        samples += 3;
      }
    }
    expect(samples).toBeGreaterThan(3000);
    expect(sum / samples).toBeLessThan(0.04);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it.each([
    ['coverage 0', {getCoverageWeight: 0}],
    ['decay 1', {getDecay: () => 1, updateTriggers: {getDecay: 'gone'}}]
  ])(
    'draws and picks nothing at %s',
    async (_, props) => {
      const scene = mount();
      expect(countPixels(await scene.render([trees()]))).toBeGreaterThan(1000);
      const pixels = await scene.render([trees(props)]);
      expect(countPixels(pixels)).toBe(0);
      expect(scene.deck.pickObjects({x: 0, y: 0, width: SIZE, height: SIZE}).length).toBe(0);
      expect(scene.errors).toEqual([]);
    },
    120000
  );

  it('takes wetness, frost and fog as layer props, in every part', async () => {
    const scene = mount();
    const crown = [90, 60, 166, 130] as const;
    const clear = await scene.render([trees()]);
    const wetness = () =>
      photorealLayers(scene).map(layer => (layer.props as unknown as {wetness: number}).wetness);
    expect(new Set(wetness())).toEqual(new Set([0]));

    const wet = await scene.render([trees({wetness: 1})]);
    expect(new Set(wetness())).toEqual(new Set([1]));
    // Rain darkens a leaf, and it mirrors more of the sky: paler, and less green.
    expect(meanColor(wet, ...crown)[2] - meanColor(wet, ...crown)[1]).toBeGreaterThan(
      meanColor(clear, ...crown)[2] - meanColor(clear, ...crown)[1]
    );

    // Rime is pale.
    const frosted = await scene.render([trees({frost: 1})]);
    expect(brightness(frosted, ...crown)).toBeGreaterThan(brightness(clear, ...crown) * 1.1);

    // A surface lost in fog shows exactly the color asked for, whatever its light.
    const color = [180, 40, 60];
    const fogged = await scene.render([trees({fog: {color, density: 4}})]);
    // Well inside the crown, whose outline is uneven now, so no sky shows through a gap at its edge. A median, as
    // a stray pixel of sky or of a part that has no fog of its own would pull a mean away.
    const [red, green, blue] = medianColor(fogged, 118, 95, 138, 120);
    expect(Math.abs(red - color[0])).toBeLessThan(4);
    expect(Math.abs(green - color[1])).toBeLessThan(4);
    expect(Math.abs(blue - color[2])).toBeLessThan(4);

    // A thin fog takes a part of it, with distance.
    const hazy = await scene.render([trees({fog: {color, density: 0.02}})]);
    expect(meanColor(hazy, ...crown)[0]).toBeGreaterThan(meanColor(clear, ...crown)[0]);
    expect(meanColor(hazy, ...crown)[0]).toBeLessThan(color[0] * 0.8);

    const again = await scene.render([trees()]);
    expect(brightness(again, ...crown)).toBeCloseTo(brightness(clear, ...crown), 0);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('thins and rots progressively', async () => {
    const scene = mount();
    const count = async (props: Record<string, unknown>) =>
      countPixels(await scene.render([trees(props)]));
    const full = await count({});
    const half = await count({getCoverageWeight: 0.5, updateTriggers: {getCoverageWeight: 0.5}});
    const rotting = await count({getDecay: () => 0.7, updateTriggers: {getDecay: 0.7}});
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
    expect(rotting).toBeLessThan(full);
    expect(rotting).toBeGreaterThan(0);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('animates getGrowth through updateTriggers without touching sub-layer data or attributes', async () => {
    const scene = mount();
    // A shrinking tree may cross into another level of detail. At the coarsest, that is one thing it cannot do.
    const make = (growth: number) =>
      trees({lodBias: 4, getGrowth: () => growth, updateTriggers: {getGrowth: growth}});
    await scene.render([make(0.9)]);
    const before = photorealLayers(scene);
    expect(before.length).toBeGreaterThan(0);
    const data = new Map(before.map(layer => [layer.id, layer.props.data]));
    const rows = treeLayer(scene).state.photoreal!.rows.slice();
    const attributeWrites = before
      .filter(layer => layer.getAttributeManager()!.attributes.instanceTreeRow)
      .map(layer =>
        vi.spyOn(layer.getAttributeManager()!.attributes.instanceTreeRow, 'updateBuffer')
      );
    const texture = treeLayer(scene).state.stateTexture!;
    // Textures are sealed, so the spy goes on their class.
    const upload = vi.spyOn(Object.getPrototypeOf(texture), 'writeData');
    for (const growth of [0.8, 0.7, 0.6]) await scene.render([make(growth)]);
    expect(scene.errors).toEqual([]);
    expect(upload).toHaveBeenCalled();
    for (const write of attributeWrites) expect(write).not.toHaveBeenCalled();
    // Compared as booleans: a failure must not print rows, which reach the whole deck.
    const after = treeLayer(scene);
    expect(after.state.stateTexture === texture).toBe(true);
    expect(after.state.photoreal!.rows.length).toBe(rows.length);
    expect(after.state.photoreal!.rows.every((row, index) => row === rows[index])).toBe(true);
    for (const layer of photorealLayers(scene))
      expect(layer.props.data === data.get(layer.id)).toBe(true);
    upload.mockRestore();
  }, 120000);

  it('moves trees between levels of detail with the camera, and lodBias shifts the choice', async () => {
    const scene = mount({effects: [lighting(true)]});
    const level = () => getTreeRenderTiers(treeLayer(scene)).get(CITRUS)!;
    const caster = () =>
      subLayers(scene).find(
        (layer): layer is TreeShellLayer<TreeSpec> =>
          layer instanceof TreeShellLayer && layer.id.endsWith('-shadow')
      )!;
    const zoom = (value: number) => scene.setViewState({...ORBIT_STATE, zoom: value});
    zoom(4.2);
    const rows = [CITRUS];
    const lod = {lodBias: 0};
    await scene.render([trees(lod, rows)]);
    const before = level();
    expect(before).toBeLessThan(4);
    const shadowModel = caster().state.model;
    const shadowRows = caster().props.data;
    const data = new Map(photorealLayers(scene).map(layer => [layer.id, layer.props.data]));
    const detail = treeLayer(scene).state.store!.data[8 * 4];
    // A small move stays in its bucket: the same arrays, a little less detail, and no rewrite.
    const writes = photorealLayers(scene)
      .filter(layer => layer.getAttributeManager()!.attributes.instanceTreeRow)
      .map(layer =>
        vi.spyOn(layer.getAttributeManager()!.attributes.instanceTreeRow, 'updateBuffer')
      );
    zoom(4.16);
    await scene.settle();
    expect(level()).toBe(before);
    for (const layer of photorealLayers(scene))
      expect(layer.props.data === data.get(layer.id)).toBe(true);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(treeLayer(scene).state.store!.data[8 * 4]).not.toBe(detail);
    // Moving to hulls keeps the same shadow model and rows.
    zoom(1.2);
    await scene.settle();
    const far = level();
    expect(far).toBeGreaterThan(4);
    expect(caster().state.model).toBe(shadowModel);
    expect(caster().props.data).toBe(shadowRows);
    await scene.render([trees({lodBias: -3}, rows)]);
    expect(level()).toBeLessThan(far);
    expect(caster().state.model).toBe(shadowModel);
    expect(caster().props.data).toBe(shadowRows);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('preloads the canopy and branch models before a camera dive or the first shed leaf', async () => {
    const scene = mount({
      effects: [
        new LightingEffect({
          ambient: new AmbientLight(),
          sun: new DirectionalLight({direction: [-1, -1, -2], _shadow: true})
        })
      ]
    });
    scene.setViewState({...ORBIT_STATE, zoom: 1.2});
    await scene.render([trees({lodBias: 0, windTime: 0})]);
    const models = () =>
      new Map(
        subLayers(scene)
          .filter(
            layer =>
              layer instanceof TreeShellLayer ||
              layer instanceof TreePhotorealLeafLayer ||
              (layer instanceof TreePhotorealWoodLayer && !layer.id.endsWith('-stem'))
          )
          .map(layer => [layer.id, layer.state.model])
      );
    const loaded = models();
    // The 13 individual leaf and branch variants, four fitted canopy tiers, and two stable casters.
    expect(loaded.size).toBe(19);
    expect([...loaded.values()].every(Boolean)).toBe(true);
    const unchanged = () => {
      const current = models();
      expect([...current.keys()]).toEqual([...loaded.keys()]);
      for (const [id, model] of current) expect(model === loaded.get(id)).toBe(true);
    };
    for (const zoom of [3.5, 5.2, 7, 1.2]) {
      scene.setViewState({...ORBIT_STATE, zoom});
      await scene.settle();
      unchanged();
    }
    // A field scheduler keeps one far-away row per template, and replaces the visible near rows.
    // Changing that membership must keep every compiled variant, even while a level becomes empty.
    const keeper: TreeSpec = {...CITRUS, position: [2000, 2000, 0]};
    for (const data of [
      [keeper],
      [keeper, CITRUS],
      [keeper, {...CITRUS, position: [1, 0, 0] as [number, number, number]}]
    ]) {
      await scene.render([trees({lodBias: 0, windTime: 0}, data)]);
      unchanged();
    }
    // Flying leaves need two more shader variants. Their empty models were loaded with the rest.
    scene.setViewState({...ORBIT_STATE, zoom: 5.2});
    await scene.render([
      trees(
        {
          lodBias: -3,
          // A fixed, usable clock step records a loss rate, then holds the airborne leaves still.
          windTime: 1 / 30,
          getFoliage: 0.4
        },
        [keeper, CITRUS]
      )
    ]);
    await expect
      .poll(() =>
        photorealLayers(scene).some(
          layer => layer.id.includes('-air-') && layer.getNumInstances() > 0
        )
      )
      .toBe(true);
    unchanged();
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('rebuilds near leaf blades when detail changes without a camera move', async () => {
    const scene = mount({viewState: {...ORBIT_STATE, zoom: 8}});
    const data = [CITRUS];
    const props = {windTime: 0, windStrength: 0, _leafCulling: false};
    const nearBlades = () => {
      const group = [...treeLayer(scene).state.photoreal!.groups.values()][0];
      return [group.fineData.length, group.macroData.length];
    };
    await scene.render([trees({...props, lodBias: 1.5}, data)]);
    const lower = nearBlades();
    const raised = await scene.render([trees({...props, lodBias: 0}, data)]);
    const raisedBlades = nearBlades();
    // Load the same final view without a previous blade list to reuse.
    await scene.render([]);
    const direct = await scene.render([trees({...props, lodBias: 0}, data)]);
    const directBlades = nearBlades();
    expect(directBlades[1]).toBeGreaterThan(lower[1]);
    expect(raisedBlades).toEqual(directBlades);
    let difference = 0;
    for (let offset = 0; offset < direct.length; offset++) {
      difference += Math.abs(direct[offset] - raised[offset]);
    }
    expect(difference / direct.length).toBeLessThan(0.01);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('compacts offscreen near leaves without changing macro pixels, shadows or picking', async () => {
    const scene = mount({
      effects: [
        new LightingEffect({
          ambient: new AmbientLight(),
          sun: new DirectionalLight({direction: [-1, -1, -2], _shadow: true})
        })
      ]
    });
    scene.setViewState({...ORBIT_STATE, zoom: 8});
    const props = {lodBias: -3, windTime: 12, windStrength: 0.03, windDirection: 80, wetness: 0.7};
    const reference = await scene.render([
      ground(),
      trees({...props, _leafCulling: false, _woodCulling: false})
    ]);
    const selected = await scene.render([
      ground(),
      trees({...props, _leafCulling: true, _woodCulling: true})
    ]);
    const listed = photorealLayers(scene).find(layer => layer.id.endsWith('-listed'))!;
    const group = [...treeLayer(scene).state.photoreal!.groups.values()][0];
    const woodStates = photorealLayers(scene)
      .filter(layer => layer instanceof TreePhotorealWoodLayer)
      .map(layer => (layer as TreePhotorealWoodLayer).state);
    expect(woodStates.some(state => state.woodCullingActive)).toBe(true);
    expect(
      woodStates.reduce((sum, state) => sum + (state.woodSubmittedIndices ?? 0), 0)
    ).toBeLessThan(woodStates.reduce((sum, state) => sum + (state.woodOriginalIndices ?? 0), 0));
    expect(listed.getNumInstances()).toBeGreaterThan(0);
    expect(listed.getNumInstances()).toBeLessThan(group.model.leafCount);
    const caster = subLayers(scene).find(
      layer => layer instanceof TreeShellLayer && layer.id.endsWith('-shadow')
    );
    expect(caster?.getNumInstances()).toBe(1);
    expect((listed.props as unknown as {shadowInstances: number}).shadowInstances).toBe(0);
    let difference = 0;
    for (let offset = 0; offset < reference.length; offset++)
      difference += Math.abs(reference[offset] - selected[offset]);
    // A different opaque submission order may change a tie by one quantization step.
    expect(difference / reference.length).toBeLessThan(0.01);
    const pick = () => scene.deck.pickObject({x: SIZE / 2, y: SIZE / 2, radius: 16});
    const compactPick = pick();
    await scene.render([ground(), trees({...props, _leafCulling: false, _woodCulling: false})]);
    const referencePick = pick();
    expect(compactPick?.object).toBe(referencePick?.object);
    expect(compactPick?.index).toBe(referencePick?.index);
    expect(compactPick?.object).toBe(CITRUS);
    const storm = {...props, windStrength: 0.5};
    const stormReference = await scene.render([
      ground(),
      trees({...storm, _leafCulling: false, _woodCulling: false})
    ]);
    const stormSelected = await scene.render([
      ground(),
      trees({...storm, _leafCulling: true, _woodCulling: true})
    ]);
    let stormDifference = 0;
    for (let offset = 0; offset < stormReference.length; offset++)
      stormDifference += Math.abs(stormReference[offset] - stormSelected[offset]);
    expect(stormDifference / stormReference.length).toBeLessThan(0.01);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('culls trees far outside the view, and keeps those that may cast into it', async () => {
    const scene = mount({effects: [lighting(true)]});
    const near = {...CITRUS, position: [0, 0, 0]} as TreeSpec;
    const beside = {...CITRUS, position: [18, 0, 0]} as TreeSpec;
    const distant = {...CITRUS, position: [400, 0, 0]} as TreeSpec;
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0, rotationX: 0});
    await scene.render([trees({}, [near, beside, distant])]);
    const layer = treeLayer(scene);
    const colors = getTreeRenderTiers(layer);
    const casters = [...layer.state.photoreal!.groups.values()].flatMap(group =>
      group.shadowBucket.map(row => row.object)
    );
    expect(colors.has(near)).toBe(true);
    expect(colors.has(beside)).toBe(false);
    expect(colors.has(distant)).toBe(false);
    expect(casters).toContain(near);
    expect(casters).toContain(beside);
    expect(casters).not.toContain(distant);
    const picked = scene.deck.pickObjects({x: 0, y: 0, width: SIZE, height: SIZE});
    expect(picked.map(info => info.object)).toContain(near);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('tweens growth through the transitions prop on a stepped timeline', async () => {
    const scene = mount();
    await scene.render([]);
    const timeline = scene.layerManager().context.timeline;
    timeline.pause();
    timeline.setTime(1000);
    const started = vi.fn();
    const ended = vi.fn();
    const make = (growth: number) =>
      trees({
        getGrowth: () => growth,
        updateTriggers: {getGrowth: growth},
        transitions: {getGrowth: {duration: 2000, onStart: started, onEnd: ended}}
      });
    const before = countPixels(await scene.render([make(0.15)]));
    expect(treeLayer(scene).state.store!.getRowValues(0).growth).toBeCloseTo(0.15);
    // The target changes while the clock stands still: nothing moves yet.
    const still = countPixels(await scene.render([make(0.95)]));
    expect(started).toHaveBeenCalledTimes(1);
    expect(treeLayer(scene).state.store!.getRowValues(0).growth).toBeCloseTo(0.15);
    expect(still).toBe(before);
    // Halfway through.
    timeline.setTime(2000);
    const middle = countPixels(await scene.settle());
    expect(treeLayer(scene).state.store!.getRowValues(0).growth).toBeCloseTo(0.55);
    expect(treeLayer(scene).state.ticking).toBe(true);
    expect(middle).toBeGreaterThan(before);
    expect(ended).not.toHaveBeenCalled();
    // The end.
    timeline.setTime(3000);
    const final = countPixels(await scene.settle());
    expect(treeLayer(scene).state.store!.getRowValues(0).growth).toBeCloseTo(0.95);
    expect(treeLayer(scene).state.ticking).toBe(false);
    expect(final).toBeGreaterThan(middle);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('sends falling leaves through the air when foliage falls between consecutive frames', async () => {
    const scene = mount();
    const make = (foliage: number, windTime: number) =>
      trees({
        getFoliage: () => foliage,
        updateTriggers: {getFoliage: foliage},
        windTime,
        windStrength: 0.05,
        windDirection: 90
      });
    const resting = await scene.render([make(0.5, 10)]);
    await scene.render([make(0.5, 20)]);
    // Two frames a sixtieth of a second apart, at a rate the eye could follow: leaves in the air, far from the crown.
    await scene.render([make(0.503, 30)]);
    const flying = await scene.render([make(0.5, 30 + 1 / 60)]);
    const store = treeLayer(scene).state.store!;
    expect(store.data[8 * 4 + 2]).toBeGreaterThan(0.1);
    expect(scene.errors).toEqual([]);
    // Downwind of the crown, to the right of the view, leaves pass where nothing was.
    const count = (pixels: Uint8Array) => {
      let filled = 0;
      for (let y = 0; y < 256; y++)
        for (let x = 200; x < 256; x++)
          if (pixels[((SIZE - 1 - y) * SIZE + x) * 4 + 3] > 0) filled++;
      return filled;
    };
    expect(count(flying)).toBeGreaterThan(count(resting));
  }, 120000);

  it('renders in a map at longitude and latitude, and on a globe', async () => {
    const lngLat = (position: TreeSpec['position']): TreeSpec => ({...CITRUS, position});
    const map = mount({
      views: new MapView(),
      viewState: {longitude: -81.5, latitude: 28, zoom: 20, pitch: 50, bearing: 20}
    });
    const mapPixels = await map.render([
      trees({coordinateSystem: COORDINATE_SYSTEM.LNGLAT}, [lngLat([-81.5, 28, 0])])
    ]);
    expect(countPixels(mapPixels)).toBeGreaterThan(1000);
    expect(Boolean(map.deck.pickObject({x: 128, y: 110, radius: 8})?.object)).toBe(true);
    expect(map.errors).toEqual([]);

    const globe = mount({
      views: new GlobeView(),
      viewState: {longitude: -81.5, latitude: 28, zoom: 9.5}
    });
    const globePixels = await globe.render([
      trees({coordinateSystem: COORDINATE_SYSTEM.LNGLAT, sizeScale: 1000}, [lngLat([-81.5, 28, 0])])
    ]);
    expect(countPixels(globePixels)).toBeGreaterThan(50);
    expect(globe.errors).toEqual([]);
  }, 120000);

  it('highlights one tree, and takes a color filter extension', async () => {
    const scene = mount();
    const left = {...CITRUS, position: [-3.4, 0, 0]} as TreeSpec;
    const right = {...CITRUS, position: [3.4, 0, 0]} as TreeSpec;
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0, zoom: 4.6});
    const data = [left, right];
    const plain = await scene.render([trees({}, data)]);
    const highlighted = await scene.render([
      trees({highlightedObjectIndex: 1, highlightColor: [255, 0, 0, 200]}, data)
    ]);
    const redness = (pixels: Uint8Array, x0: number, x1: number) => {
      let sum = 0;
      for (let y = 40; y < 130; y++)
        for (let x = x0; x < x1; x++) sum += pixels[((SIZE - 1 - y) * SIZE + x) * 4];
      return sum;
    };
    expect(redness(highlighted, 146, 226)).toBeGreaterThan(redness(plain, 146, 226) * 1.5);
    expect(Math.abs(redness(highlighted, 30, 110) / redness(plain, 30, 110) - 1)).toBeLessThan(
      0.02
    );
    // deck.gl initializes extensions with a layer, so this tree carries it from its first render.
    const extensions = [new SelectionPulseExtension()];
    const pulsing = await scene.render([
      trees(
        {
          id: 'pulsing-trees',
          extensions,
          getSelected: true,
          updateTriggers: {getSelected: true},
          pulseColor: [255, 255, 255],
          pulseStrength: 1,
          pulsePeriod: 0
        },
        data
      )
    ]);
    expect(brightness(pulsing, 30, 40, 110, 130)).toBeGreaterThan(
      brightness(plain, 30, 40, 110, 130) + 20
    );
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('takes up to two crops in an array', async () => {
    const scene = mount();
    const flower = {kind: 'flower', color: [255, 252, 240, 255], count: 40, radius: 0.05} as const;
    const fruit = {
      color: [244, 140, 24, 255],
      unripeColor: [86, 128, 44, 255],
      ripeness: 0.5,
      fallen: 0.25,
      count: 40,
      radius: 0.08
    } as const;
    const crop = [flower, fruit, flower] as TreeSpec['crop'];
    await scene.render([trees({}, [{...CITRUS, crop}])]);
    const cropLayers = subLayers(scene).filter(layer => layer.id.includes('photoreal-crops'));
    expect(cropLayers.some(layer => layer.id.includes('-flower-'))).toBe(true);
    expect(cropLayers.some(layer => layer.id.includes('-fruit-'))).toBe(true);
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('follows its data: trees come and go, change species, and pass a line of the state texture', async () => {
    const scene = mount();
    const rowObjects = () =>
      new Set(treeLayer(scene).state.photoreal?.rows.flatMap(row => (row ? [row.object] : [])));
    const left = {...CITRUS, position: [-3.4, 0, 0]} as TreeSpec;
    const right = {...CITRUS, position: [3.4, 0, 0]} as TreeSpec;
    const one = countPixels(await scene.render([trees({}, [left])]));
    const two = countPixels(await scene.render([trees({}, [left, right])]));
    expect(one).toBeGreaterThan(1000);
    expect(two).toBeGreaterThan(one * 1.4);
    expect(rowObjects().size).toBe(2);

    // A tree that goes takes all its pixels with it.
    expect(countPixels(await scene.render([trees({}, [left])]))).toBe(one);
    expect(rowObjects().has(right)).toBe(false);

    // A new template for the same row.
    const oak = {...left, species: 'oak'} as TreeSpec;
    await scene.render([trees({}, [oak])]);
    const ids = photorealLayers(scene)
      .filter(layer => (layer.props.data as unknown[]).length > 0)
      .map(layer => layer.id);
    expect(ids.some(id => id.includes('-oak-'))).toBe(true);
    expect(ids.some(id => id.includes('-citrus-'))).toBe(false);

    // A change of species selects a new template for the same owner row.
    const pine = {...left, species: 'pine'} as TreeSpec;
    await scene.render([trees({}, [pine])]);
    expect(rowObjects()).toEqual(new Set([pine]));
    await scene.render([trees({}, [left])]);
    expect(rowObjects().has(left)).toBe(true);

    // The state texture holds 64 rows on a line.
    const texture = treeLayer(scene).state.stateTexture!;
    const many = Array.from(
      {length: 70},
      (_, index) =>
        ({
          ...CITRUS,
          height: 1,
          crownRadius: 0.4,
          position: [(index % 10) - 4.5, Math.floor(index / 10) - 3.5, 0]
        }) as TreeSpec
    );
    expect(countPixels(await scene.render([trees({}, many)]))).toBeGreaterThan(one * 0.2);
    const grown = treeLayer(scene).state.stateTexture!;
    expect(grown === texture).toBe(false);
    expect(grown.height).toBe(2);
    expect(rowObjects().size).toBe(70);

    expect(countPixels(await scene.render([trees({}, [])]))).toBe(0);
    expect(scene.errors).toEqual([]);
    expect(scene.glErrors).toEqual([]);
  }, 120000);

  it('highlights the hovered tree with autoHighlight', async () => {
    const scene = mount();
    const left = {...CITRUS, position: [-3.4, 0, 0]} as TreeSpec;
    const right = {...CITRUS, position: [3.4, 0, 0]} as TreeSpec;
    scene.setViewState({...ORBIT_STATE, rotationOrbit: 0, zoom: 4.6});
    const make = () =>
      trees({autoHighlight: true, highlightColor: [255, 0, 0, 200]}, [left, right]);
    const plain = await scene.render([make()]);
    const hovered = scene.deck
      .pickObjects({x: 146, y: 40, width: 80, height: 90})
      .find(info => info.object === right);
    expect(hovered).toBeDefined();
    (
      treeLayer(scene) as unknown as {_updateAutoHighlight(info: unknown): void}
    )._updateAutoHighlight(hovered);
    const highlighted = await scene.settle();
    const redness = (pixels: Uint8Array, x0: number, x1: number) => {
      let sum = 0;
      for (let y = 40; y < 130; y++)
        for (let x = x0; x < x1; x++) sum += pixels[((SIZE - 1 - y) * SIZE + x) * 4];
      return sum;
    };
    expect(redness(highlighted, 146, 226)).toBeGreaterThan(redness(plain, 146, 226) * 1.5);
    expect(Math.abs(redness(highlighted, 30, 110) / redness(plain, 30, 110) - 1)).toBeLessThan(
      0.02
    );
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('releases its textures and buffers with the layer', async () => {
    const scene = mount();
    await scene.render([trees()]);
    const texture = treeLayer(scene).state.stateTexture!;
    const destroy = vi.spyOn(Object.getPrototypeOf(texture), 'destroy');
    await scene.render([]);
    expect(destroy.mock.contexts.includes(texture)).toBe(true);
    destroy.mockRestore();
    expect(scene.errors).toEqual([]);
  }, 120000);
});

describe('TreeLayer lifecycle geometry', () => {
  it('draws larger trees as they grow and draws nothing at zero', async () => {
    const scene = mount();
    const counts: number[] = [];
    for (const growth of [0, 0.2, 1]) {
      counts.push(
        countPixels(
          await scene.render([
            trees({getGrowth: () => growth, updateTriggers: {getGrowth: growth}})
          ])
        )
      );
    }
    expect(scene.errors).toEqual([]);
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(counts[1]);
  }, 120000);

  it('changes foliage, lean and decay in the rendered geometry', async () => {
    const scene = mount();
    const count = async (props: Record<string, unknown>) =>
      countPixels(await scene.render([trees(props)]));
    const full = await count({});
    const bare = await count({getFoliage: () => 0, updateTriggers: {getFoliage: 0}});
    expect(bare).toBeGreaterThan(0);
    expect(bare).toBeLessThan(full);
    const gone = await count({
      getFoliage: () => 1,
      getDecay: () => 1,
      updateTriggers: {getFoliage: 1, getDecay: 1}
    });
    expect(gone).toBe(0);
    const uprightTop = await scene.render([trees({updateTriggers: {getDecay: 0}})]);
    const leaning = await scene.render([
      trees({getLean: () => [80, 90], updateTriggers: {getLean: 80}})
    ]);
    // The top of the view empties when the tree lies down.
    const top = (pixels: Uint8Array) => {
      let filled = 0;
      for (let y = 0; y < 90; y++)
        for (let x = 0; x < SIZE; x++)
          if (pixels[((SIZE - 1 - y) * SIZE + x) * 4 + 3] > 0) filled++;
      return filled;
    };
    expect(top(leaning)).toBeLessThan(top(uprightTop));
    expect(scene.errors).toEqual([]);
  }, 120000);

  it('tweens through the same transitions prop', async () => {
    const scene = mount();
    await scene.render([]);
    const timeline = scene.layerManager().context.timeline;
    timeline.pause();
    timeline.setTime(1000);
    const make = (growth: number) =>
      trees({
        getGrowth: () => growth,
        updateTriggers: {getGrowth: growth},
        transitions: {getGrowth: 2000}
      });
    const small = countPixels(await scene.render([make(0.1)]));
    await scene.render([make(1)]);
    timeline.setTime(2000);
    await scene.settle();
    expect(treeLayer(scene).state.store!.getRowValues(0).growth).toBeCloseTo(0.55);
    const middle = countPixels(await scene.settle());
    timeline.setTime(3000);
    await scene.settle();
    const final = countPixels(await scene.settle());
    expect(middle).toBeGreaterThan(small);
    expect(final).toBeGreaterThan(middle);
    expect(treeLayer(scene).state.ticking).toBe(false);
    expect(scene.errors).toEqual([]);
  }, 120000);
});
