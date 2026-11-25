// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test, vi} from 'vitest';
import {coordCenter} from 'd3-dag';
import {Node} from '../../src/graph/node';
import {ClassicGraph} from '../../src/graph/classic-graph';
import {GraphEngine} from '../../src/core/graph-engine';
import {SimpleLayout, type SimpleLayoutProps} from '../../src/layouts/simple-layout';
import {D3DagLayout} from '../../src/layouts/d3-dag/d3-dag-layout';
import {CollapsableD3DagLayout} from '../../src/layouts/d3-dag/collapsable-d3-dag-layout';

function createGraph() {
  return new ClassicGraph({
    data: {
      shape: 'plain-graph-data',
      nodes: [
        {id: 'a', attributes: {x: 1, y: 2}},
        {id: 'b', attributes: {x: 3, y: 4}},
        {id: 'c', attributes: {x: 5, y: 6}}
      ],
      edges: [
        {id: 'ab', sourceId: 'a', targetId: 'b', directed: true},
        {id: 'bc', sourceId: 'b', targetId: 'c', directed: true}
      ]
    }
  });
}

test('commits validated updates once, preserves defaults, and rejects invalid updates atomically', () => {
  class TrackingLayout extends SimpleLayout {
    updates: unknown[] = [];
    protected override _onPropsUpdated(
      previousProps: Readonly<Required<SimpleLayoutProps>>,
      nextProps: Readonly<Required<SimpleLayoutProps>>
    ) {
      this.updates.push({previousProps, nextProps});
      super._onPropsUpdated(previousProps, nextProps);
    }
  }
  const layout = new TrackingLayout();
  expect(layout.updates).toHaveLength(0);
  const original = layout.getProps();
  const callback = vi.fn();
  layout.setProps({onLayoutDone: callback});
  expect(layout.getProps().nodePositionAccessor).toBe(original.nodePositionAccessor);
  expect(original.onLayoutDone).toBeUndefined();
  expect(layout.getProps().onLayoutDone).toBe(callback);
  layout.setProps({onLayoutDone: callback});
  layout.setProps({});
  expect(layout.updates).toHaveLength(1);
  expect(() => layout.setProps({nodePositionAccessor: 42 as any})).toThrow('must be a function');
  expect(layout.getProps().nodePositionAccessor).toBe(original.nodePositionAccessor);
  expect(layout.getProps().onLayoutDone).toBe(callback);
  expect(layout.updates).toHaveLength(1);
});

test('refreshes running SimpleLayout node positions, edge geometry, bounds, and callbacks', () => {
  const graph = createGraph();
  const layout = new SimpleLayout();
  const onLayoutDone = vi.fn();
  const engine = new GraphEngine({graph, layout, onLayoutDone});
  engine.run();
  onLayoutDone.mockClear();
  try {
    const accessor = (node: any): [number, number] => [
      node.getPropertyValue('x') + 10,
      node.getPropertyValue('y') + 20
    ];
    layout.setProps({nodePositionAccessor: accessor});
    expect(engine.getNodePosition(graph.findNode('a')!)).toEqual([11, 22]);
    expect(engine.getEdgePosition(graph.findEdge('ab')!).targetPosition).toEqual([13, 24]);
    expect(engine.getLayoutBounds()).toEqual([
      [11, 22],
      [15, 26]
    ]);
    expect(onLayoutDone).toHaveBeenCalledTimes(1);
    layout.setProps({nodePositionAccessor: accessor});
    expect(onLayoutDone).toHaveBeenCalledTimes(1);
    layout.setNodePositionAccessor(undefined);
    expect(engine.getNodePosition(graph.findNode('a')!)).toEqual([1, 2]);
    expect(onLayoutDone).toHaveBeenCalledTimes(2);
    const nextDone = vi.fn();
    layout.setProps({onLayoutDone: nextDone});
    expect(nextDone).not.toHaveBeenCalled();
    expect(engine.getNodePosition(graph.findNode('a')!)).toEqual([1, 2]);
  } finally {
    engine.clear();
  }
});

test('applies accessor updates made before graph initialization', () => {
  const layout = new SimpleLayout();
  layout.setNodePositionAccessor(() => [10, 20]);
  const graph = createGraph();
  const engine = new GraphEngine({graph, layout});
  engine.run();
  try {
    expect(engine.getNodePosition(graph.findNode('a')!)).toEqual([10, 20]);
  } finally {
    engine.clear();
  }
});

