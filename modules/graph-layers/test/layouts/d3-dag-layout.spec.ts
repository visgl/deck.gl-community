// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {Graph} from '../../src/graph/graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import {D3DagLayout} from '../../src/layouts/d3-dag/d3-dag-layout';
import {GraphEngine} from '../../src/core/graph-engine';

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

function createLinearChainGraph(): SampleGraph {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => new Node({id}));
  const edges = [
    new Edge({id: 'ab', sourceId: 'a', targetId: 'b', directed: true}),
    new Edge({id: 'bc', sourceId: 'b', targetId: 'c', directed: true}),
    new Edge({id: 'cd', sourceId: 'c', targetId: 'd', directed: true}),
    new Edge({id: 'de', sourceId: 'd', targetId: 'e', directed: true}),
    new Edge({id: 'df', sourceId: 'd', targetId: 'f', directed: true})
  ];

  const graph = new Graph({nodes, edges});
  return {
    graph,
    nodes: Object.fromEntries(nodes.map((node) => [String(node.getId()), node])),
    edges: Object.fromEntries(edges.map((edge) => [String(edge.getId()), edge]))
  };
}

function createAlignedBranchesGraph(): SampleGraph {
  const nodes = [
    new Node({id: 'root', data: {step: 0}}),
    new Node({id: 'a-1', data: {step: 1}}),
    new Node({id: 'a-2', data: {step: 2}}),
    new Node({id: 'a-3', data: {step: 3}}),
    new Node({id: 'b-2', data: {step: 2}}),
    new Node({id: 'b-4', data: {step: 4}}),
    new Node({id: 'b-6', data: {step: 6}})
  ];

  const edges = [
    new Edge({id: 'root-a1', sourceId: 'root', targetId: 'a-1', directed: true}),
    new Edge({id: 'a1-a2', sourceId: 'a-1', targetId: 'a-2', directed: true}),
    new Edge({id: 'a2-a3', sourceId: 'a-2', targetId: 'a-3', directed: true}),
    new Edge({id: 'root-b2', sourceId: 'root', targetId: 'b-2', directed: true}),
    new Edge({id: 'b2-b4', sourceId: 'b-2', targetId: 'b-4', directed: true}),
    new Edge({id: 'b4-b6', sourceId: 'b-4', targetId: 'b-6', directed: true}),
    new Edge({id: 'root-b6', sourceId: 'root', targetId: 'b-6', directed: true})
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
    expect(edgeAB?.type).toBe('line');
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

    const curvedEdge = layout.getEdgePosition(edges.ac);
    expect(curvedEdge?.type).toBe('spline-curve');
    expect(curvedEdge?.controlPoints).toEqual([[0.5, 0.5]]);
    expect(layout.getLinkControlPoints(edges.bd)).toEqual([[-0.5, -0.5]]);
  });

  // eslint-disable-next-line max-statements
  it('collapses linear chains and supports expansion toggles', () => {
    const {graph, nodes, edges} = createLinearChainGraph();
    const layout = new D3DagLayout({
      nodeSize: [1, 1],
      gap: [0, 0],
      layering: 'topological',
      decross: 'twoLayer',
      coord: 'greedy',
      orientation: 'TB',
      collapseLinearChains: true
    });

    layout.initializeGraph(graph);
    layout.start();

    const collapsedPosition = layout.getNodePosition(nodes.a);
    expect(collapsedPosition).not.toBeNull();
    expect(layout.getNodePosition(nodes.b)).toBeNull();
    expect(layout.getNodePosition(nodes.c)).toBeNull();
    expect(layout.getNodePosition(nodes.d)).not.toBeNull();

    const chainId = nodes.a.getPropertyValue('collapsedChainId');
    expect(chainId).toBeTruthy();
    expect(nodes.a.getPropertyValue('collapsedChainLength')).toBe(3);
    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(true);
    expect(nodes.a.getPropertyValue('collapsedNodeIds')).toEqual(['a', 'b', 'c']);

    expect(layout.getEdgePosition(edges.ab)).toBeNull();
    expect(layout.getEdgePosition(edges.bc)).toBeNull();
    const edgeCD = layout.getEdgePosition(edges.cd);
    expect(edgeCD?.sourcePosition).toEqual(collapsedPosition);
    expect(edgeCD?.targetPosition).toEqual(layout.getNodePosition(nodes.d));

    layout.toggleCollapsedChain(String(chainId));
    expect(layout.getNodePosition(nodes.b)).not.toBeNull();
    expect(nodes.a.getPropertyValue('collapsedChainLength')).toBe(1);
    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(false);
    expect(nodes.a.getPropertyValue('collapsedNodeIds')).toEqual(['a', 'b', 'c']);
    expect(layout.getEdgePosition(edges.ab)).not.toBeNull();

    layout.setCollapsedChains([String(chainId)]);
    expect(layout.getNodePosition(nodes.b)).toBeNull();
    expect(nodes.a.getPropertyValue('collapsedChainLength')).toBe(3);
    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(true);
    expect(layout.getNodePosition(nodes.a)).toEqual(collapsedPosition);
    expect(layout.getEdgePosition(edges.ab)).toBeNull();

    layout.setCollapsedChains([]);
    expect(layout.getNodePosition(nodes.b)).not.toBeNull();
    expect(nodes.a.getPropertyValue('collapsedChainLength')).toBe(1);
  });

  it('exposes visible nodes through the engine when chains collapse', () => {
    const {graph} = createLinearChainGraph();
    const layout = new D3DagLayout({
      nodeSize: [1, 1],
      gap: [0, 0],
      layering: 'topological',
      decross: 'twoLayer',
      coord: 'greedy',
      orientation: 'TB',
      collapseLinearChains: true
    });

    const engine = new GraphEngine({graph, layout});
    engine.run();

    const collapsedIds = engine.getNodes().map((node) => node.getId());
    expect(collapsedIds).toEqual(['a', 'd', 'e', 'f']);

    const chainId = graph.findNode('a')?.getPropertyValue('collapsedChainId');
    expect(chainId).toBeTruthy();
    layout.toggleCollapsedChain(String(chainId));

    const expandedIds = engine.getNodes().map((node) => node.getId());
    expect(expandedIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('exposes all nodes when collapsing is disabled', () => {
    const {graph} = createLinearChainGraph();
    const layout = new D3DagLayout({
      nodeSize: [1, 1],
      gap: [0, 0],
      layering: 'topological',
      decross: 'twoLayer',
      coord: 'greedy',
      orientation: 'TB',
      collapseLinearChains: false
    });

    const engine = new GraphEngine({graph, layout});
    engine.run();

    const ids = engine.getNodes().map((node) => node.getId());
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('aligns nodes to the same vertical rank when alignRank is provided', () => {
    const {graph, nodes} = createAlignedBranchesGraph();
    const layout = new D3DagLayout({
      nodeSize: [2, 1],
      gap: [24, 40],
      coord: 'simplex',
      alignRank: (node) => Number(node.getPropertyValue('step'))
    });

    layout.initializeGraph(graph);
    layout.start();

    const rankToPositions = new Map<number, Set<number>>();
    for (const node of Object.values(nodes)) {
      const rank = Number(node.getPropertyValue('step'));
      const position = layout.getNodePosition(node);
      expect(position).not.toBeNull();
      const [, y] = position ?? [0, 0];
      const group = rankToPositions.get(rank) ?? new Set<number>();
      group.add(y);
      rankToPositions.set(rank, group);
    }

    for (const positions of rankToPositions.values()) {
      expect(positions.size).toBe(1);
    }

    const capturedPositions = Object.fromEntries(
      Object.entries(nodes).map(([id, node]) => [id, layout.getNodePosition(node)])
    );

    layout.start();

    for (const [id, node] of Object.entries(nodes)) {
      expect(layout.getNodePosition(node)).toEqual(capturedPositions[id]);
    }
  });

  it('supports non-uniform vertical spacing through alignScale', () => {
    const {graph, nodes, edges} = createAlignedBranchesGraph();
    const alignScale = (rank: number) => rank * 32 + rank * 7;
    const layout = new D3DagLayout({
      nodeSize: [2, 1],
      gap: [24, 40],
      coord: 'simplex',
      alignRank: (node) => Number(node.getPropertyValue('step')),
      alignScale
    });

    layout.initializeGraph(graph);
    layout.start();

    for (const node of Object.values(nodes)) {
      const rank = Number(node.getPropertyValue('step'));
      const position = layout.getNodePosition(node);
      expect(position).not.toBeNull();
      if (!position) {
        continue;
      }
      expect(position[1]).toBe(alignScale(rank));
    }

    const longEdge = edges['root-b6'];
    const controlPoints = layout.getLinkControlPoints(longEdge);
    expect(controlPoints.length).toBeGreaterThan(0);
    const expectedRanks = [1, 2, 3, 4, 5];
    expect(controlPoints.map(([, y]) => y)).toEqual(expectedRanks.map(alignScale));
  });

  it('responds to collapse pipeline toggles without losing metadata', () => {
    const {graph, nodes} = createLinearChainGraph();
    const layout = new D3DagLayout({
      nodeSize: [1, 1],
      gap: [0, 0],
      layering: 'topological',
      decross: 'twoLayer',
      coord: 'greedy',
      orientation: 'TB',
      collapseLinearChains: true
    });

    layout.initializeGraph(graph);
    layout.start();

    const chainId = nodes.a.getPropertyValue('collapsedChainId');
    expect(chainId).toBeTruthy();

    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(true);
    expect(nodes.a.getPropertyValue('collapsedChainLength')).toBe(3);
    expect(layout.getNodePosition(nodes.b)).toBeNull();

    layout.setPipelineOptions({collapseLinearChains: false});
    layout.setCollapsedChains([]);

    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(false);
    expect(nodes.a.getPropertyValue('collapsedNodeIds')).toEqual(['a', 'b', 'c']);
    expect(layout.getNodePosition(nodes.b)).not.toBeNull();

    layout.setPipelineOptions({collapseLinearChains: true});
    layout.setCollapsedChains([String(chainId)]);

    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(true);
    expect(nodes.a.getPropertyValue('collapsedChainLength')).toBe(3);
    expect(layout.getNodePosition(nodes.b)).toBeNull();
  });

});
