// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable  max-nested-callbacks */

import {beforeAll, beforeEach, describe, it, expect} from 'vitest';
import SAMPLE_GRAPH1 from '../data/__fixtures__/graph1.json';

import {ClassicGraph} from '../../src/graph/classic-graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import type {EdgeInterface, Graph, NodeInterface} from '../../src/graph/graph';
import type {PlainGraphData} from '../../src/graph-data/graph-data';

type GraphFactory = () => Graph;

const createClassicGraph: GraphFactory = () => {
  const data = createPlainGraphDataFromSample();
  return new ClassicGraph({data});
};

const GRAPH_IMPLEMENTATIONS: [string, GraphFactory][] = [['ClassicGraph', createClassicGraph]];

function createPlainGraphDataFromSample(): PlainGraphData {
  return {
    shape: 'plain-graph-data',
    version: 1,
    nodes: SAMPLE_GRAPH1.nodes.map((node) => ({
      id: node.id,
      selectable: node.id === 'Cosette',
      highlightConnectedEdges: node.id === 'Cosette',
      attributes: {initial: node.id}
    })),
    edges: SAMPLE_GRAPH1.edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      directed: edge.id === '2',
      attributes: {weight: Number(edge.id)}
    }))
  };
}

function createEmptyPlainGraphData(): PlainGraphData {
  return {
    shape: 'plain-graph-data',
    version: 0,
    nodes: [],
    edges: []
  };
}

function createEmptyClassicGraph(): ClassicGraph {
  return new ClassicGraph({data: createEmptyPlainGraphData()});
}

beforeAll(() => {
  globalThis.CustomEvent = Event as any;
});

describe('core/graph', () => {
  describe.each(GRAPH_IMPLEMENTATIONS)('%s common behaviors', (_label, createGraph) => {
    let graph: Graph;

    beforeEach(() => {
      graph = createGraph();
    });

    it('exposes nodes and edges that implement the graph interface', () => {
      const nodes = Array.from(graph.getNodes());
      const edges = Array.from(graph.getEdges());

      expect(graph.version).toBeGreaterThanOrEqual(0);
      expect(nodes).toHaveLength(SAMPLE_GRAPH1.nodes.length);
      expect(edges).toHaveLength(SAMPLE_GRAPH1.edges.length);
      nodes.forEach((node) => {
        expect(node.isNode).toBe(true);
        expect(node.getPropertyValue('initial')).toBe(node.getId());
      });
      edges.forEach((edge) => {
        expect(edge.isEdge).toBe(true);
        expect(edge.getPropertyValue('weight')).toBe(Number(edge.getId()));
      });
    });

    it('provides graph connectivity helpers', () => {
      const node = findNode(graph, 'Cosette');
      expect(node.getId()).toBe('Cosette');
      expect(node.isSelectable()).toBe(true);
      expect(node.shouldHighlightConnectedEdges()).toBe(true);

      const connectedEdges = node.getConnectedEdges();
      expect(connectedEdges.map((e) => e.getId())).toEqual(expect.arrayContaining(['2', '5']));

      expect(node.getSiblingIds()).toEqual(expect.arrayContaining(['Thenardier', 'Javert']));
      expect(node.getDegree()).toBe(2);
      expect(node.getOutDegree()).toBe(1);
      expect(node.getInDegree()).toBe(0);
    });

    it('allows updating node and edge data and state', () => {
      const node = findNode(graph, 'Cosette');
      node.setDataProperty('nickname', 'Co');
      expect(node.getPropertyValue('nickname')).toBe('Co');
      node.setState('hover');
      expect(node.getState()).toBe('hover');

      const edge = findEdge(graph, '2');
      expect(edge.isDirected()).toBe(true);
      edge.setDataProperty('capacity', 42);
      expect(edge.getPropertyValue('capacity')).toBe(42);
      edge.setState('selected');
      expect(edge.getState()).toBe('selected');
    });
  });

  describe('ClassicGraph specifics', () => {
    it('should work with empty named graph', () => {
      const graph = createEmptyClassicGraph();
      graph.setGraphName('test');
      expect(graph.getGraphName()).toBe('test');
    });

    it('should add edges in a batch', () => {
      const graph = createEmptyClassicGraph();
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
      const graph = createEmptyClassicGraph();
      const glNodes = SAMPLE_GRAPH1.nodes.map((n) => new Node({id: n.id, data: {}}));
      graph.batchAddNodes(glNodes);
      expect(graph.getNodes()).toHaveLength(glNodes.length);
    });
  });
});

function findNode(graph: Graph, id: string | number): NodeInterface {
  const withFinder = graph as Graph & {
    findNodeById?: (nodeId: string | number) => NodeInterface | undefined;
  };
  const foundNode = withFinder.findNodeById?.(id);
  if (foundNode) {
    return foundNode;
  }
  const fallback = Array.from(graph.getNodes()).find((node) => node.getId() === id);
  if (!fallback) {
    throw new Error(`Failed to find node with id ${id}`);
  }
  return fallback;
}

function findEdge(graph: Graph, id: string | number): EdgeInterface {
  const edge = Array.from(graph.getEdges()).find((candidate) => candidate.getId() === id);
  if (!edge) {
    throw new Error(`Failed to find edge with id ${id}`);
  }
  return edge;
}
