// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {ColumnarGraphDataBuilder} from '../../src/graph-data/columnar-graph-data-builder';
import type {GraphData} from '../../src/graph-data/graph-data';

const SAMPLE_GRAPH_DATA: GraphData = {
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
    {id: 'b', attributes: {label: 'Node B'}}
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
      attributes: {directed: true, label: 'reverse'}
    }
  ]
};

describe('ColumnarGraphDataBuilder', () => {
  it('builds columnar graph tables', () => {
    const builder = new ColumnarGraphDataBuilder({nodeCapacity: 1, edgeCapacity: 1});
    builder.setVersion(SAMPLE_GRAPH_DATA.version);

    for (const node of SAMPLE_GRAPH_DATA.nodes ?? []) {
      builder.addNode(node);
    }

    for (const edge of SAMPLE_GRAPH_DATA.edges ?? []) {
      builder.addEdge(edge);
    }

    const columnar = builder.build();

    expect(columnar.version).toBe(3);
    expect(columnar.nodes.id).toEqual(['a', 'b']);
    expect(columnar.edges.sourceId).toEqual(['a', 'b']);
    const nodeData = columnar.nodes.data ?? [];
    const edgeData = columnar.edges.data ?? [];

    expect(nodeData).toHaveLength(2);
    expect(edgeData).toHaveLength(2);
    expect(nodeData.map((record) => record.label)).toEqual(['Node A', 'Node B']);
    expect(edgeData.map((record) => record.label)).toEqual(['forward', 'reverse']);
  });
});
