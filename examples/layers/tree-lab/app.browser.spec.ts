// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import type {Deck, MapView} from '@deck.gl/core';
import type {TreeLayer, TreeSpec} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

it('renders one tree and updates its species, season and crown spread', async () => {
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
    const initial = trees()!;
    const initialData = initial.props.data as TreeSpec[];
    expect(initialData).toHaveLength(1);
    expect(initialData[0]).toMatchObject({species: 'banyan', position: [0, 0, 0]});
    expect((initial.props.getTree as (tree: TreeSpec) => TreeSpec)(initialData[0])).toMatchObject({
      species: 'banyan',
      season: 'summer',
      wind: false,
      characteristics: {crownSpread: 1}
    });
    change('season', 'winter');
    change('spread', '1.3');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(1);
    const winter = trees()!;
    expect(winter.props.data).toBe(initialData);
    expect((winter.props.getTree as (tree: TreeSpec) => TreeSpec)(initialData[0])).toMatchObject({
      season: 'winter',
      characteristics: {crownSpread: 1.3}
    });

    change('species', 'oak');
    await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(2);
    const oak = trees()!;
    expect(oak.props.data).not.toBe(initialData);
    expect(oak.props.data).toHaveLength(1);
    expect(
      (oak.props.getTree as (tree: TreeSpec) => TreeSpec)((oak.props.data as TreeSpec[])[0])
    ).toMatchObject({
      species: 'oak',
      season: 'winter',
      wind: false,
      characteristics: {crownSpread: 1.3}
    });
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
