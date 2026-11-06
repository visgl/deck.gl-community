// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  AmbientLight,
  COORDINATE_SYSTEM,
  CompositeLayer,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  type Layer
} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {SplatLayer, TreeLayer, WindEffect, type SplatSource} from '../../src';
import {getSplatWindOffset} from '../../src/splat-layer/splat-deformation';
import {getWindUniforms} from '../../src/wind-effect/wind-module';

const SIZE = 256;
const METER_OFFSETS = {
  coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};
const SOURCE: SplatSource = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([0.3, 0.3, 0.3]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([100, 200, 40, 255]),
  opacities: new Float32Array([0.9])
};
// sin(1.6 t + phase) = 1: the bend is at its peak along the wind axis.
const PHASE = 0.7;
const PEAK_TIME = (Math.PI / 2 - PHASE) / 1.6;

function collectLeaves(layer: Layer): Layer[] {
  return layer instanceof CompositeLayer ? layer.getSubLayers().flatMap(collectLeaves) : [layer];
}

function createDeck(props: ConstructorParameters<typeof Deck>[0]) {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.append(parent);
  const errors: string[] = [];
  const view = {frames: 0, pixels: new Uint8Array(), errors};
  const deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView(),
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      view.pixels = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, view.pixels);
      view.frames++;
    },
    ...props
  });
  const settle = async (frames = 4) => {
    const before = view.frames;
    await expect.poll(() => view.frames, {timeout: 30000}).toBeGreaterThan(before + frames);
  };
  const cleanup = () => {
    deck.finalize();
    parent.remove();
  };
  return {deck, view, settle, cleanup};
}

/** Alpha-weighted centroid in GL pixels, origin bottom-left (north is up). */
function getCentroid(pixels: Uint8Array): [number, number] {
  let x = 0,
    y = 0,
    total = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const alpha = pixels[i * 4 + 3];
    if (alpha < 30) continue;
    x += (i % SIZE) * alpha;
    y += Math.floor(i / SIZE) * alpha;
    total += alpha;
  }
  return [x / total, y / total];
}

function countChanged(a: Uint8Array, b: Uint8Array) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4)
    if (Math.max(...[0, 1, 2, 3].map(channel => Math.abs(a[i + channel] - b[i + channel]))) > 24)
      changed++;
  return changed;
}

it('bends a SplatLayer with no wind props toward the WindEffect direction, and picks it there', async () => {
  const object = {position: [0, 0, 0]};
  const splats = new SplatLayer({
    ...METER_OFFSETS,
    id: 'gusty',
    data: [object],
    getSource: SOURCE,
    getTranslation: [0, 0, 5],
    getDeformation: [10, PHASE, 1],
    pickable: true,
    material: {unlit: true}
  });
  const wind = (direction: number, strength = 0.2) =>
    new WindEffect({strength, direction, time: PEAK_TIME});
  const {deck, view, settle, cleanup} = createDeck({
    initialViewState: {longitude: 0, latitude: 0, zoom: 21, pitch: 0},
    effects: [wind(90, 0)],
    layers: [splats]
  });
  try {
    await settle(8);
    const [stillX, stillY] = getCentroid(view.pixels);
    const shifts: Record<number, [number, number]> = {};
    for (const direction of [90, 0, 270]) {
      deck.setProps({effects: [wind(direction)]});
      await settle();
      const [x, y] = getCentroid(view.pixels);
      shifts[direction] = [x - stillX, y - stillY];
    }
    // About a 0.8 m lean, at its sway peak, at about 0.075 m per pixel.
    expect(shifts[90][0]).toBeGreaterThan(5);
    expect(Math.abs(shifts[90][1])).toBeLessThan(1.5);
    expect(shifts[0][1]).toBeGreaterThan(5);
    expect(Math.abs(shifts[0][0])).toBeLessThan(1.5);
    expect(shifts[270][0]).toBeLessThan(-5);
    // Picking draws with the effect too.
    const [x, y] = getCentroid(view.pixels);
    expect(deck.pickObject({x: Math.round(x), y: SIZE - Math.round(y)})?.object).toBe(object);
    // The bounds cover the effect's peak: a new strength rebuilds them once.
    const owners = (deck.props.layers as Layer[])[0].state.owners;
    deck.setProps({effects: [wind(270, 0.1)]});
    await settle();
    expect((deck.props.layers as Layer[])[0].state.owners).not.toBe(owners);
    expect(view.errors).toEqual([]);
  } finally {
    cleanup();
  }
}, 40000);

