// deck.gl-community
// SPDX-License-Identifier: MIT
import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  type Layer
} from '@deck.gl/core';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {luma, type Device} from '@luma.gl/core';
import {CubeGeometry} from '@luma.gl/engine';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import 'maplibre-gl';
import {describe, expect, it} from 'vitest';
import {SelectionPulseExtension, SplatLayer, TreeLayer, type TreeSpec} from '../../src';
import {requireWebGPUAdapter} from '../webgpu-test-utils';

const SIZE = 256;
const CUBE = new CubeGeometry();
/** Top-down at the equator: about 0.15 m per pixel, so a 4 m crown spans ~50 px. */
const VIEW_STATE = {longitude: 0, latitude: 0, zoom: 19, pitch: 0, bearing: 0};
/** The sun shines east and down at 45°: shadows fall east (right) of each tree. */
const SUN_DIRECTION: [number, number, number] = [1, 0, -1];

type Rect = {x0: number; y0: number; x1: number; y1: number};
/** Ground east of the crown, inside its shadow; ground west of it, in sunlight. */
const SHADOW: Rect = {x0: 166, y0: 112, x1: 206, y1: 144};
const SHADOW_AREA = (SHADOW.x1 - SHADOW.x0) * (SHADOW.y1 - SHADOW.y0);
const SUNLIT: Rect = {x0: 40, y0: 112, x1: 80, y1: 144};
/** The crown as seen from above. */
const CROWN: Rect = {x0: 112, y0: 112, x1: 144, y1: 144};

const OAK: TreeSpec = {
  species: 'oak',
  position: [0, 0, 0],
  height: 10,
  crownRadius: 4,
  trunkRadius: 0.35,
  crop: {count: 12, droppedCount: 6, radius: 0.08, color: [220, 60, 30, 255]}
};

function lighting(shadow: boolean) {
  return new LightingEffect({
    ambient: new AmbientLight({intensity: 0.6}),
    sun: new DirectionalLight({direction: SUN_DIRECTION, intensity: 0.8, _shadow: shadow})
  });
}

/** A lit SimpleMeshLayer ground plane that receives shadows. */
function ground(coordinateSystem: number = COORDINATE_SYSTEM.METER_OFFSETS) {
  return new SimpleMeshLayer({
    id: 'ground',
    data: [{}],
    mesh: CUBE,
    coordinateSystem,
    coordinateOrigin: [0, 0, 0],
    getPosition: [0, 0, -0.05],
    getScale: [40, 40, 0.05],
    getColor: [230, 230, 230, 255],
    material: {ambient: 0.6, diffuse: 0.6, shininess: 1, specularColor: [0, 0, 0]},
    // deck.gl 9.4's lit SimpleMeshLayer filters color before lighting, so its own shadow-map
    // depth is shaded and the plane would shadow itself. A ground plane only needs to receive.
    shadowEnabled: false
  } as any);
}

/** An unlit slab west of and above the crown: under SUN_DIRECTION its shadow covers the tree. */
function occluder(shadowEnabled: boolean) {
  return new SimpleMeshLayer({
    id: 'occluder',
    data: [{}],
    mesh: CUBE,
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [0, 0, 0],
    getPosition: [-10, 0, 17],
    getScale: [5, 8, 0.2],
    getColor: [90, 90, 200, 255],
    material: {unlit: true},
    shadowEnabled
  } as any);
}

class CanopyOnlyTreeLayer extends TreeLayer<TreeSpec> {
  static layerName = 'CanopyOnlyTreeLayer';
  filterSubLayer({layer}) {
    return layer.id.includes('canopy');
  }
}
class WoodOnlyTreeLayer extends TreeLayer<TreeSpec> {
  static layerName = 'WoodOnlyTreeLayer';
  filterSubLayer({layer}) {
    return !layer.id.includes('canopy');
  }
}

function trees(props: Record<string, unknown> = {}, Type: typeof TreeLayer = TreeLayer) {
  return new Type<TreeSpec>({
    id: 'trees',
    data: [OAK],
    getTree: (row: TreeSpec) => row,
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [0, 0, 0],
    windStrength: 0,
    pickable: true,
    ...props
  });
}

