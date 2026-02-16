// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {createGraphFromData} from '../../src/graph/functions/create-graph-from-data';
import {ClassicGraph} from '../../src/graph/classic-graph';
import {ArrowGraph} from '../../src/graph/arrow-graph';
import type {PlainGraphData, ArrowGraphData} from '../../src/graph-data/graph-data';

describe('createGraphFromData', () => {
  it('creates a ClassicGraph from PlainGraphData', () => {
    const onNodeAdded = vi.fn();
    const graph = createGraphFromData(PLAIN_GRAPH_DATA, {onNodeAdded});
    expect(graph).toBeInstanceOf(ClassicGraph);
    expect(graph.props.onNodeAdded).toBe(onNodeAdded);
  });

  it('creates an ArrowGraph from ArrowGraphData', () => {
    const onEdgeAdded = vi.fn();
    const graph = createGraphFromData(createArrowGraphData(), {onEdgeAdded});
    expect(graph).toBeInstanceOf(ArrowGraph);
    expect(graph.props.onEdgeAdded).toBe(onEdgeAdded);
  });
});

const PLAIN_GRAPH_DATA: PlainGraphData = {
  shape: 'plain-graph-data',
  version: 1,
  nodes: [{id: 'a'}, {id: 'b'}],
  edges: [{id: 'edge', sourceId: 'a', targetId: 'b'}]
};

function createArrowGraphData(): ArrowGraphData {
  return {
    shape: 'arrow-graph-data',
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