test('invalidates DAG operators for configuration changes without running callback-only updates', () => {
  const graph = createGraph();
  const onLayoutDone = vi.fn();
  const layout = new D3DagLayout({nodeSize: [10, 10], gap: [10, 10], onLayoutDone});
  layout.initializeGraph(graph);
  layout.start();
  const previousPosition = layout.getNodePosition(graph.findNode('c')!);
  onLayoutDone.mockClear();
  layout.setProps({nodeSize: [40, 40], gap: [50, 50]});
  expect(onLayoutDone).not.toHaveBeenCalled();
  layout.update();
  expect(layout.getNodePosition(graph.findNode('c')!)).not.toEqual(previousPosition);
  expect(onLayoutDone).toHaveBeenCalledTimes(1);
});

test('does not rerun collapsed DAG geometry for an unchanged collapse prop', () => {
  const graph = createGraph();
  const onLayoutDone = vi.fn();
  const layout = new CollapsableD3DagLayout({collapseLinearChains: false, onLayoutDone});
  layout.initializeGraph(graph);
  layout.start();
  onLayoutDone.mockClear();
  layout.setProps({collapseLinearChains: false});
  expect(onLayoutDone).not.toHaveBeenCalled();
  layout.setProps({collapseLinearChains: true});
  expect(onLayoutDone).toHaveBeenCalledTimes(1);
});

test('preserves pinned SimpleLayout geometry across accessor changes until unlocked', () => {
  const graph = createGraph();
  const layout = new SimpleLayout();
  const engine = new GraphEngine({graph, layout});
  engine.run();
  try {
    const node = graph.findNode('a')!;
    layout.lockNodePosition(node, 100, 200);
    layout.setNodePositionAccessor(item => [
      item.getPropertyValue('x') + 10,
      item.getPropertyValue('y') + 20
    ]);
    expect(engine.getNodePosition(node)).toEqual([100, 200]);
    expect(engine.getNodePosition(graph.findNode('b')!)).toEqual([13, 24]);
    expect(engine.getEdgePosition(graph.findEdge('ab')!).sourcePosition).toEqual([100, 200]);
    expect(engine.getLayoutBounds()).toEqual([
      [13, 24],
      [100, 200]
    ]);
    layout.unlockNodePosition(node);
    expect(engine.getNodePosition(node)).toEqual([100, 200]);
    expect(engine.getEdgePosition(graph.findEdge('ab')!).sourcePosition).toEqual([100, 200]);
    // The released node adopts the accessor on the next refresh, not at drag end.
    layout.setNodePositionAccessor(item => [
      item.getPropertyValue('x') + 10,
      item.getPropertyValue('y') + 20
    ]);
    expect(engine.getNodePosition(node)).toEqual([11, 22]);
    expect(engine.getEdgePosition(graph.findEdge('ab')!).sourcePosition).toEqual([11, 22]);
    expect(engine.getLayoutBounds()).toEqual([
      [11, 22],
      [15, 26]
    ]);
    layout.lockNodePosition(node, 100, 200);
    graph.removeNode(node.getId());
    layout.updateGraph(graph);
    // Reusing a removed ID must not inherit its old pin.
    const nextGraph = createGraph();
    layout.updateGraph(nextGraph);
    layout.update();
    expect(layout.getNodePosition(nextGraph.findNode('a')!)).toEqual([11, 22]);
  } finally {
    engine.clear();
  }
});

test('uses a replacement custom DAG coordinate operator after the initial layout run', () => {
  const graph = createGraph();
  const firstCoord = vi.fn(coordCenter());
  const secondCoord = vi.fn(coordCenter());
  const layout = new D3DagLayout({customCoord: firstCoord});
  layout.initializeGraph(graph);
  layout.start();
  expect(firstCoord).toHaveBeenCalledTimes(1);
  layout.setProps({customCoord: secondCoord});
  expect(secondCoord).not.toHaveBeenCalled();
  layout.update();
  expect(secondCoord).toHaveBeenCalledTimes(1);
  expect(firstCoord).toHaveBeenCalledTimes(1);
});

test('does not transfer a pin to a replacement node with the same ID in a transaction', () => {
  const graph = createGraph();
  const layout = new SimpleLayout();
  const engine = new GraphEngine({graph, layout});
  engine.run();
  try {
    const original = graph.findNode('a')!;
    layout.lockNodePosition(original, 100, 200);
    graph.transaction(() => {
      graph.removeNode('a');
      graph.addNode(new Node({id: 'a', data: {x: 7, y: 8}}));
    });
    const replacement = graph.findNode('a')!;
    expect(replacement).not.toBe(original);
    expect(engine.getNodePosition(replacement)).toEqual([7, 8]);
    expect(engine.getLayoutBounds()).toEqual([
      [3, 4],
      [7, 8]
    ]);
  } finally {
    engine.clear();
  }
});