function mount() {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.append(parent);
  let pixels = new Uint8Array(),
    frames = 0;
  const errors: string[] = [];
  const deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView(),
    initialViewState: VIEW_STATE,
    effects: [lighting(true)],
    layers: [],
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    }
  });
  return {
    deck,
    errors,
    /** Layers from `setProps` apply on a later animation frame than an immediate redraw. */
    async render(layers: Layer[]) {
      deck.setProps({layers});
      const before = frames;
      await expect.poll(() => frames, {timeout: 30000}).toBeGreaterThan(before + 5);
      return pixels;
    },
    cleanup() {
      deck.finalize();
      parent.remove();
    }
  };
}

/** Mean RGB of the pixels in a rectangle with nonzero alpha; y grows downward. */
function brightness(pixels: Uint8Array, {x0, y0, x1, y1}: Rect) {
  let sum = 0,
    count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
      if (pixels[offset + 3] === 0) continue;
      sum += (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
      count++;
    }
  return count ? sum / count : 0;
}

/** Pixels in a rectangle at least 30% darker in `shadowed` than in `lit`. */
function countDarkened(shadowed: Uint8Array, lit: Uint8Array, {x0, y0, x1, y1}: Rect) {
  let count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const offset = ((SIZE - 1 - y) * SIZE + x) * 4;
      const value = (pixels: Uint8Array) =>
        pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
      if (value(shadowed) < value(lit) * 0.7) count++;
    }
  return count;
}

