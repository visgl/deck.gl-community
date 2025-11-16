// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {ArrowGraph} from '../../src/graph/arrow-graph';
import {ClassicGraph} from '../../src/graph/classic-graph';
import type {ArrowGraphData} from '../../src/graph-data/graph-data';

describe('ArrowGraph', () => {
  it('exposes nodes and edges from Arrow tables', () => {
    const graph = new ArrowGraph({data: createArrowGraphData({version: 2})});

    expect(graph.version).toBe(2);

    const [nodeA, nodeB] = Array.from(graph.getNodes());
    const [edge] = Array.from(graph.getEdges());

    expect(nodeA.getId()).toBe('a');
    expect(nodeA.getState()).toBe('hover');
    expect(nodeA.isSelectable()).toBe(true);
    expect(nodeA.shouldHighlightConnectedEdges()).toBe(true);
    expect(nodeA.getPropertyValue('label')).toBe('Node A');
    expect(nodeA.getPropertyValue('weight')).toBe(1);

    expect(nodeB.getId()).toBe(2);
    expect(nodeB.getState()).toBe('default');
    expect(nodeB.isSelectable()).toBe(false);
    expect(nodeB.shouldHighlightConnectedEdges()).toBe(false);
    expect(nodeB.getPropertyValue('label')).toBe('Node B');

    expect(edge.getId()).toBe('e-1');
    expect(edge.isDirected()).toBe(true);
    expect(edge.getState()).toBe('selected');
    expect(edge.getPropertyValue('label')).toBe('Edge');
    expect(edge.getSourceNodeId()).toBe('a');
    expect(edge.getTargetNodeId()).toBe(2);

    expect(nodeA.getConnectedEdges()).toEqual([edge]);
    expect(nodeB.getConnectedEdges()).toEqual([edge]);
    expect(nodeA.getSiblingIds()).toEqual([2]);
    expect(nodeB.getSiblingIds()).toEqual(['a']);
  });

  it('updates nodes and edges via the Graph interface', () => {
    const graph = new ArrowGraph({data: createArrowGraphData({})});
    const [nodeA, nodeB] = Array.from(graph.getNodes());
    const [edge] = Array.from(graph.getEdges());

    nodeA.setState('selected');
    nodeA.setDataProperty('extra', 'value');
    edge.setData({custom: 5});

    expect(nodeA.getState()).toBe('selected');
    expect(nodeA.getPropertyValue('extra')).toBe('value');
    expect(edge.getPropertyValue('custom')).toBe(5);

    edge.removeNode(nodeB);
    expect(nodeB.getConnectedEdges()).toEqual([]);
    expect(nodeB.getDegree()).toBe(0);

    edge.addNode(nodeB);
    expect(nodeB.getConnectedEdges()).toEqual([edge]);
    expect(nodeB.getDegree()).toBe(1);
  });

  it('respects graph props passed to the constructor', () => {
    const onNodeAdded = vi.fn();
    const graph = new ArrowGraph({data: createArrowGraphData({}), onNodeAdded});
    expect(graph.props.onNodeAdded).toBe(onNodeAdded);
  });

  it('converts to a ClassicGraph for layouts that require legacy graphs', () => {
    const graph = new ArrowGraph({data: createArrowGraphData({})});

    const classicGraph = graph.toClassicGraph();
    expect(classicGraph).toBeInstanceOf(ClassicGraph);

    const classicNodes = Array.from(classicGraph.getNodes());
    const nodeA = classicNodes.find((node) => node.getId() === 'a');
    expect(nodeA?.getState()).toBe('hover');
    expect(nodeA?.isSelectable()).toBe(true);
    expect(nodeA?.shouldHighlightConnectedEdges()).toBe(true);
    expect(nodeA?.getPropertyValue('label')).toBe('Node A');

    const nodeB = classicNodes.find((node) => node.getId() === 2);
    expect(nodeB?.getState()).toBe('default');
    expect(nodeB?.isSelectable()).toBe(false);

    const classicEdges = Array.from(classicGraph.getEdges());
    const edge = classicEdges.find((candidate) => candidate.getId() === 'e-1');
    expect(edge?.isDirected()).toBe(true);
    expect(edge?.getState()).toBe('selected');
    expect(edge?.getPropertyValue('label')).toBe('Edge');
    expect(edge?.getSourceNodeId()).toBe('a');
    expect(edge?.getTargetNodeId()).toBe(2);
  });
});

function createArrowGraphData({version = 1}: {version?: number}): ArrowGraphData {
  return {
    shape: 'arrow-graph-data',
    version,
    nodes: createArrowTable({
      id: ['a', '2'],
      state: ['hover', 'default'],
      selectable: [true, false],
      highlightConnectedEdges: [true, false],
      data: [
        JSON.stringify({label: 'Node A', weight: 1}),
        JSON.stringify({label: 'Node B'})
      ]
    }),
    edges: createArrowTable({
      id: ['e-1'],
      sourceId: ['a'],
      targetId: ['2'],
      directed: [true],
      state: ['selected'],
      data: [JSON.stringify({label: 'Edge'})]
    })
  };
}

function createArrowTable(columns: Record<string, unknown[]>): any {
  const vectors: Record<string, any> = {};
  for (const [columnName, values] of Object.entries(columns)) {
    vectors[columnName] = createArrowVector(values);
  }

  return {
    getColumn(name: string) {
      return vectors[name] ?? null;
    },
    schema: {
      fields: Object.keys(columns).map((name) => ({name}))
    }
  };
}

function createArrowVector(values: unknown[]): any {
  return {
    length: values.length,
    get(index: number) {
      return values[index];
    },
    toArray() {
      return [...values];
    }
  };
}
