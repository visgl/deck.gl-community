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
    const data = JSONTabularGraphLoader({json: SAMPLE_GRAPH1});
    expect(data).not.toBeNull();
    if (!data) {
      throw new Error('Expected graph data to be defined');
    }

    expect(data.type).toBe('graph-data');
    expect(data.nodes?.map((node) => node.id)).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.nodes.map((n) => n.id))
    );
    expect(data.edges?.map((edge) => edge.id)).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.edges.map((e) => e.id))
    );
  });

  it('should work with custom parsers', () => {
    const data = JSONTabularGraphLoader({
      json: SAMPLE_GRAPH2,
      nodeParser: (node) => ({id: node.name}),
      edgeParser: (edge) => ({
        id: edge.name,
        directed: false,
        sourceId: edge.source,
        targetId: edge.target
      })
    });
    expect(data).not.toBeNull();
    if (!data) {
      throw new Error('Expected graph data to be defined');
    }

    expect(data.nodes?.map((node) => node.id)).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH2.nodes.map((n) => n.name))
    );
    expect(data.edges?.map((edge) => edge.id)).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH2.edges.map((e) => e.name))
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