it('flutters a leaf Gaussian exactly where the CPU twin of the shader puts it', async () => {
  // A leaf high on the crown's edge: template centre `seed`, placed at [3, 1, 9] of a 12 m owner
  // that stands at [-4, -1], so the leaf stays in view.
  const owner = [-4, -1, 0];
  const seed = new Float32Array([0.8, 0.3, 0.4]);
  const translation = [2.2, 0.7, 8.6];
  const local = [0, 1, 2].map(i => Math.fround(seed[i]) + translation[i]);
  const leaf: SplatSource = {...SOURCE, positions: seed, scales: new Float32Array([0.1, 0.1, 0.1])};
  const layer = new SplatLayer({
    ...METER_OFFSETS,
    id: 'leaf',
    data: [{position: owner}],
    getSource: leaf,
    getTranslation: translation as [number, number, number],
    getDeformation: [12, PHASE, 1],
    material: {unlit: true}
  });
  const wind = (time: number, turbulence: number) =>
    new WindEffect({strength: 0.08, direction: 120, turbulence, time});
  const {deck, view, settle, cleanup} = createDeck({
    initialViewState: {longitude: 0, latitude: 0, zoom: 20.5, pitch: 0},
    effects: [wind(0, 1)],
    layers: [layer]
  });
  const phase = [Math.sin(PHASE), Math.cos(PHASE), Math.sin(PHASE * 1.7), Math.cos(PHASE * 1.7)];
  const expected = (time: number, turbulence: number): [number, number] => {
    const uniforms = getWindUniforms({strength: 0.08, direction: 120, turbulence, time});
    const offset = getSplatWindOffset([], local, Array.from(seed), 12, 0.08, phase, uniforms);
    const viewport = deck.getViewports()[0] as any;
    const lngLat = viewport.addMetersToLngLat(
      [0, 0, 0],
      local.map((v, i) => owner[i] + v + offset[i])
    );
    const [x, y] = viewport.project(lngLat);
    // `getCentroid` counts pixels from their corner; projected coordinates from their centre.
    return [x - 0.5, SIZE - y - 0.5];
  };
  try {
    for (const time of [0.4, 1.9, 3.3]) {
      const shifts: number[][] = [];
      for (const turbulence of [1, 0]) {
        deck.setProps({effects: [wind(time, turbulence)]});
        await settle(6);
        const actual = getCentroid(view.pixels);
        const target = expected(time, turbulence);
        expect(Math.hypot(actual[0] - target[0], actual[1] - target[1])).toBeLessThan(0.75);
        shifts.push(actual);
      }
      // The flutter itself is several pixels, so the comparison is not trivially met.
      expect(Math.hypot(shifts[0][0] - shifts[1][0], shifts[0][1] - shifts[1][1])).toBeGreaterThan(
        3
      );
    }
    expect(view.errors).toEqual([]);
  } finally {
    cleanup();
  }
}, 40000);

