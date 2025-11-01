// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {Graph} from '../../src/graph/graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import {EDGE_TYPE} from '../../src/core/constants';
import {D3DagLayout} from '../../src/layouts/d3-dag/d3-dag-layout';

type SampleGraph = {
  graph: Graph;
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
};

function createSampleDag(): SampleGraph {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => new Node({id}));
  const edges = [
    new Edge({id: 'ab', sourceId: 'a', targetId: 'b', directed: true}),
    new Edge({id: 'ac', sourceId: 'a', targetId: 'c', directed: true}),
    new Edge({id: 'bd', sourceId: 'b', targetId: 'd', directed: true}),
    new Edge({id: 'cd', sourceId: 'c', targetId: 'd', directed: true})
  ];

  const graph = new Graph({nodes, edges});
  return {
    graph,
    nodes: Object.fromEntries(nodes.map((node) => [String(node.getId()), node])),
    edges: Object.fromEntries(edges.map((edge) => [String(edge.getId()), edge]))
  };
}

describe('D3DagLayout', () => {
  it('computes sugiyama positions with greedy coordinates', () => {
    const {graph, nodes, edges} = createSampleDag();
    const layout = new D3DagLayout({
      nodeSize: [2, 1],
      gap: [0, 0],
      layering: 'topological',
      decross: 'twoLayer',
      coord: 'greedy',
      orientation: 'TB'
    });

    layout.initializeGraph(graph);
    layout.start();

    expect(layout.getNodePosition(nodes.a)).toEqual([0, 1.5]);
    expect(layout.getNodePosition(nodes.b)).toEqual([-0.5, 0.5]);
    expect(layout.getNodePosition(nodes.c)).toEqual([0.5, -0.5]);
    expect(layout.getNodePosition(nodes.d)).toEqual([0, -1.5]);

    const edgeAB = layout.getEdgePosition(edges.ab);
    expect(edgeAB?.type).toBe(EDGE_TYPE.LINE);
    expect(edgeAB?.sourcePosition).toEqual(layout.getNodePosition(nodes.a));
    expect(edgeAB?.targetPosition).toEqual(layout.getNodePosition(nodes.b));
    expect(edgeAB?.controlPoints).toEqual([]);
  });

  it('rotates positions for horizontal orientation', () => {
    const {graph, nodes} = createSampleDag();
    const layout = new D3DagLayout({
      nodeSize: [2, 1],
      gap: [0, 0],
      layering: 'topological',
      decross: 'twoLayer',
      coord: 'greedy',
      orientation: 'LR'
    });

    layout.initializeGraph(graph);
    layout.start();

    expect(layout.getNodePosition(nodes.a)).toEqual([-1.5, 0]);
    expect(layout.getNodePosition(nodes.b)).toEqual([-0.5, -0.5]);
    expect(layout.getNodePosition(nodes.c)).toEqual([0.5, 0.5]);
    expect(layout.getNodePosition(nodes.d)).toEqual([1.5, 0]);
  });

  it('exposes curved control points from coordSimplex', () => {
    const {graph, edges} = createSampleDag();
    const layout = new D3DagLayout({
      nodeSize: [2, 1],
      gap: [0, 0],
      layering: 'topological',
      decross: 'twoLayer',
      coord: 'simplex',
      orientation: 'TB'
    });

    layout.initializeGraph(graph);
    layout.start();

    expect(layout.getEdgePosition(edges.ac)?.controlPoints).toEqual([[0.5, 0.5]]);
    expect(layout.getLinkControlPoints(edges.bd)).toEqual([[-0.5, -0.5]]);
  });
});
