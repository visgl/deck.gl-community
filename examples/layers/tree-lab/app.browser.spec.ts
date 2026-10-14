// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import type {Deck, OrbitView} from '@deck.gl/core';
import type {TreeLayer, TreeSpec} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

it('renders supplied species, applies controls, preserves owner picking and cleans up', async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '600px'});
  document.body.append(parent);
  let deck!: Deck<OrbitView>;
  let frames = 0;
  let colored = 0;
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
          colored = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i + 1] > pixels[i] * 1.2 && pixels[i + 1] > pixels[i + 2] * 1.2) colored++;
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
    await expect.poll(() => colored, {timeout: 15000}).toBeGreaterThan(100);
    expect(trees().props.data).toHaveLength(8);
    const picked = deck.pickObjects({x: 0, y: 0, width: 800, height: 600});
    expect(picked.some(info => [...(trees().props.data as TreeSpec[])].includes(info.object))).toBe(
      true
    );
    change('species', 'oak');
    change('season', 'winter');
    change('wind', false);
    change('attached', false);
    change('fallen', true);
    change('spread', '1.3');
    expect(trees().props.data).toHaveLength(1);
    const tree = (trees().props.getTree as (tree: TreeSpec) => TreeSpec)(
      (trees().props.data as TreeSpec[])[0]
    );
    expect(tree).toMatchObject({
      species: 'oak',
      season: 'winter',
      wind: false,
      characteristics: {crownSpread: 1.3},
      crop: {count: 0, droppedCount: 8}
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