describe('TreeLayer deck.gl shadows (WebGL2)', () => {
  it.each([
    ['metre offsets', COORDINATE_SYSTEM.METER_OFFSETS],
    ['longitude/latitude', COORDINATE_SYSTEM.LNGLAT]
  ] as const)(
    'casts a tree shadow onto a SimpleMeshLayer ground in %s',
    async (_, coordinateSystem) => {
      const scene = mount();
      try {
        const make = (shadowEnabled: boolean) => [
          ground(coordinateSystem),
          trees({coordinateSystem, shadowEnabled})
        ];
        const shadowed = await scene.render(make(true));
        const lit = await scene.render(make(false));
        expect(scene.errors).toEqual([]);
        // The sunlit ground is unchanged; the ground east of the tree loses the direct sun.
        expect(Math.abs(brightness(shadowed, SUNLIT) - brightness(lit, SUNLIT))).toBeLessThan(2);
        expect(brightness(shadowed, SHADOW)).toBeLessThan(brightness(lit, SHADOW) * 0.6);
      } finally {
        scene.cleanup();
      }
    },
    60000
  );

  it('casts shadows from the Gaussian canopy and from the wood independently', async () => {
    const scene = mount();
    try {
      const region = {x0: 128, y0: 96, x1: 232, y1: 160};
      const canopy = await scene.render([ground(), trees({}, CanopyOnlyTreeLayer)]);
      const canopyLit = await scene.render([
        ground(),
        trees({shadowEnabled: false}, CanopyOnlyTreeLayer)
      ]);
      const wood = await scene.render([ground(), trees({}, WoodOnlyTreeLayer)]);
      const woodLit = await scene.render([
        ground(),
        trees({shadowEnabled: false}, WoodOnlyTreeLayer)
      ]);
      expect(scene.errors).toEqual([]);
      expect(brightness(canopy, SHADOW)).toBeLessThan(brightness(canopyLit, SHADOW) * 0.6);
      // The bole and branch lattice cast a sparse shadow: some ground, not all of it, darkens.
      const woodShadow = countDarkened(wood, woodLit, region);
      expect(woodShadow).toBeGreaterThan(40);
      expect(woodShadow).toBeLessThan(countDarkened(canopy, canopyLit, region));
    } finally {
      scene.cleanup();
    }
  }, 60000);

  it('thins canopy shadows with optical coverage and drops them at zero coverage', async () => {
    const scene = mount();
    try {
      const lit = await scene.render([
        ground(),
        trees({shadowEnabled: false}, CanopyOnlyTreeLayer)
      ]);
      const darkened = async (coverage: number) =>
        countDarkened(
          await scene.render([
            ground(),
            trees(
              {getCoverageWeight: coverage, updateTriggers: {getCoverageWeight: coverage}},
              CanopyOnlyTreeLayer
            )
          ]),
          lit,
          SHADOW
        );
      const full = await darkened(1);
      const partial = await darkened(0.25);
      const none = await darkened(0);
      expect(scene.errors).toEqual([]);
      expect(full).toBeGreaterThan(SHADOW_AREA * 0.5);
      expect(partial).toBeGreaterThan(0);
      expect(partial).toBeLessThan(full * 0.9);
      expect(none).toBe(0);
    } finally {
      scene.cleanup();
    }
  }, 60000);

  it('keeps a sunlit crown as bright as without shadows: crowns do not shadow themselves', async () => {
    const scene = mount();
    try {
      // Weighted transparency averages leaves through the crown, so leaf-by-leaf self-shadowing
      // would darken its sunlit side with its shaded interior.
      const casting = await scene.render([trees()]);
      const receiving = await scene.render([trees({shadowEnabled: false})]);
      expect(scene.errors).toEqual([]);
      expect(brightness(receiving, CROWN)).toBeGreaterThan(0);
      expect(brightness(casting, CROWN)).toBeGreaterThan(brightness(receiving, CROWN) * 0.95);
    } finally {
      scene.cleanup();
    }
  }, 60000);

  it('keeps every crown of a mixed grove lit: later sub-layers do not shadow themselves', async () => {
    // deck.gl offsets each layer's depth by its stack index, also in its shadow pass. Species
    // groups give many wood, crop and canopy sub-layers, and a pitched view deepens the light's
    // depth range; trees stand in north-south lines so the western sun cannot shade one with another.
    const species = ['oak', 'citrus', 'pine', 'birch', 'banyan', 'palm', 'cherry', 'mangrove'];
    const metre = 1 / 111320;
    const grove = species.flatMap((name, column) =>
      [0, 1, 2].map(
        (row): TreeSpec => ({
          species: name as TreeSpec['species'],
          position: [(column - 3.5) * 9 * metre, (row - 1) * 30 * metre, 0],
          height: 8,
          crownRadius: 3,
          trunkRadius: 0.3,
          crop: name === 'citrus' ? OAK.crop : undefined
        })
      )
    );
    const scene = mount();
    scene.deck.setProps({viewState: {...VIEW_STATE, zoom: 18.2, pitch: 55}});
    try {
      const all = {x0: 0, y0: 0, x1: SIZE, y1: SIZE};
      const make = (shadowEnabled: boolean) =>
        trees({data: grove, coordinateSystem: COORDINATE_SYSTEM.LNGLAT, shadowEnabled});
      const casting = await scene.render([make(true)]);
      const receiving = await scene.render([make(false)]);
      expect(scene.errors).toEqual([]);
      expect(brightness(receiving, all)).toBeGreaterThan(0);
      expect(brightness(casting, all)).toBeGreaterThan(brightness(receiving, all) * 0.9);
    } finally {
      scene.cleanup();
    }
  }, 60000);

  it.each([
    ['canopy', {}],
    ['winter wood', {getSeason: 'winter'}]
  ] as const)(
    'receives shadows on the %s',
    async (_, props) => {
      const scene = mount();
      try {
        const shadowed = await scene.render([occluder(true), trees(props)]);
        const lit = await scene.render([occluder(false), trees(props)]);
        expect(scene.errors).toEqual([]);
        expect(brightness(lit, CROWN)).toBeGreaterThan(0);
        expect(brightness(shadowed, CROWN)).toBeLessThan(brightness(lit, CROWN) * 0.8);
      } finally {
        scene.cleanup();
      }
    },
    60000
  );

  it('keeps picking and autoHighlight, and highlights do not reach the shadow map', async () => {
    const scene = mount();
    try {
      const plain = await scene.render([ground(), trees({autoHighlight: true})]);
      expect(scene.deck.pickObject({x: 128, y: 128})?.object).toBe(OAK);
      const highlighted = await scene.render([
        ground(),
        trees({autoHighlight: true, highlightedObjectIndex: 0, highlightColor: [255, 0, 0, 255]})
      ]);
      expect(scene.errors).toEqual([]);
      expect(Math.abs(brightness(highlighted, CROWN) - brightness(plain, CROWN))).toBeGreaterThan(
        5
      );
      expect(Math.abs(brightness(highlighted, SHADOW) - brightness(plain, SHADOW))).toBeLessThan(1);
      expect(scene.deck.pickObject({x: 128, y: 128})?.object).toBe(OAK);
    } finally {
      scene.cleanup();
    }
  }, 60000);

  it('moves canopy and wood shadows with the wind', async () => {
    const scene = mount();
    try {
      const wind = (windTime: number) => trees({windStrength: 0.15, windTime});
      const calm = await scene.render([ground(), wind(0)]);
      const gust = await scene.render([ground(), wind(0.9)]);
      const lit = await scene.render([ground(), trees({shadowEnabled: false})]);
      expect(scene.errors).toEqual([]);
      expect(brightness(gust, SHADOW)).toBeLessThan(brightness(lit, SHADOW) * 0.7);
      const region = {x0: 120, y0: 80, x1: 240, y1: 176};
      // Bending the crown moves its shadow: some ground changes between the two wind phases.
      expect(countDarkened(gust, calm, region) + countDarkened(calm, gust, region)).toBeGreaterThan(
        20
      );
    } finally {
      scene.cleanup();
    }
  }, 60000);

  it('casts and receives the same shadows while a SelectionPulseExtension pulses', async () => {
    const scene = mount();
    try {
      // deck.gl initializes extensions with the layer, so the tree carries it from its first
      // render. A steady full-strength white tint makes the pulse maximal in every frame.
      const extensions = [new SelectionPulseExtension()];
      const pulse = (selected: boolean) => ({
        extensions,
        getSelected: selected,
        updateTriggers: {getSelected: selected},
        pulseColor: [255, 255, 255],
        pulseStrength: 1,
        pulsePeriod: 0
      });
      const still = await scene.render([ground(), trees(pulse(false))]);
      const pulsing = await scene.render([ground(), trees(pulse(true))]);
      expect(brightness(pulsing, CROWN)).toBeGreaterThan(brightness(still, CROWN) + 20);
      // The pulse changes colors only; the shadow pass writes the same depth.
      expect(Math.abs(brightness(pulsing, SHADOW) - brightness(still, SHADOW))).toBeLessThan(1);
      const occludedPulse = await scene.render([occluder(true), trees(pulse(true))]);
      const sunlitPulse = await scene.render([occluder(false), trees(pulse(true))]);
      expect(brightness(occludedPulse, CROWN)).toBeLessThan(brightness(sunlitPulse, CROWN) * 0.85);
      expect(scene.errors).toEqual([]);
    } finally {
      scene.cleanup();
    }
  }, 60000);

  it.each([
    'weighted',
    'sorted'
  ] as const)('casts %s SplatLayer Gaussians and keeps them pickable', async transparency => {
    const scene = mount();
    try {
      const count = 64;
      const source = {
        positions: new Float32Array(
          Array.from({length: count}, (_, i) => [
            Math.cos(i * 2.4) * 2.5 * Math.sqrt(i / count),
            Math.sin(i * 2.4) * 2.5 * Math.sqrt(i / count),
            (i % 4) * 0.4
          ]).flat()
        ),
        scales: new Float32Array(Array.from({length: count}, () => [0.9, 0.9, 0.4]).flat()),
        rotations: new Float32Array(Array.from({length: count}, () => [1, 0, 0, 0]).flat()),
        colors: new Uint8Array(Array.from({length: count}, () => [40, 140, 40, 255]).flat()),
        opacities: new Float32Array(count).fill(0.8)
      };
      const owner = {position: [0, 0, 0]};
      const splats = (shadowEnabled: boolean) =>
        new SplatLayer({
          id: `splats-${transparency}`,
          data: [owner],
          source,
          transparency,
          coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
          coordinateOrigin: [0, 0, 0],
          getTranslation: [0, 0, 6],
          pickable: true,
          shadowEnabled
        });
      const region = {x0: 150, y0: 112, x1: 190, y1: 144};
      const shadowed = await scene.render([ground(), splats(true)]);
      const lit = await scene.render([ground(), splats(false)]);
      expect(scene.errors).toEqual([]);
      expect(brightness(shadowed, region)).toBeLessThan(brightness(lit, region) * 0.7);
      await scene.render([ground(), splats(true)]);
      expect(scene.deck.pickObject({x: 128, y: 128})?.object).toBe(owner);
    } finally {
      scene.cleanup();
    }
  }, 60000);
});

