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
