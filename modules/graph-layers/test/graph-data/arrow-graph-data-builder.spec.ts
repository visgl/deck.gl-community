// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

vi.mock(
  'apache-arrow',
  () => {
    const makeVector = <T,>(values: T[]) => ({
      toArray: () => [...values]
    });

    const makeBuilder = <T,>() => {
      const values: T[] = [];
      return {
        append(value: T) {
          values.push(value);
          return this;
        },
        finish() {
          return this;
        },
        toVector() {
          return makeVector(values);
        }
      };
    };

    const Table = class {
      constructor(private readonly columns: Record<string, ReturnType<typeof makeVector>>) {}

      static new(columns: Record<string, ReturnType<typeof makeVector>>) {
        return new Table(columns);
      }

      getColumn(name: string) {
        return this.columns[name];
      }
    };

    return {
      makeBuilder,
      Utf8: class {},
      Bool: class {},
      Table
    };
  },
  {virtual: true}
);

// eslint-disable-next-line import/first
import {ArrowGraphDataBuilder} from '../../src/graph-data/arrow-graph-data-builder';

describe('ArrowGraphDataBuilder', () => {
  it('builds Arrow tables for nodes and edges', () => {
    const builder = new ArrowGraphDataBuilder({version: 7});

    builder.addNode({
      id: 'n-1',
      label: 'Node 1',
      state: 'hover',
      selectable: true,
      highlightConnectedEdges: true,
      weight: 3,
      attributes: {extra: 'value'}
    });

    builder.addNode({
      id: 2,
      attributes: {state: 'dragging', selectable: false}
    });

    builder.addEdge({
      id: 'e-1',
      sourceId: 'n-1',
      targetId: 2,
      directed: true,
      state: 'selected',
      weight: 5,
      attributes: {label: 'Edge'}
    });

    builder.addEdge({
      id: 3,
      sourceId: 2,
      targetId: 'n-1',
      attributes: {state: 'hover'}
    });

    const result = builder.finish();

    expect(result.type).toBe('arrow-graph-data');
    expect(result.version).toBe(7);
    expect(result.nodes.getColumn('id')?.toArray()).toEqual(['n-1', '2']);
    expect(result.nodes.getColumn('state')?.toArray()).toEqual(['hover', 'dragging']);
    expect(result.nodes.getColumn('selectable')?.toArray()).toEqual([true, false]);
    expect(result.nodes.getColumn('data')?.toArray()).toEqual([
      JSON.stringify({extra: 'value', label: 'Node 1', weight: 3}),
      JSON.stringify({state: 'dragging', selectable: false})
    ]);
    expect(result.edges.getColumn('id')?.toArray()).toEqual(['e-1', '3']);
    expect(result.edges.getColumn('state')?.toArray()).toEqual(['selected', 'hover']);
    expect(result.edges.getColumn('directed')?.toArray()).toEqual([true, false]);
    expect(result.edges.getColumn('sourceId')?.toArray()).toEqual(['n-1', '2']);
    expect(result.edges.getColumn('targetId')?.toArray()).toEqual(['2', 'n-1']);
    expect(result.edges.getColumn('data')?.toArray()).toEqual([
      JSON.stringify({label: 'Edge', weight: 5}),
      JSON.stringify({state: 'hover'})
    ]);
  });
});

