// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {createGraphFromData} from '../../src/graph/create-graph-from-data';
import {TabularGraph} from '../../src/graph/tabular-graph';
import {ArrowGraph} from '../../src/graph/arrow-graph';
import type {GraphData} from '../../src/graph-data/graph-data';
import type {ColumnarGraphColumns} from '../../src/graph-data/columnar-graph-data-builder';
import type {ArrowGraphData} from '../../src/graph-data/arrow-graph-data';

describe('createGraphFromData', () => {
  it('creates a TabularGraph from GraphData', () => {
    const onNodeAdded = vi.fn();
    const graph = createGraphFromData(ROW_GRAPH_DATA, {onNodeAdded});
    expect(graph).toBeInstanceOf(TabularGraph);
    expect(graph.props.onNodeAdded).toBe(onNodeAdded);
  });

  it('creates a TabularGraph from columnar graph columns', () => {
    const graph = createGraphFromData(COLUMNAR_GRAPH_DATA);
    expect(graph).toBeInstanceOf(TabularGraph);
  });

  it('creates an ArrowGraph from ArrowGraphData', () => {
    const onEdgeAdded = vi.fn();
    const graph = createGraphFromData(createArrowGraphData(), {onEdgeAdded});
    expect(graph).toBeInstanceOf(ArrowGraph);
    expect(graph.props.onEdgeAdded).toBe(onEdgeAdded);
  });
});

const ROW_GRAPH_DATA: GraphData = {
  type: 'graph-data',
  version: 1,
  nodes: [
    {type: 'graph-node-data', id: 'a'},
    {type: 'graph-node-data', id: 'b'}
  ],
  edges: [
    {type: 'graph-edge-data', id: 'edge', sourceId: 'a', targetId: 'b'}
  ]
};

const COLUMNAR_GRAPH_DATA: ColumnarGraphColumns = {
  type: 'columnar-graph-data',
  version: 2,
  nodes: {
    id: ['a', 'b'],
    state: ['default', 'hover'],
    selectable: [true, false],
    highlightConnectedEdges: [false, false],
    data: [{}, {}]
  },
  edges: {
    id: ['edge'],
    sourceId: ['a'],
    targetId: ['b'],
    directed: [true],
    state: ['default'],
    data: [{}]
  }
};

function createArrowGraphData(): ArrowGraphData {
  return {
    type: 'arrow-graph-data',
    version: 3,
    nodes: createArrowTable({
      id: ['a'],
      state: ['default'],
      selectable: [true],
      highlightConnectedEdges: [false],
      data: [JSON.stringify({label: 'Node'})]
    }),
    edges: createArrowTable({
      id: ['edge'],
      sourceId: ['a'],
      targetId: ['a'],
      directed: [false],
      state: ['default'],
      data: [JSON.stringify({})]
    })
  };
}

function createArrowTable(columns: Record<string, unknown[]>): any {
  const vectors: Record<string, any> = {};
  for (const [columnName, values] of Object.entries(columns)) {
    vectors[columnName] = {
      length: values.length,
      get(index: number) {
        return values[index];
      },
      toArray() {
        return [...values];
      }
    };
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