it('casts tree shadows onto deck layers in an interleaved MapLibre map', async () => {
  const container = document.createElement('div');
  container.style.cssText = `width:${SIZE}px;height:${SIZE}px;position:relative`;
  document.body.append(container);
  const maplibre = (globalThis as any).maplibregl;
  const map = new maplibre.Map({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [{id: 'background', type: 'background', paint: {'background-color': '#204020'}}]
    },
    center: [VIEW_STATE.longitude, VIEW_STATE.latitude],
    zoom: VIEW_STATE.zoom,
    pixelRatio: 1,
    fadeDuration: 0
  });
  const errors: string[] = [];
  let pixels = new Uint8Array(),
    frames = 0;
  const overlay = new MapboxOverlay({
    interleaved: true,
    effects: [lighting(true)],
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    }
  });
  const render = async (shadowEnabled: boolean) => {
    // deck.gl draws shadow maps per interleaved layer group; the ground shares the trees' group.
    overlay.setProps({
      layers: [
        ground(COORDINATE_SYSTEM.LNGLAT),
        trees({coordinateSystem: COORDINATE_SYSTEM.LNGLAT, shadowEnabled})
      ]
    });
    const before = frames;
    await expect
      .poll(
        () => {
          map.triggerRepaint();
          return frames;
        },
        {timeout: 30000}
      )
      .toBeGreaterThan(before + 5);
    return pixels;
  };
  try {
    map.addControl(overlay);
    await new Promise(resolve => map.once('load', resolve));
    const shadowed = await render(true);
    const lit = await render(false);
    expect(errors).toEqual([]);
    expect(brightness(lit, SHADOW)).toBeGreaterThan(100);
    expect(brightness(shadowed, SHADOW)).toBeLessThan(brightness(lit, SHADOW) * 0.6);
  } finally {
    map.remove();
    container.remove();
  }
}, 60000);

