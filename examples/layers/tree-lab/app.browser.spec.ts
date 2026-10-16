// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import type {Deck, MapView} from '@deck.gl/core';
import type {TreeLayer, TreeSpec} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

it('shows an editable specimen, a varied row grove, and a sparse mixed-species forest', async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  let deck!: Deck<MapView>;
  let frames = 0;
  const errors: string[] = [];
  const cleanup = mountTreeLabExample(parent, {
    onDeckInitialized(instance) {
      deck = instance;
      deck.setProps({
        onError: error => errors.push(error.message),
        onAfterRender() {
          frames++;
        }
      });
    }
  });
  const change = (name: string, value: string) => {
    const element = parent.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
    element.value = value;
    element.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const trees = () =>
    deck.props.layers.find(layer => layer && !Array.isArray(layer) && layer.id === 'trees') as
      | TreeLayer<TreeSpec>
      | undefined;
  try {
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(0);
    expect(deck.getViewports()[0].zoom).toBeGreaterThan(21);
    const initialZoom = deck.getViewports()[0].zoom;
    const initial = trees()!;
    const initialData = initial.props.data as TreeSpec[];
    expect(initialData).toHaveLength(1);
    expect(initialData[0]).toMatchObject({species: 'citrus', position: [0, 0, 0]});
    expect((initial.props.getTree as (tree: TreeSpec) => TreeSpec)(initialData[0])).toMatchObject({
      species: 'citrus',
      height: 4.8,
      season: 'autumn',
      wind: false,
      crop: {kind: 'fruit', count: 18, droppedCount: 0, radius: 0.18},
      characteristics: {crownSpread: 1, crownDepth: 1, branchDensity: 1, leafSize: 1}
    });
    expect(parent.querySelector<HTMLSelectElement>('[name="scene"]')?.value).toBe('specimen');
    expect(parent.querySelector<HTMLSelectElement>('[name="crop-kind"]')?.value).toBe('seasonal');
    expect(parent.querySelector<HTMLInputElement>('[name="grove-variation"]')?.value).toBe('0.7');
    expect(parent.querySelector('[name="crop-count"]')).not.toBeNull();
    expect(parent.querySelector('[name="dropped-crops"]')).not.toBeNull();
    expect(parent.querySelector('[name="crop-radius"]')).not.toBeNull();
    change('crop-kind', 'lemon');
    change('crop-count', '24');
    change('dropped-crops', '4');
    change('crop-radius', '0.14');
    change('season', 'winter');
    change('spread', '1.3');
    change('depth', '0.8');
    change('branch-density', '1.3');
    change('leaf-size', '1.2');
    change('height', '1.3');
    const wind = parent.querySelector<HTMLInputElement>('[name="wind"]')!;
    wind.checked = true;
    wind.dispatchEvent(new Event('input', {bubbles: true}));
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(1);
    expect(deck.getViewports()[0].zoom).toBeLessThan(initialZoom);
    const winter = trees()!;
    expect(winter.props.data).toBe(initialData);
    const updatedCitrus = (winter.props.getTree as (tree: TreeSpec) => TreeSpec)(initialData[0]);
    expect(updatedCitrus.height).toBeCloseTo(6.24);
    expect(updatedCitrus).toMatchObject({
      season: 'winter',
      wind: true,
      crop: {kind: 'lemon', count: 24, droppedCount: 4, radius: 0.14},
      characteristics: {crownSpread: 1.3, crownDepth: 0.8, branchDensity: 1.3, leafSize: 1.2}
    });
    expect(parent.querySelector<HTMLOutputElement>('[name="crop-radius-value"]')?.textContent).toBe(
      '0.14 m'
    );
    expect(parent.querySelector<HTMLOutputElement>('[name="height-value"]')?.textContent).toBe(
      '1.3×'
    );

    change('crop-kind', 'seasonal');
    change('crop-count', '18');
    change('dropped-crops', '0');
    change('crop-radius', '0.18');
    change('species', 'oak');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(2);
    expect(deck.getViewports()[0].zoom).toBeLessThan(initialZoom);
    const oak = trees()!;
    expect(oak.props.data).not.toBe(initialData);
    expect(oak.props.data).toHaveLength(1);
    expect(
      (oak.props.getTree as (tree: TreeSpec) => TreeSpec)((oak.props.data as TreeSpec[])[0])
    ).toMatchObject({
      species: 'oak',
      season: 'winter',
      height: 18.2,
      wind: true,
      characteristics: {crownSpread: 1.3, crownDepth: 0.8, branchDensity: 1.3, leafSize: 1.2}
    });
    change('scene', 'grove');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(3);
    const grove = trees()!;
    const groveData = grove.props.data as TreeSpec[];
    expect(groveData).toHaveLength(6);
    expect(groveData.map(tree => tree.species)).toEqual(Array(6).fill('oak'));
    expect(groveData.map(tree => tree.position)).toEqual([
      [-6.5, -9.5, 0],
      [6.5, -9.5, 0],
      [-6.5, 0, 0],
      [6.5, 0, 0],
      [-6.5, 9.5, 0],
      [6.5, 9.5, 0]
    ]);
    expect(parent.querySelector<HTMLLabelElement>('.trees-species')?.hidden).toBe(false);
    expect(parent.querySelector<HTMLLabelElement>('.trees-grove-variation')?.hidden).toBe(false);
    const groveGetTree = grove.props.getTree as (tree: TreeSpec) => TreeSpec;
    const groveTree = groveGetTree(groveData[1]);
    expect(groveTree.height).not.toBeCloseTo(18.2);
    expect(groveTree.height).not.toBeCloseTo(groveGetTree(groveData[0]).height);
    expect(groveTree).toMatchObject({
      species: 'oak',
      season: 'winter',
      wind: true
    });
    change('species', 'citrus');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(3);
    const citrusGrove = trees()!;
    const citrusData = citrusGrove.props.data as TreeSpec[];
    const citrusGetTree = citrusGrove.props.getTree as (tree: TreeSpec) => TreeSpec;
    const firstCitrus = citrusGetTree(citrusData[0]);
    const secondCitrus = citrusGetTree(citrusData[1]);
    expect(citrusData.map(tree => tree.species)).toEqual(Array(6).fill('citrus'));
    const cropRadii = citrusData.map(tree => citrusGetTree(tree).crop?.radius ?? 0);
    expect(new Set(cropRadii).size).toBe(6);
    expect(Math.max(...cropRadii) - Math.min(...cropRadii)).toBeGreaterThan(0.03);
    expect(firstCitrus.characteristics?.crownSpread).not.toBeCloseTo(
      secondCitrus.characteristics?.crownSpread ?? 0
    );
    change('season', 'autumn');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(4);
    const autumnGrove = trees()!;
    const autumnData = autumnGrove.props.data as TreeSpec[];
    const citrusCrop = (autumnGrove.props.getTree as (tree: TreeSpec) => TreeSpec)(
      autumnData[0]
    ).crop;
    expect(citrusCrop).toMatchObject({kind: 'fruit', count: 18});
    change('species', 'cherry');
    change('season', 'spring');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(5);
    const springGrove = trees()!;
    const springData = springGrove.props.data as TreeSpec[];
    const cherryBlossom = (springGrove.props.getTree as (tree: TreeSpec) => TreeSpec)(
      springData[0]
    ).crop;
    expect(cherryBlossom).toMatchObject({kind: 'flower', count: 18});
    change('scene', 'forest');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(6);
    const forest = trees()!;
    const forestData = forest.props.data as TreeSpec[];
    expect(forestData).toHaveLength(4);
    expect(forestData.map(tree => tree.species)).toEqual(['citrus', 'pine', 'oak', 'cherry']);
    expect(parent.querySelector<HTMLLabelElement>('.trees-species')?.hidden).toBe(true);
    expect(parent.querySelector<HTMLLabelElement>('.trees-grove-variation')?.hidden).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    cleanup();
    expect(parent.querySelector('canvas')).toBeNull();
    parent.remove();
  }
}, 60000);

