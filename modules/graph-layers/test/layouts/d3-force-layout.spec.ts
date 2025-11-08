// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {D3ForceLayout} from '../../src/layouts/d3-force/d3-force-layout';
import type {
  GraphLayoutEdgeUpdateTable,
  GraphLayoutNodeUpdateTable
} from '../../src/core/graph-layout';
import {Graph} from '../../src/graph/graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';

describe('D3ForceLayout applyGraphLayoutUpdates', () => {
  it('applies columnar node and edge updates', () => {
    const layout = new D3ForceLayout();
    const graph = new Graph({
      nodes: [new Node({id: 'a'}), new Node({id: 'b'})],
      edges: [new Edge({id: 'ab', sourceId: 'a', targetId: 'b'})]
    });

    layout.initializeGraph(graph);

    const nodeUpdates: GraphLayoutNodeUpdateTable = {
      length: 2,
      columns: {
        id: ['a', 'b'],
        x: new Float64Array([1, 2]),
        y: new Float64Array([3, 4]),
        fx: new Float64Array([Number.NaN, 5]),
        fy: new Float64Array([Number.NaN, 6])
      }
    };

    const edgeUpdates: GraphLayoutEdgeUpdateTable = {
      length: 1,
      columns: {
        id: ['ab'],
        sourceX: new Float64Array([1]),
        sourceY: new Float64Array([3]),
        targetX: new Float64Array([2]),
        targetY: new Float64Array([4])
      }
    };

    const didUpdate = (layout as any).applyGraphLayoutUpdates({
      nodes: nodeUpdates,
      edges: edgeUpdates
    });

    expect(didUpdate).toBe(true);

    const nodeA = graph.findNode('a');
    const nodeB = graph.findNode('b');
    if (!nodeA || !nodeB) {
      throw new Error('Expected graph nodes to be defined');
    }

    expect(layout.getNodePosition(nodeA)).toEqual([1, 3]);
    expect(layout.getNodePosition(nodeB)).toEqual([2, 4]);

    const edgePosition = layout.getEdgePosition(graph.getEdges()[0]);
    expect(edgePosition).toEqual({
      type: 'line',
      sourcePosition: [1, 3],
      targetPosition: [2, 4],
      controlPoints: []
    });
  });
});