it('renders shadow-lit trees without errors on WebGPU, which casts no deck.gl shadows', async ({
  skip
}) => {
  await requireWebGPUAdapter(skip);
  const parent = document.createElement('div');
  parent.style.cssText = 'width:128px;height:128px';
  document.body.append(parent);
  type NativeGpuError = {error?: {message?: string}};
  type NativeGpuDevice = {
    addEventListener: (type: string, listener: (event: NativeGpuError) => void) => void;
    removeEventListener: (type: string, listener: (event: NativeGpuError) => void) => void;
    queue: {onSubmittedWorkDone: () => Promise<void>};
  };
  const errors: string[] = [];
  const capture = (event: NativeGpuError) =>
    errors.push(event.error?.message ?? 'Unknown WebGPU validation error.');
  let device: Device | undefined;
  let deck: Deck | undefined;
  let native: NativeGpuDevice | undefined;
  try {
    device = await luma.createDevice({
      type: 'webgpu',
      adapters: [webgpuAdapter],
      createCanvasContext: {container: parent, width: 128, height: 128, useDevicePixels: false}
    });
    native = (device as Device & {handle?: NativeGpuDevice}).handle;
    native?.addEventListener('uncapturederror', capture);
    let frames = 0;
    deck = new Deck({
      device,
      parent,
      width: 128,
      height: 128,
      useDevicePixels: false,
      _animate: true,
      views: new MapView(),
      initialViewState: {...VIEW_STATE, zoom: 18},
      effects: [lighting(true)],
      layers: [
        trees({
          windStrength: 0.1,
          extensions: [new SelectionPulseExtension()],
          getSelected: true,
          pulseTime: 375
        })
      ],
      onError: error => errors.push(error.message),
      onAfterRender: () => frames++
    });
    await expect.poll(() => frames, {timeout: 30000}).toBeGreaterThan(8);
    await native?.queue.onSubmittedWorkDone();
    expect(device.type).toBe('webgpu');
    expect(errors).toEqual([]);
  } finally {
    native?.removeEventListener('uncapturederror', capture);
    deck?.finalize();
    device?.destroy();
    parent.remove();
  }
}, 60000);
