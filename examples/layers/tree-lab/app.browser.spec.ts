// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import type {Deck, MapView, WebMercatorViewport} from '@deck.gl/core';
import type {TreeLayer, TreeSpec, TreeType} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

it('shows every species with native crops, then renders a label-free 10,000-tree grove', async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '1164px', height: '680px'});
  document.body.append(parent);
  let deck!: Deck<MapView>;
  let frames = 0;
  let inspectCanopyPixels = false;
  let greenPixels = 0;
  const errors: string[] = [];
  const cleanup = mountTreeLabExample(parent, {
    onDeckInitialized(instance) {
      deck = instance;
      deck.setProps({
        onError: error => errors.push(error.message),
        onAfterRender({gl}) {
          frames++;
          if (inspectCanopyPixels) {
            const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(
              0,
              0,
              gl.drawingBufferWidth,
              gl.drawingBufferHeight,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels
            );
            greenPixels = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i + 1] > pixels[i] * 1.35 && pixels[i + 1] > pixels[i + 2] * 1.15)
                greenPixels++;
          }
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
  const viewport = () => deck.getViewports()[0] as WebMercatorViewport;
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
    expect(Math.max(...firstRowY) - Math.min(...firstRowY)).toBeLessThan(1.25);
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
    const fullGroveZoom = viewport().zoom;
    const fullGrovePitch = viewport().pitch;
    change('tree-count', '100');
    expect((trees()!.props.data as TreeSpec[]).map(tree => tree.position)).toEqual(originalPrefix);
    await expect.poll(() => viewport().zoom, {timeout: 15000}).toBeGreaterThan(fullGroveZoom + 0.5);
    expect(viewport().pitch).toBeGreaterThan(fullGrovePitch);
    change('tree-count', '10000');
    expect(trees()!.props.data as TreeSpec[]).toHaveLength(10000);
    await expect.poll(() => viewport().zoom, {timeout: 15000}).toBeCloseTo(fullGroveZoom, 1);
    const groveGetTree = getTree(trees()!, 0);
    const groveTreeNext = getTree(trees()!, 1);
    expect(groveGetTree.height).not.toBeCloseTo(groveTreeNext.height);
    expect(groveGetTree.characteristics).toEqual(groveTreeNext.characteristics);
    inspectCanopyPixels = true;
    change('tree-count', '1');
    await expect.poll(() => viewport().latitude, {timeout: 15000}).toBeGreaterThan(0);
    await expect.poll(() => viewport().pitch, {timeout: 15000}).toBeCloseTo(58);
    await expect.poll(() => viewport().zoom, {timeout: 15000}).toBeGreaterThan(fullGroveZoom + 2);
    change('species', 'palm');
    const closeCanopy = () =>
      (deck as any).layerManager
        .getLayers()
        .find(layer => layer.constructor.layerName === 'SplatLayer');
    await expect
      .poll(() => closeCanopy()?.splatStats.renderedSplats ?? 0, {timeout: 15000})
      .toBeGreaterThan(0);
    expect(closeCanopy()?.props.getSource.source.opacities.length).toBeGreaterThan(900);
    expect(closeCanopy()?.splatStats.visibleInstances).toBe(1);
    expect(closeCanopy()?.splatStats.renderedSplats).toBeGreaterThan(0);
    await expect.poll(() => greenPixels, {timeout: 15000}).toBeGreaterThan(100);
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

it('keeps the full canvas visible below the website control panel', () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '320px', height: '180px'});
  document.body.append(parent);
  const cleanup = mountTreeLabExample(parent);
  const demo = parent.querySelector<HTMLDivElement>('.trees-demo')!;
  const stage = parent.querySelector<HTMLDivElement>('.trees-stage')!;
  const panel = parent.querySelector<HTMLElement>('.trees-panel')!;
  const panelContent = parent.querySelector<HTMLDivElement>('.trees-panel-content')!;
  const panelToggle = parent.querySelector<HTMLButtonElement>('.trees-panel-toggle')!;
  try {
    expect(getComputedStyle(demo).overflow).toBe('hidden');
    expect(stage.getBoundingClientRect().top).toBe(demo.getBoundingClientRect().top);
    expect(stage.getBoundingClientRect().bottom).toBe(demo.getBoundingClientRect().bottom);
    expect(panel.getAttribute('aria-label')).toBe('TreeLayer controls');
    expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(
      demo.getBoundingClientRect().right
    );
    panelToggle.click();
    expect(panelToggle.getAttribute('aria-expanded')).toBe('false');
    expect(panelContent.hidden).toBe(true);
    panelToggle.click();
    expect(panelToggle.getAttribute('aria-expanded')).toBe('true');
    expect(panelContent.hidden).toBe(false);
  } finally {
    cleanup();
    parent.remove();
  }
});
