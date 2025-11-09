// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {LegacyGraph} from '../../src/graph/legacy-graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import {D3DagLayout} from '../../src/layouts/d3-dag/d3-dag-layout';
import {CollapsableD3DagLayout} from '../../src/layouts/d3-dag/collapsable-d3-dag-layout';
import {GraphEngine} from '../../src/core/graph-engine';

type SampleGraph = {
  graph: LegacyGraph;
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

  const graph = new LegacyGraph({nodes, edges});
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

  const graph = new LegacyGraph({nodes, edges});
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

});

describe('CollapsableD3DagLayout', () => {

  // eslint-disable-next-line max-statements
  it('collapses linear chains and supports expansion toggles', () => {
    const {graph, nodes, edges} = createLinearChainGraph();
    const layout = new CollapsableD3DagLayout({
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
    const layout = new CollapsableD3DagLayout({
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
    const layout = new CollapsableD3DagLayout({
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

  it('responds to collapse pipeline toggles without losing metadata', () => {
    const {graph, nodes} = createLinearChainGraph();
    const layout = new CollapsableD3DagLayout({
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

    layout.setProps({collapseLinearChains: false});
    layout.setCollapsedChains([]);

    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(false);
    expect(nodes.a.getPropertyValue('collapsedNodeIds')).toEqual(['a', 'b', 'c']);
    expect(layout.getNodePosition(nodes.b)).not.toBeNull();

    layout.setProps({collapseLinearChains: true});
    layout.setCollapsedChains([String(chainId)]);

    expect(nodes.a.getPropertyValue('isCollapsedChain')).toBe(true);
    expect(nodes.a.getPropertyValue('collapsedChainLength')).toBe(3);
    expect(layout.getNodePosition(nodes.b)).toBeNull();
  });

});
