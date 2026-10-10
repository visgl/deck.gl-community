// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {expect, test, vi} from 'vitest';
import {GraphLayer} from '../../src/layers/graph-layer';
import {SimpleLayout} from '../../src/layouts/simple-layout';

function collectLayers(layer: any): any[] {
  const children = layer.getSubLayers?.() ?? [];
  return children.length ? children.flatMap(collectLayers) : [layer];
}

test('forwards layout transitions to rendered nodes, edges and decorators and honors overrides', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const onError = vi.fn();
  let layer = new GraphLayer({
    id: 'animated-graph',
    data: {
      shape: 'plain-graph-data',
      nodes: [
        {id: 'a', attributes: {x: -20, y: 0}},
        {id: 'b', attributes: {x: 20, y: 0}}
      ],
      edges: [{id: 'ab', sourceId: 'a', targetId: 'b', directed: true}]
    },
    layout: new SimpleLayout(),
    layoutUpdateInterval: 100,
    layoutTransitionDuration: 100,
    stylesheet: {
      nodes: [{type: 'circle'}, {type: 'label', text: 'Node'}],
      edges: {decorators: [{type: 'edge-label', text: 'Edge'}, {type: 'arrow'}]}
    }
  });
  const deck = new Deck({
    canvas,
    width: 320,
    height: 240,
    views: [new OrthographicView()],
    initialViewState: {target: [0, 0, 0], zoom: 0},
    layers: [layer],
    onError
  });
  try {
    await expect
      .poll(() => collectLayers(layer).filter(child => child.isLoaded).length)
      .toBeGreaterThanOrEqual(5);
    expect(onError).not.toHaveBeenCalled();
    await expect
      .poll(() =>
        collectLayers(layer).some(child => child.constructor.layerName === 'SolidPolygonLayer')
      )
      .toBe(true);
    const leaves = collectLayers(layer);
    expect(leaves.some(child => child.constructor.layerName === 'LineLayer')).toBe(true);
    expect(leaves.map(child => child.constructor.layerName).join(',')).toContain(
      'SolidPolygonLayer'
    );
    expect(
      leaves.find(child => child.constructor.layerName === 'ScatterplotLayer').props.transitions
        .getPosition
    ).toBe(100);
    expect(
      leaves.find(child => child.constructor.layerName === 'LineLayer').props.transitions
        .getSourcePosition
    ).toBe(100);
    expect(
      leaves.find(child => child.constructor.layerName === 'SolidPolygonLayer').props.transitions
        .getPolygon
    ).toBe(100);
    for (const child of leaves.filter(child => child.constructor.layerName.endsWith('IconLayer'))) {
      expect(child.props.transitions.getPosition).toBe(100);
    }
    layer = layer.clone({transitions: {getPosition: 0, getFillColor: 200}});
    deck.setProps({layers: [layer]});
    await expect
      .poll(
        () =>
          collectLayers(layer).find(child => child.constructor.layerName === 'ScatterplotLayer')
            ?.props.transitions?.getPosition
      )
      .toBe(0);
    expect(
      collectLayers(layer).find(child => child.constructor.layerName === 'ScatterplotLayer').props
        .transitions.getFillColor
    ).toBe(200);
    expect(
      collectLayers(layer).find(child => child.constructor.layerName === 'LineLayer').props
        .transitions.getSourcePosition
    ).toBe(100);
    for (const duration of [0, -1, NaN, Infinity]) {
      layer = layer.clone({layoutTransitionDuration: duration, transitions: null});
      deck.setProps({layers: [layer]});
      await expect
        .poll(
          () =>
            collectLayers(layer).find(child => child.constructor.layerName === 'LineLayer')?.props
              .transitions?.getSourcePosition
        )
        .toBe(0);
    }
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    canvas.remove();
  }
}, 90_000);

test('interpolates rendered node and edge positions between layout snapshots and snaps at duration zero', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const layout = new SimpleLayout();
  const onError = vi.fn();
  let layer = new GraphLayer({
    id: 'moving-graph',
    data: {
      shape: 'plain-graph-data',
      nodes: [
        {id: 'a', attributes: {x: -20, y: 0}},
        {id: 'b', attributes: {x: 20, y: 0}}
      ],
      edges: [{id: 'ab', sourceId: 'a', targetId: 'b'}]
    },
    layout,
    layoutUpdateInterval: 0,
    layoutTransitionDuration: 1000,
    stylesheet: {nodes: [{type: 'circle'}]}
  });
  const deck = new Deck({
    canvas,
    width: 320,
    height: 240,
    views: [new OrthographicView()],
    initialViewState: {target: [0, 0, 0], zoom: 0},
    layers: [layer],
    onError
  });
  const findLayer = (name: string) =>
    collectLayers(layer).find(child => child.constructor.layerName === name);
  const readPosition = async (name: string, attributeName: string) => {
    const attribute = findLayer(name).getAttributeManager().getAttributes()[attributeName];
    const bytes = await attribute.getBuffer().readAsync(0, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true);
  };
  try {
    await expect.poll(() => Boolean(findLayer('LineLayer')?.isLoaded)).toBe(true);
    const timeline = findLayer('LineLayer').context.timeline;
    timeline.pause();
    const initialTime = timeline.getTime();
    const advance = (time: number) => {
      timeline.setTime(time);
      deck.redraw('deterministic layout animation regression');
    };
    advance(initialTime + 2000);
    await expect.poll(() => readPosition('ScatterplotLayer', 'instancePositions')).toBe(-20);
    const node = layer.state.graphEngine!.findNode('a')!;
    layout.lockNodePosition(node, 80, 0);
    await expect
      .poll(
        () =>
          findLayer('ScatterplotLayer').getAttributeManager().attributes.instancePositions.value[0]
      )
      .toBe(80);
    // Start the new transition before advancing its clock.
    advance(initialTime + 2000);
    advance(initialTime + 2500);
    expect(await readPosition('ScatterplotLayer', 'instancePositions')).toBeCloseTo(30);
    expect(await readPosition('LineLayer', 'instanceSourcePositions')).toBeCloseTo(30);
    advance(initialTime + 3001);
    expect(await readPosition('ScatterplotLayer', 'instancePositions')).toBeCloseTo(80);
    // The line endpoint is clipped one unit from the node center.
    expect(await readPosition('LineLayer', 'instanceSourcePositions')).toBeCloseTo(79);

    layer = layer.clone({layoutTransitionDuration: 0});
    deck.setProps({layers: [layer]});
    await expect.poll(() => findLayer('LineLayer').props.transitions.getSourcePosition).toBe(0);
    layout.lockNodePosition(node, -60, 0);
    await expect.poll(() => readPosition('ScatterplotLayer', 'instancePositions')).toBe(-60);
    expect(await readPosition('LineLayer', 'instanceSourcePositions')).toBeCloseTo(-59);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    canvas.remove();
  }
}, 90_000);
