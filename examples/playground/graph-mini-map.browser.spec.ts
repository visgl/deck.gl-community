// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck} from '@deck.gl/core';
import {GraphLayer} from '@deck.gl-community/graph-layers';
import {DeckPlayground} from '@deck.gl-community/playground';
import {expect, test, vi} from 'vitest';
import {createPlaygroundRegistry} from './registry';
import {TEMPLATES} from './templates';

test('renders one graph in main and overview views with independent cameras', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:1100px;height:700px';
  document.body.append(host);
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const errors = vi.spyOn(GraphLayer.prototype, 'raiseError');
  const playground = new DeckPlayground({
    parentElement: host,
    templates: {'graph-mini-map': TEMPLATES['graph-mini-map']},
    initialTemplate: 'graph-mini-map',
    registry: createPlaygroundRegistry()
  });
  try {
    await vi.waitFor(() => expect(setProps.mock.contexts.length).toBeGreaterThan(0));
    const deck = setProps.mock.contexts[0] as Deck<any>;
    await vi.waitFor(
      () => {
        expect(deck.getViewports()).toHaveLength(2);
        expect((deck.props.layers as GraphLayer[])[0]?.isLoaded).toBe(true);
      },
      {timeout: 20_000}
    );
    const layers = deck.props.layers as GraphLayer[];
    expect(layers).toHaveLength(1);
    const engine = layers[0].state.graphEngine!;
    expect(engine.getNodes()).toHaveLength(6);
    const overview = deck.getViewports().find(viewport => viewport.id === 'overview')!;
    expect(overview.width).toBe(220);
    expect(overview.height).toBe(160);
    expect(overview.zoom).toBe(-1);
    for (const node of engine.getNodes()) {
      const position = overview.project(engine.getNodePosition(node)!);
      expect(position[0]).toBeGreaterThan(0);
      expect(position[0]).toBeLessThan(overview.width);
      expect(position[1]).toBeGreaterThan(0);
      expect(position[1]).toBeLessThan(overview.height);
    }
    const canvas = host.querySelector('canvas')!;
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: bounds.left + 80,
        clientY: bounds.top + 80,
        deltaY: 300,
        bubbles: true,
        cancelable: true
      })
    );
    await vi.waitFor(() => {
      expect(deck.getViewports().find(viewport => viewport.id === 'main')!.zoom).not.toBe(1);
    });
    const nextOverview = deck.getViewports().find(viewport => viewport.id === 'overview')!;
    expect(nextOverview.zoom).toBe(overview.zoom);
    expect(nextOverview.unproject([110, 80])).toEqual(overview.unproject([110, 80]));
    expect((deck.props.layers as GraphLayer[])[0].state.graphEngine).toBe(engine);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    playground.finalize();
    host.remove();
    vi.restoreAllMocks();
  }
}, 60_000);
