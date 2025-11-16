// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {PlainGraphDataBuilder} from '../../src/graph-data/plain-graph-data-builder';
import type {PlainGraphData} from '../../src/graph-data/graph-data';

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

describe('PlainGraphDataBuilder', () => {
  it('builds plain graph data arrays', () => {
    const builder = new PlainGraphDataBuilder({version: SAMPLE_GRAPH_DATA.version});

    for (const node of SAMPLE_GRAPH_DATA.nodes ?? []) {
      builder.addNode(node);
    }

    for (const edge of SAMPLE_GRAPH_DATA.edges ?? []) {
      builder.addEdge(edge);
    }

    const plain = builder.build();

    expect(plain.version).toBe(3);
    expect(plain.shape).toBe('plain-graph-data');
    expect(builder.nodeCount).toBe(2);
    expect(builder.edgeCount).toBe(2);
    expect(plain.nodes?.map((node) => node.id)).toEqual(['a', 'b']);
    expect(plain.edges?.map((edge) => edge.sourceId)).toEqual(['a', 'b']);
    expect(plain.nodes?.map((node) => node.attributes?.label)).toEqual(['Node A', 'Node B']);
    expect(plain.edges?.map((edge) => edge.attributes?.label)).toEqual(['forward', 'reverse']);
  });
});
