// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {convertTabularGraphToArrowGraph} from '../../src/graph/convert-tabular-graph-to-arrow-graph';
import {TabularGraph} from '../../src/graph/tabular-graph';
import type {TabularGraphSource, TabularGraphAccessors} from '../../src/graph/tabular-graph';
import type {NodeState, EdgeState} from '../../src/core/constants';
import type {GraphData} from '../../src/graph-data/graph-data';

import SAMPLE_GRAPH1 from '../data/__fixtures__/graph1.json';

type NodeHandle = {
  id: string;
  state?: NodeState;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  data: Record<string, unknown>;
};

type EdgeHandle = {
  id: string;
  sourceId: string;
  targetId: string;
  directed?: boolean;
  state?: EdgeState;
  data: Record<string, unknown>;
};

class InMemorySource implements TabularGraphSource<NodeHandle, EdgeHandle> {
  public version = 5;

  constructor(
    private readonly nodes: NodeHandle[],
    private readonly edges: EdgeHandle[]
  ) {}

  getNodes(): Iterable<NodeHandle> {
    return this.nodes;
  }

  getEdges(): Iterable<EdgeHandle> {
    return this.edges;
  }

  getAccessors(): TabularGraphAccessors<NodeHandle, EdgeHandle> {
    return {
      node: {
        getId: (node) => node.id,
        getState: (node) => node.state ?? 'default',
        setState: (node, state) => {
          node.state = state;
        },
        isSelectable: (node) => Boolean(node.selectable),
        shouldHighlightConnectedEdges: (node) => Boolean(node.highlightConnectedEdges),
        getPropertyValue: (node, key) => node.data?.[key],
        setData: (node, data) => {
          node.data = {...data};
        },
        setDataProperty: (node, key, value) => {
          node.data = {...node.data, [key]: value};
        },
        getData: (node) => node.data
      },
      edge: {
        getId: (edge) => edge.id,
        getSourceId: (edge) => edge.sourceId,
        getTargetId: (edge) => edge.targetId,
        isDirected: (edge) => Boolean(edge.directed),
        getState: (edge) => edge.state ?? 'default',
        setState: (edge, state) => {
          edge.state = state;
        },
        getPropertyValue: (edge, key) => edge.data?.[key],
        setData: (edge, data) => {
          edge.data = {...data};
        },
        setDataProperty: (edge, key, value) => {
          edge.data = {...edge.data, [key]: value};
        },
        getData: (edge) => edge.data
      }
    };
  }
}

describe('convertTabularGraphToArrowGraph', () => {
  it('preserves node and edge attributes needed by the runtime', () => {
    const nodes: NodeHandle[] = [
      {
        id: 'a',
        state: 'hover',
        selectable: true,
        highlightConnectedEdges: true,
        data: {
          label: 'Node A',
          weight: 1,
          position: [1, 2],
          color: 'red',
          state: 'hover',
          selectable: true
        }
      },
      {
        id: 'b',
        data: {
          label: 'Node B',
          weight: 2,
          position: [3, 4],
          custom: 'value'
        }
      }
    ];

    const edges: EdgeHandle[] = [
      {
        id: 'e-1',
        sourceId: 'a',
        targetId: 'b',
        directed: true,
        state: 'selected',
        data: {
          label: 'Edge A-B',
          weight: 5,
          capacity: 10,
          sourceId: 'a'
        }
      }
    ];

    const tabularGraph = new TabularGraph(new InMemorySource(nodes, edges));
    const arrowGraph = convertTabularGraphToArrowGraph(tabularGraph);

    expect(arrowGraph.version).toBe(5);

    const [nodeA, nodeB] = Array.from(arrowGraph.getNodes());
    expect(nodeA.getId()).toBe('a');
    expect(nodeA.getState()).toBe('hover');
    expect(nodeA.isSelectable()).toBe(true);
    expect(nodeA.shouldHighlightConnectedEdges()).toBe(true);
    expect(nodeA.getPropertyValue('position')).toEqual([1, 2]);
    expect(nodeA.getPropertyValue('color')).toBe('red');
    expect(nodeA.getPropertyValue('state')).toBeUndefined();

    expect(nodeB.getId()).toBe('b');
    expect(nodeB.getPropertyValue('custom')).toBe('value');
    expect(nodeB.getPropertyValue('weight')).toBe(2);

    const [edge] = Array.from(arrowGraph.getEdges());
    expect(edge.getId()).toBe('e-1');
    expect(edge.getState()).toBe('selected');
    expect(edge.isDirected()).toBe(true);
    expect(edge.getPropertyValue('capacity')).toBe(10);
    expect(edge.getPropertyValue('sourceId')).toBeUndefined();
  });

  it('produces ArrowGraphs that can provide ClassicGraph fallbacks', () => {
    const nodes: NodeHandle[] = SAMPLE_GRAPH1.nodes.map((node) => ({
      id: node.id,
      data: {label: node.id}
    }));
    const edges: EdgeHandle[] = SAMPLE_GRAPH1.edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      data: {weight: Number(edge.id)}
    }));

    const tabularGraph = new TabularGraph(new InMemorySource(nodes, edges));
    const arrowGraph = convertTabularGraphToArrowGraph(tabularGraph);
    const classicGraph = arrowGraph.toClassicGraph();

    expect(Array.from(classicGraph.getNodes()).map((node) => String(node.getId()))).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.nodes.map((node) => node.id))
    );
    expect(Array.from(classicGraph.getEdges()).map((edge) => String(edge.getId()))).toEqual(
      expect.arrayContaining(SAMPLE_GRAPH1.edges.map((edge) => edge.id))
    );
  });

  it('builds ArrowGraph instances from GraphData sources', () => {
    const graphData: GraphData = {
      type: 'graph-data',
      version: 3,
      nodes: [
        {
          type: 'graph-node-data',
          id: '0',
          label: 'Zero',
          selectable: true,
          highlightConnectedEdges: true,
          state: 'hover',
          attributes: {label: 'Zero', weight: 5, custom: 'value'}
        },
        {
          type: 'graph-node-data',
          id: '1',
          attributes: {label: 'One'}
        }
      ],
      edges: [
        {
          type: 'graph-edge-data',
          id: 'edge-0-1',
          sourceId: '0',
          targetId: '1',
          directed: true,
          label: '0-1',
          state: 'selected',
          attributes: {label: '0-1', capacity: 3}
        }
      ]
    };

    const arrowGraph = convertTabularGraphToArrowGraph(graphData);
    expect(arrowGraph.version).toBe(3);

    const [node0, node1] = Array.from(arrowGraph.getNodes());
    expect(String(node0.getId())).toBe('0');
    expect(node0.getState()).toBe('hover');
    expect(node0.isSelectable()).toBe(true);
    expect(node0.shouldHighlightConnectedEdges()).toBe(true);
    expect(node0.getPropertyValue('custom')).toBe('value');
    expect(node0.getPropertyValue('label')).toBe('Zero');

    expect(String(node1.getId())).toBe('1');
    expect(node1.getPropertyValue('label')).toBe('One');

    const [edge] = Array.from(arrowGraph.getEdges());
    expect(String(edge.getId())).toBe('edge-0-1');
    expect(edge.isDirected()).toBe(true);
    expect(edge.getState()).toBe('selected');
    expect(edge.getPropertyValue('capacity')).toBe(3);
    expect(edge.getPropertyValue('label')).toBe('0-1');
  });
});
