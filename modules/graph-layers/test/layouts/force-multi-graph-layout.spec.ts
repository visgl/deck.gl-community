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
});
