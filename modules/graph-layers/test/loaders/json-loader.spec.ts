// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, it, expect} from 'vitest';

import SAMPLE_GRAPH1 from '../data/__fixtures__/graph1.json';
import SAMPLE_GRAPH2 from '../data/__fixtures__/graph2.json';

import {JSONTabularGraphLoader, JSONClassicGraphLoader} from '../../src/loaders/json-loader';

beforeAll(() => {
  globalThis.CustomEvent = Event as any;
});

// TODO: Fix ESM errors and uncomment test below.
describe('loaders/node-parsers', () => {
  it('not implemented', () => {
    expect(true).toBeTruthy();
  });
});

describe('JSONTabularGraphLoader', () => {
  it('should work with default parsers', () => {
    const graph = JSONTabularGraphLoader({json: SAMPLE_GRAPH1});
    expect(graph).not.toBeNull();
    if (!graph) {
      throw new Error('Expected graph to be defined');
    }

    expect(Array.from(graph.getEdges(), (e) => e.getId())).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.edges.map((e) => e.id))
    );
    expect(Array.from(graph.getNodes(), (n) => n.getId())).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.nodes.map((n) => n.id))
    );
  });

  it('should work with custom parsers', () => {
    const graph = JSONTabularGraphLoader({
      json: SAMPLE_GRAPH2,
      nodeParser: (node) => ({id: node.name}),
      edgeParser: (edge) => ({
        id: edge.name,
        directed: false,
        sourceId: edge.source,
        targetId: edge.target
      })
    });
    expect(graph).not.toBeNull();
    if (!graph) {
      throw new Error('Expected graph to be defined');
    }

    expect(Array.from(graph.getEdges(), (n) => n.getId())).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH2.edges.map((e) => e.name))
    );
    expect(Array.from(graph.getNodes(), (n) => n.getId())).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH2.nodes.map((n) => n.name))
    );
  });
});

describe('JSONClassicGraphLoader', () => {
  it('should work with default parsers', () => {
    const graph = JSONClassicGraphLoader({json: SAMPLE_GRAPH1});
    expect(graph.getEdges().map((e) => e.getId())).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.edges.map((e) => e.id))
    );
    expect(graph.getNodes().map((n) => n.getId())).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.nodes.map((n) => n.id))
    );
  });
});
