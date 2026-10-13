// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {MapView} from '@deck.gl/core';
import type {Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {TreeWindDeck} from './wind-deck';

it('keeps camera transitions and sibling decks running while one wind clock is paused', async () => {
  const decks: TreeWindDeck[] = [];
  const parents: HTMLElement[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const parent = document.createElement('div');
      parent.style.cssText = 'width:160px;height:120px';
      document.body.append(parent);
      parents.push(parent);
      let loaded = false;
      const deck = new TreeWindDeck({
        parent,
        width: 160,
        height: 120,
        useDevicePixels: false,
        deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
        views: new MapView({controller: true}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 5},
        layers: [],
        onLoad: () => {
          deck.setWindClockPaused(index === 0, 2);
          loaded = true;
        }
      });
      decks.push(deck);
      await expect.poll(() => loaded, {timeout: 15000}).toBe(true);
    }
    const internals = decks.map(
      deck =>
        deck as unknown as {
          animationLoop: {stop(): void};
          layerManager: {context: {timeline: unknown; device: Device; gl: WebGL2RenderingContext}};
          viewManager: {
            timeline: {getTime(): number; update(time: number): void; playing: boolean};
            controllers: Record<string, {handleEvent(event: unknown): void}>;
            updateViewStates(): void;
          };
        }
    );
    const start = performance.now();
    for (const internal of internals) {
      internal.animationLoop.stop();
      internal.viewManager.timeline.update(start);
    }
    expect(internals[0].layerManager.context.timeline).not.toBe(internals[0].viewManager.timeline);
    expect(internals[0].layerManager.context.timeline).not.toBe(
      internals[1].layerManager.context.timeline
    );
    const manager = internals[0].viewManager;
    expect(manager.timeline.playing).toBe(true);
    const controller = Object.values(manager.controllers)[0];
    controller.handleEvent({
      type: 'keydown',
      srcEvent: new KeyboardEvent('keydown', {code: 'Equal'})
    });
    manager.updateViewStates();
    for (const internal of internals) internal.viewManager.timeline.update(start + 500);
    manager.updateViewStates();
    for (let index = 0; index < decks.length; index++) {
      decks[index].props.onBeforeRender(internals[index].layerManager.context);
    }
    expect(decks[0].getViewports()[0].zoom).toBeCloseTo(6);
    expect(decks[0].getWindTime()).toBe(2);
    const siblingTime = decks[1].getWindTime();
    for (const internal of internals) internal.viewManager.timeline.update(start + 516);
    for (let index = 0; index < decks.length; index++) {
      decks[index].props.onBeforeRender(internals[index].layerManager.context);
    }
    expect(decks[0].getWindTime()).toBe(2);
    expect(decks[1].getWindTime() - siblingTime).toBeCloseTo(0.016, 6);
  } finally {
    for (const deck of decks) deck.finalize();
    for (const parent of parents) parent.remove();
  }
}, 30000);
