// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {RadialLayout} from '../../src/layouts/experimental/radial-layout';
import {ClassicGraph} from '../../src/graph/classic-graph';

type TreeNode = {id: string; children?: string[]};
function createGraph(ids: string[], edges: [string, string][] = []) {
  return new ClassicGraph({
    data: {
      shape: 'plain-graph-data',
      nodes: ids.map(id => ({id})),
      edges: edges.map(([sourceId, targetId], i) => ({id: `e${i}`, sourceId, targetId}))
    }
  });
}
function createLayout(tree: TreeNode[], graph: ClassicGraph, radius = 100) {
  const layout = new RadialLayout({tree, radius});
  layout.initializeGraph(graph);
  layout.start();
  return layout;
}

describe('RadialLayout hierarchy geometry', () => {
  it('places a single root at the origin', () => {
    const graph = createGraph(['root']);
    const layout = createLayout([{id: 'root'}], graph);
    expect(layout.getNodePosition(graph.getNodes()[0])).toEqual([0, 0]);
    expect(layout.getBounds()).toEqual([
      [0, 0],
      [0, 0]
    ]);
  });

  it('lays out a shallow tree within its radius and fills the circle using leaf count', () => {
    const tree = [{id: 'root', children: ['a', 'b', 'c', 'd']}];
    const graph = createGraph(['root', 'a', 'b', 'c', 'd']);
    const layout = createLayout(tree, graph);
    expect(layout.getNodePosition(graph.getNodes()[0])).toEqual([0, 0]);
    const leaves = graph
      .getNodes()
      .slice(1)
      .map(node => layout.getNodePosition(node)!);
    for (const point of leaves) {
      expect(point.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...point)).toBeCloseTo(100);
    }
    expect(leaves[0][0]).toBeCloseTo(-leaves[2][0]);
    expect(leaves[0][1]).toBeCloseTo(-leaves[2][1]);
    expect(leaves[1][0]).toBeCloseTo(-leaves[3][0]);
    expect(leaves[1][1]).toBeCloseTo(-leaves[3][1]);
  });

  it('uses the deepest branch and routes edges through shared ancestors at unequal depths', () => {
    const tree = [
      {id: 'root', children: ['shallow', 'group']},
      {id: 'group', children: ['middle']},
      {id: 'middle', children: ['deep']}
    ];
    const graph = createGraph(
      ['root', 'shallow', 'group', 'middle', 'deep'],
      [
        ['shallow', 'deep'],
        ['root', 'deep'],
        ['deep', 'root']
      ]
    );
    const layout = createLayout(tree, graph);
    const position = (id: string) => layout.getNodePosition(graph.findNode(id)!)!;
    expect(Math.hypot(...position('shallow'))).toBeCloseTo(100 / 3);
    expect(Math.hypot(...position('middle'))).toBeCloseTo(200 / 3);
    expect(Math.hypot(...position('deep'))).toBeCloseTo(100);
    expect(layout.getEdgePosition(graph.getEdges()[0])!.controlPoints).toEqual([
      position('root'),
      position('group'),
      position('middle')
    ]);
    expect(layout.getEdgePosition(graph.getEdges()[1])!.controlPoints).toEqual([
      position('group'),
      position('middle')
    ]);
    expect(layout.getEdgePosition(graph.getEdges()[2])!.controlPoints).toEqual([
      position('middle'),
      position('group')
    ]);
  });

  it('supports ordinary string IDs that match Object prototype names', () => {
    const graph = createGraph(['root', 'constructor', '__proto__']);
    const layout = createLayout([{id: 'root', children: ['constructor', '__proto__']}], graph);
    for (const node of graph.getNodes()) {
      expect(layout.getNodePosition(node)!.every(Number.isFinite)).toBe(true);
    }
  });

  it('returns no geometry for nodes outside the hierarchy and clears stale positions for an empty graph', () => {
    const graph = createGraph(['root', 'a', 'outside'], [['a', 'outside']]);
    const layout = createLayout([{id: 'root', children: ['a']}], graph);
    expect(layout.getNodePosition(graph.findNode('outside')!)).toBeNull();
    expect(layout.getEdgePosition(graph.getEdges()[0])).toBeNull();
    layout.updateGraph(createGraph([]));
    layout.start();
    expect(layout.getNodePosition(graph.findNode('a')!)).toBeNull();
    expect(layout.getBounds()).toBeNull();
  });
});
