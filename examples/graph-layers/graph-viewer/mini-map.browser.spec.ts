// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrthographicViewport} from '@deck.gl/core';
import {expect, test, vi} from 'vitest';
import {createMiniMap} from './mini-map';
import {GraphEngine, ClassicGraph, SimpleLayout} from '@deck.gl-community/graph-layers';

test('draws real graph positions, recenters clicks and cleans up its canvas', () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:800px;height:600px';
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
    const positionReads = vi.spyOn(engine, 'getNodePosition');
    const nodePaints = vi.spyOn(CanvasRenderingContext2D.prototype, 'fillRect');
    map.update(engine, viewport);
    const readCount = positionReads.mock.calls.length;
    const paintCount = nodePaints.mock.calls.length;
    map.update(
      engine,
      new OrthographicViewport({width: 800, height: 600, target: [50, 20, 0], zoom: 3})
    );
    expect(positionReads).toHaveBeenCalledTimes(readCount);
    expect(nodePaints).toHaveBeenCalledTimes(paintCount);
    engine.lockNodePosition(graph.findNode('a')!, -80, -40);
    map.update(engine, viewport);
    expect(positionReads.mock.calls.length).toBeGreaterThan(readCount);
    expect(nodePaints.mock.calls.length).toBeGreaterThan(paintCount);
    engine.lockNodePosition(graph.findNode('a')!, -100, -50);
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
    canvas.focus();
    expect(canvas.style.outline).toContain('2px');
    canvas.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', cancelable: true}));
    canvas.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', cancelable: true}));
    expect(recenter.mock.calls[1][0][0]).toBeCloseTo(10 / 0.88);
    expect(recenter.mock.calls[1][0][1]).toBeCloseTo(0);
    map.update(null, viewport);
    expect(canvas.hidden).toBe(true);
    canvas.click();
    expect(recenter).toHaveBeenCalledTimes(2);
  } finally {
    map.destroy();
    engine.clear();
    expect(host.querySelector('canvas')).toBeNull();
    host.remove();
    vi.restoreAllMocks();
  }
});
