// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {afterEach, expect, it, vi} from 'vitest';
import {mountTreeFilm} from './film';
import {TreeLightingEffect} from './tree-lighting';

const harness = vi.hoisted(() => ({decks: [] as any[], failSecondConstructor: false}));
vi.mock('@deck.gl/core', async importOriginal => {
  const original = await importOriginal<typeof import('@deck.gl/core')>();
  return {
    ...original,
    Deck: class {
      props: any;
      finalized = false;
      constructor(props: any) {
        if (harness.failSecondConstructor && harness.decks.length === 1)
          throw new Error('Device creation failed');
        harness.decks.push(this);
        this.props = {};
        this.setProps(props);
        props.onLoad();
      }
      setProps(props: any) {
        this.props = {...this.props, ...props};
      }
      redrawCount = 0;
      redraw() {
        this.redrawCount++;
      }
      finalize() {
        this.finalized = true;
      }
    }
  };
});
afterEach(() => {
  harness.decks.length = 0;
  harness.failSecondConstructor = false;
  vi.restoreAllMocks();
});
it('shows the original initialization error after failed film cleanup removes the controls', async () => {
  const parent = document.createElement('div');
  parent.id = 'app';
  document.body.append(parent);
  harness.failSecondConstructor = true;
  try {
    await import('./film-entry');
    await expect
      .poll(() => parent.querySelector('[role="alert"]')?.textContent)
      .toBe('Device creation failed');
    expect(harness.decks[0].finalized).toBe(true);
  } finally {
    parent.remove();
  }
});
it('waits for the requested paired pose and ready shadow maps, ignoring stale callbacks', async () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const ready = vi
    .spyOn(TreeLightingEffect.prototype, 'groundShadowsReady', 'get')
    .mockReturnValue(false);
  let settled = false;
  const startup = mountTreeFilm(parent).then(cleanup => {
    settled = true;
    return cleanup;
  });
  try {
    expect(harness.decks).toHaveLength(2);
    for (const deck of harness.decks) deck.props.onAfterRender();
    await Promise.resolve();
    expect(settled).toBe(false);
    for (const deck of harness.decks) {
      deck.props.onBeforeRender();
      deck.props.onAfterRender();
    }
    await Promise.resolve();
    expect(settled).toBe(false);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(harness.decks.every(deck => deck.redrawCount > 0)).toBe(true);
    ready.mockReturnValue(true);
    for (const deck of harness.decks) {
      const view = deck.props.viewState;
      deck.props.viewState = {...view, bearing: 99};
      deck.props.onBeforeRender();
      deck.props.viewState = view;
      deck.props.onAfterRender();
    }
    await Promise.resolve();
    expect(settled).toBe(false);
    // Restoring readiness alone cannot validate a previously rejected draw.
    for (const deck of harness.decks) deck.props.onAfterRender();
    await Promise.resolve();
    expect(settled).toBe(false);
    for (const deck of harness.decks) {
      deck.props.onBeforeRender();
      deck.props.onAfterRender();
    }
    await Promise.resolve();
    expect(settled).toBe(false);
    for (const deck of harness.decks) {
      deck.props.onBeforeRender();
      deck.props.onAfterRender();
    }
    const cleanup = await startup;
    expect(parent.querySelector('#progress')!.textContent).toContain('Ready');
    cleanup();
    expect(harness.decks.every(deck => deck.finalized)).toBe(true);
  } finally {
    parent.remove();
  }
});
it('finalizes both decks when the first paired draw fails', async () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const startup = mountTreeFilm(parent);
  const rejected = expect(startup).rejects.toThrow('Draw failed');
  harness.decks[0].props.onError(new Error('Draw failed'));
  await rejected;
  expect(harness.decks).toHaveLength(2);
  expect(harness.decks.every(deck => deck.finalized)).toBe(true);
  expect(parent.children).toHaveLength(0);
  parent.remove();
});
it('finalizes the first deck if constructing its pair fails', async () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  harness.failSecondConstructor = true;
  await expect(mountTreeFilm(parent)).rejects.toThrow('Device creation failed');
  expect(harness.decks).toHaveLength(1);
  expect(harness.decks[0].finalized).toBe(true);
  expect(parent.children).toHaveLength(0);
  parent.remove();
});
