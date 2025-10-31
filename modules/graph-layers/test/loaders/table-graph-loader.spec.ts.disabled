// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, it, expect} from 'vitest';

import SAMPLE_GRAPH1 from '../__fixtures__/graph1.json';
import SAMPLE_GRAPH2 from '../__fixtures__/graph2.json';

import {tableGraphLoader} from '../../src/loaders/table-graph-loader';

beforeAll(() => {
  globalThis.CustomEvent = Event as any;
});

describe('loaders/node-parsers', () => {
  it('should work with default options', () => {
    const graph = tableGraphLoader(SAMPLE_GRAPH1);

    expect(
      graph.getNodes().map((n) => n.getId()),
      'node ids'
    ).toEqual(expect.arrayContaining(SAMPLE_GRAPH1.nodes.map((n) => n.id)));
    expect(
      graph.getEdges().map((e) => e.getId()),
      'edge ids'
    ).toEqual(expect.arrayContaining(SAMPLE_GRAPH1.edges.map((e) => e.id)));
  });

  it('should work with custom parsers', () => {
    const graph = tableGraphLoader(SAMPLE_GRAPH2, {
      nodeParser: (node) => ({id: node.name}),
      edgeParser: (edge) => ({
        id: edge.name,
        directed: false,
        sourceId: edge.source,
        targetId: edge.target
      })
    });
    expect(
      graph.getNodes().map((n) => n.getId()),
      'node ids'
    ).toEqual(expect.arrayContaining(SAMPLE_GRAPH2.nodes.map((n) => n.name)));
    expect(
      graph.getEdges().map((n) => n.getId()),
      'edge ids'
    ).toEqual(expect.arrayContaining(SAMPLE_GRAPH2.edges.map((e) => e.name)));
  });
});
