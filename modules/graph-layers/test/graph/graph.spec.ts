// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, beforeEach, describe, it, expect} from 'vitest';
import SAMPLE_GRAPH1 from '../data/__fixtures__/graph1.json';

import {LegacyGraph} from '../../src/graph/legacy-graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import type {EdgeInterface, Graph, NodeInterface} from '../../src/graph/graph';
import {TabularGraph, TabularNode, TabularEdge} from '../../src/graph/tabular-graph';
import type {TabularGraphAccessors, TabularGraphSource} from '../../src/graph/tabular-graph';
import type {EdgeState, NodeState} from '../../src/core/constants';

type GraphFactory = () => Graph;

type SampleNodeHandle = {
  id: string;
  data: Record<string, unknown>;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  state?: NodeState;
};

type SampleEdgeHandle = {
  id: string;
  sourceId: string;
  targetId: string;
  directed?: boolean;
  data: Record<string, unknown>;
  state?: EdgeState;
};

class SampleTabularGraphSource
  implements TabularGraphSource<SampleNodeHandle, SampleEdgeHandle>
{
  public version = 0;

  private readonly nodes: SampleNodeHandle[];
  private readonly edges: SampleEdgeHandle[];

  constructor(nodes: SampleNodeHandle[], edges: SampleEdgeHandle[]) {
    this.nodes = nodes;
    this.edges = edges;
  }

  getNodes(): Iterable<SampleNodeHandle> {
    return this.nodes;
  }

  getEdges(): Iterable<SampleEdgeHandle> {
    return this.edges;
  }

  getAccessors(): TabularGraphAccessors<SampleNodeHandle, SampleEdgeHandle> {
    return {
      node: {
        getId: (node: SampleNodeHandle) => node.id,
        getState: (node: SampleNodeHandle) => node.state ?? 'default',
        setState: (node: SampleNodeHandle, state: NodeState) => {
          node.state = state;
        },
        isSelectable: (node: SampleNodeHandle) => Boolean(node.selectable),
        shouldHighlightConnectedEdges: (node: SampleNodeHandle) =>
          Boolean(node.highlightConnectedEdges),
        getPropertyValue: (node: SampleNodeHandle, key: string) => node.data?.[key],
        setData: (node: SampleNodeHandle, data: Record<string, unknown>) => {
          node.data = {...data};
        },
        setDataProperty: (node: SampleNodeHandle, key: string, value: unknown) => {
          node.data = {...node.data, [key]: value};
        },
        getData: (node: SampleNodeHandle) => node.data
      },
      edge: {
        getId: (edge: SampleEdgeHandle) => edge.id,
        getSourceId: (edge: SampleEdgeHandle) => edge.sourceId,
        getTargetId: (edge: SampleEdgeHandle) => edge.targetId,
        isDirected: (edge: SampleEdgeHandle) => Boolean(edge.directed),
        getState: (edge: SampleEdgeHandle) => edge.state ?? 'default',
        setState: (edge: SampleEdgeHandle, state: EdgeState) => {
          edge.state = state;
        },
        getPropertyValue: (edge: SampleEdgeHandle, key: string) => edge.data?.[key],
        setData: (edge: SampleEdgeHandle, data: Record<string, unknown>) => {
          edge.data = {...data};
        },
        setDataProperty: (edge: SampleEdgeHandle, key: string, value: unknown) => {
          edge.data = {...edge.data, [key]: value};
        },
        getData: (edge: SampleEdgeHandle) => edge.data
      }
    };
  }

  findNodeById(id: string | number): SampleNodeHandle | undefined {
    return this.nodes.find((node) => node.id === id);
  }

  findEdgeById(id: string | number): SampleEdgeHandle | undefined {
    return this.edges.find((edge) => edge.id === id);
  }
}

const createLegacyGraph: GraphFactory = () => {
  const graph = new LegacyGraph();
  const nodes = SAMPLE_GRAPH1.nodes.map(
    (n) =>
      new Node({
        id: n.id,
        data: {initial: n.id},
        selectable: n.id === 'Cosette',
        highlightConnectedEdges: n.id === 'Cosette'
      })
  );
  const edges = SAMPLE_GRAPH1.edges.map(
    (e) =>
      new Edge({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        directed: e.id === '2',
        data: {weight: Number(e.id)}
      })
  );
  graph.batchAddNodes(nodes);
  graph.batchAddEdges(edges);
  return graph;
};

const createTabularGraph: GraphFactory = () => {
  const nodes: SampleNodeHandle[] = SAMPLE_GRAPH1.nodes.map((n) => ({
    id: n.id,
    data: {initial: n.id},
    selectable: n.id === 'Cosette',
    highlightConnectedEdges: n.id === 'Cosette'
  }));
  const edges: SampleEdgeHandle[] = SAMPLE_GRAPH1.edges.map((e) => ({
    id: e.id,
    sourceId: e.sourceId,
    targetId: e.targetId,
    directed: e.id === '2',
    data: {weight: Number(e.id)}
  }));
  const source = new SampleTabularGraphSource(nodes, edges);
  return new TabularGraph(source);
};

const GRAPH_IMPLEMENTATIONS: [string, GraphFactory][] = [
  ['LegacyGraph', createLegacyGraph],
  ['TabularGraph', createTabularGraph]
];

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
      expect(connectedEdges.map((e) => e.getId())).toEqual(
        expect.arrayContaining(['2', '5'])
      );

      expect(node.getSiblingIds()).toEqual(
        expect.arrayContaining(['Thenardier', 'Javert'])
      );
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

  describe('LegacyGraph specifics', () => {
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
  });

  describe('TabularGraph specifics', () => {
    it('stores node and edge state in the internal tables', () => {
      const nodes: SampleNodeHandle[] = SAMPLE_GRAPH1.nodes.map((n) => ({
        id: n.id,
        data: {initial: n.id}
      }));
      const edges: SampleEdgeHandle[] = SAMPLE_GRAPH1.edges.map((e) => ({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        data: {weight: Number(e.id)}
      }));
      const source = new SampleTabularGraphSource(nodes, edges);
      const graph = new TabularGraph(source);

      const tabularNode = Array.from(graph.getNodes())[0] as TabularNode<SampleNodeHandle, SampleEdgeHandle>;
      const tabularEdge = Array.from(graph.getEdges())[0] as TabularEdge<SampleNodeHandle, SampleEdgeHandle>;

      tabularNode.setState('hover');
      tabularNode.setDataProperty('nickname', 'Co');
      tabularEdge.setState('selected');
      tabularEdge.setDataProperty('capacity', 42);

      expect(graph.getNodeStateByIndex(tabularNode.index)).toBe('hover');
      expect(graph.getNodeDataByIndex(tabularNode.index)).toMatchObject({
        initial: tabularNode.getId(),
        nickname: 'Co'
      });
      expect(graph.getEdgeStateByIndex(tabularEdge.index)).toBe('selected');
      expect(graph.getEdgeDataByIndex(tabularEdge.index)).toMatchObject({
        weight: Number(tabularEdge.getId()),
        capacity: 42
      });

      const nodeHandle = source.findNodeById(tabularNode.getId());
      expect(nodeHandle?.state).toBe('hover');
      expect(nodeHandle?.data.nickname).toBe('Co');

      const edgeHandle = source.findEdgeById(tabularEdge.getId());
      expect(edgeHandle?.state).toBe('selected');
      expect(edgeHandle?.data.capacity).toBe(42);
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