it('restores the selected scene with its camera when the rendering device remounts', async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  let deck!: Deck<MapView>;
  let frames = 0;
  const onDeckInitialized = (instance: Deck<MapView>) => {
    deck = instance;
    instance.setProps({onAfterRender: () => frames++});
  };
  let cleanup = mountTreeLabExample(parent, {onDeckInitialized});
  try {
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(0);
    const scene = parent.querySelector<HTMLSelectElement>('[name="scene"]')!;
    scene.value = 'grove';
    scene.dispatchEvent(new Event('input', {bubbles: true}));
    const season = parent.querySelector<HTMLSelectElement>('[name="season"]')!;
    season.value = 'winter';
    season.dispatchEvent(new Event('input', {bubbles: true}));
    const cropKind = parent.querySelector<HTMLSelectElement>('[name="crop-kind"]')!;
    cropKind.value = 'lemon';
    cropKind.dispatchEvent(new Event('input', {bubbles: true}));
    const variation = parent.querySelector<HTMLInputElement>('[name="grove-variation"]')!;
    variation.value = '0.9';
    variation.dispatchEvent(new Event('input', {bubbles: true}));
    const groveViewState = deck.props.initialViewState!;
    cleanup();
    frames = 0;

    cleanup = mountTreeLabExample(parent, {
      initialViewState: groveViewState,
      onDeckInitialized
    });

    expect(parent.querySelector<HTMLSelectElement>('[name="scene"]')?.value).toBe('grove');
    expect(parent.querySelector<HTMLSelectElement>('[name="season"]')?.value).toBe('winter');
    expect(parent.querySelector<HTMLSelectElement>('[name="crop-kind"]')?.value).toBe('lemon');
    expect(parent.querySelector<HTMLInputElement>('[name="grove-variation"]')?.value).toBe('0.9');
    const trees = deck.props.layers.find(
      layer =>
        Boolean(layer) &&
        !Array.isArray(layer) &&
        typeof layer === 'object' &&
        'id' in layer &&
        layer.id === 'trees'
    ) as TreeLayer<TreeSpec> | undefined;
    expect(trees?.props.data).toHaveLength(6);
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(0);
    expect(deck.getViewports()[0].zoom).toBeCloseTo(groveViewState.zoom);
  } finally {
    cleanup();
    expect(parent.querySelector('canvas')).toBeNull();
    parent.remove();
  }
}, 60000);

it('keeps the tree reachable when its host is shorter than the stage', () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '320px', height: '180px'});
  document.body.append(parent);
  const cleanup = mountTreeLabExample(parent);
  const demo = parent.querySelector<HTMLDivElement>('.trees-demo')!;
  const stage = parent.querySelector<HTMLDivElement>('.trees-stage')!;
  try {
    expect(getComputedStyle(demo).overflowY).toBe('auto');
    expect(demo.scrollHeight).toBeGreaterThan(demo.clientHeight);
    expect(stage.getBoundingClientRect().bottom).toBeGreaterThan(
      demo.getBoundingClientRect().bottom
    );
    demo.scrollTop = demo.scrollHeight;
    expect(stage.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      demo.getBoundingClientRect().bottom
    );
  } finally {
    cleanup();
    parent.remove();
  }
});