it('stills every tree part when the WindEffect calms or is removed', async () => {
  const lighting = new LightingEffect({
    ambient: new AmbientLight({intensity: 1}),
    directional: new DirectionalLight({direction: [-1, -1, -1], intensity: 0.5})
  });
  const trees = new TreeLayer({
    ...METER_OFFSETS,
    id: 'orchard',
    data: [{position: [0, 0, 0], species: 'oak'}],
    getHeight: 12,
    getCanopyRadius: 4,
    getCrop: {kind: 'fruit', color: [230, 120, 40], count: 6, radius: 0.3},
    windTime: 1,
    maxCanopySplats: 0,
    maxCanopyPixels: SIZE * SIZE
  });
  const {deck, view, settle, cleanup} = createDeck({
    initialViewState: {longitude: 0, latitude: 0, zoom: 19.5, pitch: 60, bearing: 30},
    effects: [lighting],
    layers: [trees]
  });
  const capture = async () => {
    await settle(6);
    await expect
      .poll(() => (deck.props.layers as TreeLayer[])[0].isLoaded, {timeout: 30000})
      .toBe(true);
    await settle();
    return view.pixels.slice();
  };
  const strengths = () =>
    collectLeaves((deck.props.layers as Layer[])[0]).map(
      layer => layer.props.windStrength ?? layer.props.deformationStrength
    );
  try {
    const still = await capture();
    expect(strengths().every(strength => strength === 0)).toBe(true);
    deck.setProps({effects: [lighting, new WindEffect({strength: 0.15, gust: 0.5})]});
    const windy = await capture();
    expect(strengths().every(strength => strength === 0.15)).toBe(true);
    expect(countChanged(still, windy)).toBeGreaterThan(200);
    // A calm effect updates the trees without new layer props.
    deck.setProps({effects: [lighting, new WindEffect({strength: 0})]});
    expect(countChanged(still, await capture())).toBeLessThan(40);
    deck.setProps({effects: [lighting, new WindEffect({strength: 0.15, gust: 0.5})]});
    expect(countChanged(still, await capture())).toBeGreaterThan(200);
    deck.setProps({effects: [lighting]});
    expect(countChanged(still, await capture())).toBeLessThan(40);
    expect(strengths().every(strength => strength === 0)).toBe(true);
    expect(view.errors).toEqual([]);
  } finally {
    cleanup();
  }
}, 90000);

it('draws every tree part with the layer wind overrides, not the effect values', async () => {
  // The effect pushes its own wind props before each draw; layers resolve their overrides in draw().
  const windStrength = 0.03;
  const windTime = 3;
  const shadows = new LightingEffect({
    ambient: new AmbientLight({intensity: 1}),
    sun: new DirectionalLight({direction: [-1, -1, -1], intensity: 1, _shadow: true})
  });
  const trees = new TreeLayer({
    ...METER_OFFSETS,
    id: 'overrides',
    data: [{position: [0, 0, 0], species: 'oak'}],
    getHeight: 12,
    getCanopyRadius: 4,
    getCrop: {kind: 'fruit', color: [230, 120, 40], count: 6, radius: 0.3},
    windStrength,
    windTime,
    maxCanopySplats: 0,
    maxCanopyPixels: SIZE * SIZE
  });
  const {deck, view, settle, cleanup} = createDeck({
    initialViewState: {longitude: 0, latitude: 0, zoom: 19.5, pitch: 60, bearing: 30},
    effects: [shadows, new WindEffect({strength: 0.1, gust: 0, direction: 120})],
    layers: [trees]
  });
  try {
    await settle(6);
    await expect
      .poll(() => (deck.props.layers as TreeLayer[])[0].isLoaded, {timeout: 30000})
      .toBe(true);
    await settle();
    const expected = getWindUniforms({strength: windStrength, direction: 120, time: windTime});
    // Record the wind each model holds at the moment it draws, in every pass (shadow included).
    const drawn: {name: string; wind: {strength: number; wave: number[]}}[] = [];
    for (const layer of collectLeaves((deck.props.layers as Layer[])[0]))
      for (const model of layer.getModels()) {
        if (!model.shaderInputs.getModules().some(module => module.name === 'wind')) continue;
        const draw = model.draw.bind(model);
        model.draw = (...args: Parameters<typeof model.draw>) => {
          const wind = model.shaderInputs.getUniformValues().wind as {
            strength: number;
            wave: number[];
          };
          drawn.push({name: (layer.constructor as typeof Layer).layerName, wind: {...wind}});
          return draw(...args);
        };
      }
    await settle();
    expect(new Set(drawn.map(({name}) => name))).toEqual(
      new Set(['TreeMeshLayer', 'SplatPrimitiveLayer'])
    );
    for (const {name, wind} of drawn) {
      expect(wind.strength, name).toBeCloseTo(expected.strength, 6);
      wind.wave.forEach((value, i) => expect(value, name).toBeCloseTo(expected.wave[i], 5));
    }
    expect(view.errors).toEqual([]);
  } finally {
    cleanup();
  }
}, 60000);
