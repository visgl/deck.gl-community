// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import type {Deck, MapView} from '@deck.gl/core';
import type {TreeLayer, TreeSpec} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

it('frames one tree, updates its traits and isolates branch shadows', async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  let deck!: Deck<MapView>;
  let frames = 0;
  let groundColor = [0, 0, 0];
  let framePixels = new Uint8Array();
  const errors: string[] = [];
  const cleanup = mountTreeLabExample(parent, {
    onDeckInitialized(instance) {
      deck = instance;
      deck.setProps({
        onError: error => errors.push(error.message),
        onAfterRender({gl}) {
          frames++;
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
          framePixels = pixels;
          const x = Math.floor(gl.drawingBufferWidth * 0.9);
          const y = Math.floor(gl.drawingBufferHeight * 0.1);
          const offset = (y * gl.drawingBufferWidth + x) * 4;
          groundColor = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
        }
      });
    }
  });
  const change = (name: string, value: string | boolean) => {
    const element = parent.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
    if (typeof value === 'boolean') (element as HTMLInputElement).checked = value;
    else element.value = value;
    element.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const trees = () => deck.props.layers[1] as TreeLayer<TreeSpec>;
  try {
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(0);
    await expect.poll(() => groundColor[0], {timeout: 15000}).toBeGreaterThan(150);
    expect(groundColor[1]).toBeGreaterThan(160);
    expect(trees().props.data).toHaveLength(1);
    expect(trees().props.data[0]).toMatchObject({species: 'banyan', position: [0, 0, 0]});
    expect(trees().props.shadowEnabled).toBe(true);
    const children = (
      deck as unknown as {
        layerManager: {getLayers: () => Array<{id: string; props: {shadowEnabled?: boolean}}>};
      }
    ).layerManager.getLayers();
    const canopyLayers = children.filter(layer => layer.id.includes('-canopy-'));
    const woodShadowLayers = children.filter(
      layer => layer.id.includes('-wood-') && layer.id.includes('-shadow-')
    );
    expect(canopyLayers.length).toBeGreaterThan(0);
    expect(canopyLayers.every(layer => layer.props.shadowEnabled === false)).toBe(true);
    expect(woodShadowLayers.some(layer => layer.props.shadowEnabled === true)).toBe(true);
    const filter = deck.props.layerFilter as (params: {
      layer: {id: string};
      renderPass: string;
    }) => boolean;
    expect(filter({layer: {id: 'labels'}, renderPass: 'shadow'})).toBe(false);
    expect(filter({layer: {id: 'labels'}, renderPass: 'draw'})).toBe(true);
    const lighting = deck.props.effects![0] as unknown as {
      getShaderModuleProps: (
        layer: {id: string},
        props: {project: object; shadow: {drawToShadowMap: boolean}}
      ) => {shadow?: {shadowEnabled?: boolean}};
    };
    expect(
      lighting.getShaderModuleProps(canopyLayers[0], {
        project: {},
        shadow: {drawToShadowMap: false}
      }).shadow?.shadowEnabled
    ).toBe(false);
    const shadowedPixels = framePixels.slice();
    const shadowFrameCount = frames;
    change('shadows', false);
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(shadowFrameCount);
    let darkenedPixels = 0;
    for (let i = 0; i < shadowedPixels.length; i += 4)
      if (shadowedPixels[i] - framePixels[i] > 12) darkenedPixels++;
    expect(darkenedPixels).toBeGreaterThan(30);
    const picked = deck.pickObjects({x: 0, y: 0, width: 800, height: 600});
    expect(picked.some(info => [...(trees().props.data as TreeSpec[])].includes(info.object))).toBe(
      true
    );

    change('species', 'oak');
    change('season', 'winter');
    change('spread', '1.3');
    expect(trees().props.data).toHaveLength(1);
    expect(trees().props.shadowEnabled).toBe(false);
    const tree = (trees().props.getTree as (tree: TreeSpec) => TreeSpec)(
      (trees().props.data as TreeSpec[])[0]
    );
    expect(tree).toMatchObject({
      species: 'oak',
      season: 'winter',
      wind: false,
      characteristics: {crownSpread: 1.3}
    });
    const previous = frames;
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(previous);
    expect(errors).toEqual([]);
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
