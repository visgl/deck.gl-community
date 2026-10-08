// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {ClassicGraph} from '../../src/graph/classic-graph';
import {ForceMultiGraphLayout} from '../../src/layouts/experimental/force-multi-graph-layout';
import type {PlainGraphData} from '../../src/graph-data/graph-data';

const GRAPH_DATA: PlainGraphData = {
  shape: 'plain-graph-data',
  nodes: [{id: 'a'}, {id: 'b'}],
  edges: [
    {id: 'ab-1', sourceId: 'a', targetId: 'b'},
    {id: 'ab-2', sourceId: 'a', targetId: 'b'}
  ]
};

describe('ForceMultiGraphLayout', () => {
  it('returns finite positions before the simulation assigns coordinates', () => {
    const graph = new ClassicGraph({data: GRAPH_DATA});
    const layout = new ForceMultiGraphLayout();

    layout.initializeGraph(graph);

    const node = graph.findNode('a');
    const straightEdge = graph.getEdges()[0];
    const curvedEdge = graph.getEdges()[1];

    expect(node).toBeDefined();
    expect(layout.getNodePosition(node!)).toEqual([0, 0]);
    expect(layout.getEdgePosition(straightEdge)).toEqual({
      type: 'spline-curve',
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: [[0, 0]]
    });
    expect(layout.getEdgePosition(curvedEdge)).toEqual({
      type: 'spline-curve',
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: [[0, 0]]
    });
  });
  it('preserves finite coordinates while replacing non-finite components', () => {
    const graph = new ClassicGraph({
      data: {
        ...GRAPH_DATA,
        edges: [{id: 'ab', sourceId: 'a', targetId: 'b'}]
      }
    });
    const layout = new ForceMultiGraphLayout();
    layout.initializeGraph(graph);
    const nodeA = graph.findNode('a')!;
    const nodeB = graph.findNode('b')!;
    layout.lockNodePosition(nodeA, Number.NaN, 12);
    layout.lockNodePosition(nodeB, 5, Number.POSITIVE_INFINITY);
    expect(layout.getNodePosition(nodeA)).toEqual([0, 12]);
    expect(layout.getEdgePosition(graph.getEdges()[0])).toEqual({
      type: 'line',
      sourcePosition: [0, 12],
      targetPosition: [5, 0],
      controlPoints: []
    });
  });

  it('keeps coincident parallel edges finite and separates distinct endpoints', () => {
    const graph = new ClassicGraph({data: GRAPH_DATA});
    const layout = new ForceMultiGraphLayout();
    layout.initializeGraph(graph);
    layout.lockNodePosition(graph.findNode('a')!, 10, 20);
    layout.lockNodePosition(graph.findNode('b')!, 10, 20);
    expect(layout.getEdgePosition(graph.getEdges()[0]).controlPoints).toEqual([[10, 20]]);
    layout.lockNodePosition(graph.findNode('b')!, 30, 20);
    expect(layout.getEdgePosition(graph.getEdges()[0]).controlPoints).toEqual([[20, 25]]);
    expect(layout.getEdgePosition(graph.getEdges()[1]).controlPoints).toEqual([[20, 15]]);
  });
});
