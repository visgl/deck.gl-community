// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrthographicViewport} from '@deck.gl/core';
import {expect, test, vi} from 'vitest';
import {createMiniMap} from './mini-map';
import {GraphEngine, ClassicGraph, SimpleLayout} from '@deck.gl-community/graph-layers';

test('draws real graph positions, recenters clicks and cleans up its canvas', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const graph = new ClassicGraph({
    data: {
      shape: 'plain-graph-data',
      nodes: [
        {id: 'a', attributes: {x: -100, y: -50}},
        {id: 'b', attributes: {x: 100, y: 50}}
      ],
      edges: []
    }
  });
  const engine = new GraphEngine({graph, layout: new SimpleLayout()});
  engine.run();
  const recenter = vi.fn();
  const map = createMiniMap(host, recenter);
  try {
    const viewport = new OrthographicViewport({
      width: 800,
      height: 600,
      target: [0, 0, 0],
      zoom: 2
    });
    const canvasContext = host.querySelector('canvas')!.getContext('2d')!;
    const moveTo = vi.spyOn(canvasContext, 'moveTo');
    map.update(engine, viewport);
    // At zoom 2 the viewport spans 200 x 150 world units, rather than exp(2).
    expect(moveTo.mock.calls[0][0]).toBeCloseTo(12);
    expect(moveTo.mock.calls[0][1]).toBeCloseTo(9);
    const canvas = host.querySelector('canvas')!;
    expect(canvas.hidden).toBe(false);
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent('click', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      })
    );
    expect(recenter).toHaveBeenCalledWith([0, 0]);
    map.update(null, viewport);
    expect(canvas.hidden).toBe(true);
    canvas.click();
    expect(recenter).toHaveBeenCalledTimes(1);
  } finally {
    map.destroy();
    engine.clear();
    expect(host.querySelector('canvas')).toBeNull();
    host.remove();
  }
});
