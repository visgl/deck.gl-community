// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, expect, it} from 'vitest';
import {loadGraphML, parseGraphML} from '../../src/loaders/graphml-loader';
import basicGraphml from '../data/__fixtures__/graphml/basic.graphml?raw';
import defaultsGraphml from '../data/__fixtures__/graphml/defaults.graphml?raw';

beforeAll(() => {
  globalThis.CustomEvent = Event as any;
});

describe('loadGraphML', () => {
  let graph: ReturnType<typeof loadGraphML>;

  beforeAll(() => {
    graph = loadGraphML(basicGraphml);
  });

  it('parses node attributes from GraphML text', () => {
    const nodeIds = Array.from(graph.getNodes(), (node) => node.getId());
    expect(nodeIds).toEqual(expect.arrayContaining(['n0', 'n1']));

    const nodeZero = graph.findNodeById('n0');
    if (!nodeZero) {
      throw new Error('Expected node n0 to be defined');
    }
    expect(nodeZero.getPropertyValue('label')).toBe('Node Zero');
    expect(nodeZero.getPropertyValue('flag')).toBe(false);

    const nodeOne = graph.findNodeById('n1');
    if (!nodeOne) {
      throw new Error('Expected node n1 to be defined');
    }
    const nodeOneCount = nodeOne.getPropertyValue('count');
    expect(nodeOne.getPropertyValue('label')).toBe('Node One');
    expect(nodeOneCount).toBe(7);
    expect(typeof nodeOneCount).toBe('number');
    expect(nodeOne.getPropertyValue('flag')).toBe(true);
    expect(nodeOne.getPropertyValue('custom-text')).toBe('note');
  });

  it('parses edges and typed defaults', () => {
    const edges = Array.from(graph.getEdges());
    expect(edges).toHaveLength(2);

    const [firstEdge, secondEdge] = edges;
    expect(firstEdge.getId()).toBe('e0');
    expect(firstEdge.isDirected()).toBe(true);
    expect(firstEdge.getPropertyValue('weight')).toBe(2.5);
    expect(typeof firstEdge.getPropertyValue('weight')).toBe('number');
    expect(firstEdge.getPropertyValue('flag')).toBe(true);

    expect(secondEdge.getId()).toBe('edge-1');
    expect(secondEdge.isDirected()).toBe(false);
    expect(secondEdge.getPropertyValue('weight')).toBe(1.5);
    expect(secondEdge.getPropertyValue('flag')).toBe(true);
  });

  it('accepts ArrayBuffer inputs and applies default values', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(defaultsGraphml);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const bufferedGraph = loadGraphML(arrayBuffer);
    const nodes = Array.from(bufferedGraph.getNodes());
    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.getPropertyValue('category') === 'general')).toBe(true);

    const [edge] = Array.from(bufferedGraph.getEdges());
    expect(edge.isDirected()).toBe(false);
    expect(edge.getPropertyValue('weight')).toBe(3.5);
  });
});

describe('parseGraphML', () => {
  it('returns GraphData compatible objects', () => {
    const data = parseGraphML(basicGraphml);

    expect(data.type).toBe('graph-data');
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(2);

    const firstEdge = data.edges?.[0];
    if (!firstEdge) {
      throw new Error('Expected first edge to be defined');
    }
    expect(firstEdge.directed).toBe(true);
    expect(firstEdge.attributes?.weight).toBe(2.5);
    expect(firstEdge.attributes?.flag).toBe(true);
  });
});
