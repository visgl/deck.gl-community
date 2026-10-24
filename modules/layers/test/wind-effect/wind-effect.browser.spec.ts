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
    // A 0.69 m bend at about 0.075 m per pixel.
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
