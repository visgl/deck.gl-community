// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import type {PlainGraphData} from '../../src/graph-data/graph-data';
import {createGraphFromData} from '../../src/graph/functions/create-graph-from-data';

const SAMPLE_GRAPH_DATA: PlainGraphData = {
  shape: 'plain-graph-data',
  version: 3,
  nodes: [
    {
      id: 'a',
      label: 'Node A',
      state: 'hover',
      selectable: true,
      highlightConnectedEdges: true,
      weight: 1,
      attributes: {category: 'alpha'}
    },
    {
      id: 'b',
      attributes: {
        state: 'bogus',
        label: 'Node B',
        selectable: true
      }
    }
  ],
  edges: [
    {
      id: 'a-b',
      sourceId: 'a',
      targetId: 'b',
      directed: true,
      state: 'selected',
      label: 'forward',
      weight: 2,
      attributes: {color: 'red'}
    },
    {
      id: 'b-a',
      sourceId: 'b',
      targetId: 'a',
      attributes: {
        state: 'bogus',
        directed: true,
        label: 'reverse',
        weight: 0.5
      }
    }
  ]
};

describe('createGraphFromData (PlainGraphData)', () => {
  it('loads row-oriented graph data into a ClassicGraph', () => {
    const graph = createGraphFromData(SAMPLE_GRAPH_DATA);
    const nodes = Array.from(graph.getNodes());
    const edges = Array.from(graph.getEdges());

    expect(graph.version).toBe(3);
    expect(nodes.map((node) => node.getId())).toEqual(['a', 'b']);
    expect(edges.map((edge) => edge.getId())).toEqual(['a-b', 'b-a']);

    const nodeSummaries = nodes.map((node) => ({
      id: node.getId(),
      state: node.getState(),
      selectable: node.isSelectable(),
      highlightConnectedEdges: node.shouldHighlightConnectedEdges(),
      label: node.getPropertyValue('label'),
      weight: node.getPropertyValue('weight'),
      category: node.getPropertyValue('category')
    }));
    expect(nodeSummaries).toEqual([
      {
        id: 'a',
        state: 'hover',
        selectable: true,
        highlightConnectedEdges: true,
        label: 'Node A',
        weight: 1,
        category: 'alpha'
      },
      {
        id: 'b',
        state: 'default',
        selectable: true,
        highlightConnectedEdges: false,
        label: 'Node B',
        weight: undefined,
        category: undefined
      }
    ]);

    const edgeSummaries = edges.map((edge) => ({
      id: edge.getId(),
      state: edge.getState(),
      directed: edge.isDirected(),
      sourceId: edge.getSourceNodeId(),
      targetId: edge.getTargetNodeId(),
      label: edge.getPropertyValue('label'),
      weight: edge.getPropertyValue('weight'),
      color: edge.getPropertyValue('color')
    }));
    expect(edgeSummaries).toEqual([
      {
        id: 'a-b',
        state: 'selected',
        directed: true,
        sourceId: 'a',
        targetId: 'b',
        label: 'forward',
        weight: 2,
        color: 'red'
      },
      {
        id: 'b-a',
        state: 'default',
        directed: true,
        sourceId: 'b',
        targetId: 'a',
        label: 'reverse',
        weight: 0.5,
        color: undefined
      }
    ]);

    expect(graph.findNode('a')?.getId()).toBe('a');
  });
});
