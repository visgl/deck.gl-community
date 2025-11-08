// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, it, expect} from 'vitest';
import SAMPLE_GRAPH1 from '../data/__fixtures__/graph1.json';

import {LegacyGraph} from '../../src/graph/legacy-graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';

beforeAll(() => {
  globalThis.CustomEvent = Event as any;
});

describe('core/graph', () => {
  it('should work with empty named graph', () => {
    const graph = new LegacyGraph();
    graph.setGraphName('test');
    expect(graph.getGraphName()).toBe('test');
  });

  it('should add edges in a batch', () => {
    const graph = new LegacyGraph();
    const glEdges = SAMPLE_GRAPH1.edges.map(
      (e) =>
        new Edge({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          directed: false,
          data: {}
        })
    );
    graph.batchAddEdges(glEdges);
    // No edges will be added since those source/target
    // nodes don't exist in the graph
    expect(graph.getEdges()).toHaveLength(0);
  });

  it('should add nodes in a batch', () => {
    const graph = new LegacyGraph();
    const glNodes = SAMPLE_GRAPH1.nodes.map((n) => new Node({id: n.id, data: {}}));
    graph.batchAddNodes(glNodes);
    expect(graph.getNodes()).toHaveLength(glNodes.length);
    const graph2 = new LegacyGraph(graph);
    expect(graph2.getNodes()).toHaveLength(glNodes.length);
  });

  it('should find nodes and edges and do basic sanity tests', () => {
    const graph = new LegacyGraph();
    const glEdges = SAMPLE_GRAPH1.edges.map(
      (e) =>
        new Edge({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          directed: false,
          data: {}
        })
    );
    const glNodes = SAMPLE_GRAPH1.nodes.map((n) => new Node({id: n.id, data: {}}));
    graph.batchAddNodes(glNodes);
    graph.batchAddEdges(glEdges);

    // find node
    const foundNode = graph.findNode('Cosette');
    expect(foundNode.getId()).toBe('Cosette');

    // find edge
    const foundEdge = graph.findEdge('1');
    expect(foundEdge.getSourceNodeId()).toBe('Thenardier');
    expect(foundEdge.getTargetNodeId()).toBe('Fantine');

    // getConnectedEdges
    const connectedEdges = graph.getConnectedEdges('Cosette');

    expect(['2', '5']).toEqual(expect.arrayContaining(connectedEdges.map((e) => e.getId())));

    // getNodeSiblings
    const siblings = graph.getNodeSiblings('Cosette');
    expect(['Thenardier', 'Javert']).toEqual(
      expect.arrayContaining(siblings.map((n) => n.getId()))
    );

    // getDegree

    expect(graph.getDegree('Cosette')).toBe(2);

    // removeNode
    graph.removeNode('Cosette');
    expect(graph.getNodes()).toHaveLength(3);
    expect(graph.getEdges()).toHaveLength(3);

    // removeEdge
    graph.removeEdge('1');
    expect(graph.getNodes()).toHaveLength(3);
    expect(graph.getEdges()).toHaveLength(2);

    // reset
    graph.reset();

    // isEmpty
    expect(graph.isEmpty()).toBeTruthy();
  });
});
