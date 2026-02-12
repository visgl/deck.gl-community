// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {PlainGraphDataBuilder} from '../../src/graph-data/plain-graph-data-builder';
import type {GraphData} from '../../src/graph-data/graph-data';

const SAMPLE_GRAPH_DATA: GraphData = {
  shape: 'plain-graph-data',
  version: 5,
  nodes: [
    {
      id: 'node-1',
      label: 'Node 1',
      state: 'hover',
      selectable: true,
      highlightConnectedEdges: true,
      weight: 2,
      attributes: {category: 'alpha'}
    },
    {
      id: 'node-2',
      attributes: {label: 'Node 2', selectable: false}
    }
  ],
  edges: [
    {
      id: 'edge-1',
      sourceId: 'node-1',
      targetId: 'node-2',
      directed: true,
      state: 'selected',
      weight: 4,
      attributes: {label: 'Edge 1'}
    },
    {
      id: 'edge-2',
      sourceId: 'node-2',
      targetId: 'node-1',
      attributes: {state: 'hover'}
    }
  ]
};

describe('PlainGraphDataBuilder', () => {
  it('returns GraphData with cloned records', () => {
    const builder = new PlainGraphDataBuilder({version: 1});

    for (const node of SAMPLE_GRAPH_DATA.nodes ?? []) {
      builder.addNode(node);
    }

    for (const edge of SAMPLE_GRAPH_DATA.edges ?? []) {
      builder.addEdge(edge);
    }

    const result = builder.build();

    expect(result.version).toBe(1);
    expect(result.shape).toBe('plain-graph-data');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(2);
    expect(result.nodes?.map((node) => node?.id)).toEqual(['node-1', 'node-2']);
    expect(result.edges?.map((edge) => edge?.id)).toEqual(['edge-1', 'edge-2']);

    expect(result.nodes?.[0]).not.toBe(SAMPLE_GRAPH_DATA.nodes?.[0]);
    expect(result.edges?.[0]).not.toBe(SAMPLE_GRAPH_DATA.edges?.[0]);
    expect(result.nodes?.[0]?.attributes).not.toBe(SAMPLE_GRAPH_DATA.nodes?.[0]?.attributes);
    expect(result.edges?.[0]?.attributes).not.toBe(SAMPLE_GRAPH_DATA.edges?.[0]?.attributes);
  });
});
