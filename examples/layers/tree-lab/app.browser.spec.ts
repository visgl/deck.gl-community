// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import type {Deck, MapView} from '@deck.gl/core';
import type {TreeLayer, TreeSpec, TreeType} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

it('shows every species with native crops, then renders a label-free 10,000-tree grove', async () => {
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
  const getTree = (layer: TreeLayer<TreeSpec>, index: number) =>
    (layer.props.getTree as (tree: TreeSpec, info: {index: number}) => TreeSpec)(
      (layer.props.data as TreeSpec[])[index],
      {index}
    );
  try {
    await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThan(0);
    expect(parent.querySelector<HTMLSelectElement>('[name="scene"]')?.value).toBe('forest');
    expect(parent.querySelector('[name="crop-kind"]')).toBeNull();
    expect(parent.querySelector('[name="dropped-crops"]')).toBeNull();
    expect(parent.querySelector('[name="crop-size"]')).not.toBeNull();
    expect(parent.querySelector('[name="crop-load"]')).not.toBeNull();
    expect(
      [...parent.querySelectorAll<HTMLSelectElement>('[name="scene"] option')].map(
        option => option.value
      )
    ).toEqual(['forest', 'grove']);

    const forest = trees()!;
    const forestData = forest.props.data as TreeSpec[];
    const species: TreeType[] = [
      'citrus',
      'banyan',
      'pine',
      'oak',
      'palm',
      'birch',
      'cherry',
      'mangrove'
    ];
    expect(forestData.map(tree => tree.species)).toEqual(species);
    expect(
      deck.props.layers.map(layer =>
        layer && !Array.isArray(layer) && typeof layer === 'object' && 'id' in layer
          ? layer.id
          : null
      )
    ).toEqual(['ground', 'labels', 'trees']);
    expect(getTree(forest, 0).crop).toMatchObject({kind: 'fruit', radius: 0.09});
    expect(getTree(forest, 1).crop).toMatchObject({kind: 'fruit', radius: 0.035});
    expect(getTree(forest, 2).crop).toMatchObject({kind: 'cone', radius: 0.075});
    expect(getTree(forest, 3).crop).toMatchObject({kind: 'acorn', radius: 0.03});
    expect(getTree(forest, 4).crop).toMatchObject({kind: 'fruit', radius: 0.055});
    expect(getTree(forest, 5).crop).toBeNull();
    expect(getTree(forest, 6).crop).toBeNull();
    expect(getTree(forest, 7).crop).toMatchObject({kind: 'propagule', radius: 0.085});

    change('season', 'spring');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(1);
    const springForest = trees()!;
    expect(getTree(springForest, 5).crop).toMatchObject({kind: 'catkin'});
    expect(getTree(springForest, 6).crop).toMatchObject({kind: 'flower'});
    change('crop-size', '1.2');
    change('crop-load', '0');
    expect(getTree(trees()!, 5).crop).toBeNull();
    change('crop-load', '100');
    change('scene', 'grove');
    await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThan(2);

    const grove = trees()!;
    const groveData = grove.props.data as TreeSpec[];
    expect(groveData).toHaveLength(10000);
    expect(groveData.every(tree => tree.species === 'citrus')).toBe(true);
    expect(groveData[0].position?.[0]).toBeCloseTo(0, 0);
    expect(groveData[0].position?.[1]).toBeCloseTo(0, 0);
    const firstRowY = groveData.slice(1, 4).map(tree => tree.position![1]);
    expect(Math.max(...firstRowY) - Math.min(...firstRowY)).toBeLessThan(1);
    expect(getTree(grove, 0).crop).toBeNull();
    expect(
      deck.props.layers.map(layer =>
        layer && !Array.isArray(layer) && typeof layer === 'object' && 'id' in layer
          ? layer.id
          : null
      )
    ).toEqual(['ground', 'trees']);
    expect(parent.querySelector<HTMLLabelElement>('.trees-tree-count')?.hidden).toBe(false);
    expect(parent.querySelector<HTMLLabelElement>('.trees-crop-control')?.hidden).toBe(true);
    expect(parent.querySelector<HTMLLabelElement>('.trees-toggle')?.hidden).toBe(true);
    expect(parent.querySelector<HTMLOutputElement>('[name="tree-count-value"]')?.textContent).toBe(
      '10,000'
    );

    const originalPrefix = groveData.slice(0, 100).map(tree => tree.position);
    const originalZoom = deck.getViewports()[0].zoom;
    change('tree-count', '100');
    expect((trees()!.props.data as TreeSpec[]).map(tree => tree.position)).toEqual(originalPrefix);
    expect(deck.getViewports()[0].zoom).toBeCloseTo(originalZoom);
    change('tree-count', '10000');
    expect(trees()!.props.data as TreeSpec[]).toHaveLength(10000);
    const groveGetTree = getTree(trees()!, 0);
    const groveTreeNext = getTree(trees()!, 1);
    expect(groveGetTree.height).not.toBeCloseTo(groveTreeNext.height);
    expect(groveGetTree.characteristics).toEqual(groveTreeNext.characteristics);
    expect(errors).toEqual([]);
  } finally {
    cleanup();
    expect(parent.querySelector('canvas')).toBeNull();
    parent.remove();
  }
}, 120000);

it('restores the selected scene and count when the rendering device remounts', async () => {
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
  const trees = () =>
    deck.props.layers.find(layer => layer && !Array.isArray(layer) && layer.id === 'trees') as
      | TreeLayer<TreeSpec>
      | undefined;
  try {
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(0);
    const change = (name: string, value: string) => {
      const element = parent.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[name="${name}"]`
      )!;
      element.value = value;
      element.dispatchEvent(new Event('input', {bubbles: true}));
    };
    change('scene', 'grove');
    change('species', 'pine');
    change('tree-count', '120');
    change('season', 'winter');
    change('grove-variation', '0.9');
    const groveViewState = deck.props.initialViewState!;
    cleanup();
    frames = 0;

    cleanup = mountTreeLabExample(parent, {
      initialViewState: groveViewState,
      onDeckInitialized
    });

    expect(parent.querySelector<HTMLSelectElement>('[name="scene"]')?.value).toBe('grove');
    expect(parent.querySelector<HTMLSelectElement>('[name="species"]')?.value).toBe('pine');
    expect(parent.querySelector<HTMLInputElement>('[name="tree-count"]')?.value).toBe('120');
    expect(parent.querySelector<HTMLSelectElement>('[name="season"]')?.value).toBe('winter');
    expect(parent.querySelector<HTMLInputElement>('[name="grove-variation"]')?.value).toBe('0.9');
    expect(trees()?.props.data).toHaveLength(120);
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(0);
    expect(deck.getViewports()[0].zoom).toBeCloseTo(groveViewState.zoom);
  } finally {
    cleanup();
    expect(parent.querySelector('canvas')).toBeNull();
    parent.remove();
  }
});

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
