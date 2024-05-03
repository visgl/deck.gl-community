// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, it, expect} from 'vitest';
import SAMPLE_GRAPH from './__fixtures__/graph.json';
import {createGraph} from '../src/utils/create-graph';

beforeAll(() => {
  global.CustomEvent = Event as any;
});

describe('util/create-graph', () => {
  it('not implemented', () => {
    expect(true).toBeTruthy();
  });
});

describe('util/create-graph', () => {
  it('test createGraph with custom parsers', () => {
    const graph = createGraph({
      nodes: SAMPLE_GRAPH.nodes,
      edges: SAMPLE_GRAPH.edges,
      nodeParser: (node) => ({id: node.name}),
      edgeParser: (edge) => ({
        id: edge.name,
        directed: false,
        sourceId: edge.source,
        targetId: edge.target
      })
    } as any);
    const nodeIds = graph.getNodes().map((n) => n.getId());
    expect(SAMPLE_GRAPH.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(nodeIds));

    const edgeIds = graph.getEdges().map((e) => e.getId());
    expect(SAMPLE_GRAPH.edges.map((n) => n.name)).toEqual(expect.arrayContaining(edgeIds));
  });
});
//
