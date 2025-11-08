// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {
  collectTransferablesFromUpdates,
  createColumnarEdgeUpdates,
  createColumnarNodeUpdates,
  type WorkerEdgeUpdateRow,
  type WorkerNodeUpdateRow
} from '../../src/layouts/d3-force/worker';

import type {GraphLayoutUpdates} from '../../src/core/graph-layout';

describe('d3-force worker update helpers', () => {
  it('creates typed columnar tables for node updates', () => {
    const rows: WorkerNodeUpdateRow[] = [
      {id: 1, x: 10, y: 20, fx: null, fy: 5, vx: 0.5, vy: -0.25},
      {id: 'b', x: 30, y: 40, fx: 3, fy: null, vx: 0, vy: 0}
    ];

    const table = createColumnarNodeUpdates(rows);
    expect(table).not.toBeNull();
    expect(table?.columns.x).toBeInstanceOf(Float64Array);
    expect(table?.columns.y).toBeInstanceOf(Float64Array);
    expect(Array.isArray(table?.columns.id)).toBe(true);

    const fxColumn = table?.columns.fx as Float64Array;
    const fyColumn = table?.columns.fy as Float64Array;
    expect(fxColumn).toBeInstanceOf(Float64Array);
    expect(fyColumn).toBeInstanceOf(Float64Array);
    expect(Number.isNaN(fxColumn[0])).toBe(true);
    expect(fxColumn[1]).toBe(3);
    expect(fyColumn[0]).toBe(5);
    expect(Number.isNaN(fyColumn[1])).toBe(true);
  });

  it('creates typed columnar tables for edge updates', () => {
    const rows: WorkerEdgeUpdateRow[] = [
      {
        id: 10,
        sourcePosition: [1, 2],
        targetPosition: [3, 4],
        controlPoints: [
          [1, 1],
          [2, 2]
        ]
      },
      {
        id: 'edge-b',
        sourcePosition: [5, 6],
        targetPosition: [7, 8]
      }
    ];

    const table = createColumnarEdgeUpdates(rows);
    expect(table).not.toBeNull();
    expect(table?.columns.sourceX).toBeInstanceOf(Float64Array);
    expect(table?.columns.targetY).toBeInstanceOf(Float64Array);
    expect(Array.isArray(table?.columns.id)).toBe(true);
    expect(table?.columns.controlPoints?.[0]).toEqual([
      [1, 1],
      [2, 2]
    ]);
  });

  it('collects transferable buffers from updates', () => {
    const nodesTable = createColumnarNodeUpdates([
      {id: 1, x: 0, y: 1}
    ]);
    const edgesTable = createColumnarEdgeUpdates([
      {id: 2, sourcePosition: [0, 1], targetPosition: [2, 3]}
    ]);

    if (!nodesTable || !edgesTable) {
      throw new Error('Expected columnar updates to be generated');
    }

    const updates: GraphLayoutUpdates = {
      nodes: nodesTable,
      edges: edgesTable
    };

    const transferables = collectTransferablesFromUpdates(updates);
    expect(transferables.length).toBeGreaterThan(0);
    const buffers = new Set(transferables.map((buffer) => buffer.byteLength));
    expect(buffers.has(nodesTable.columns.x.buffer.byteLength)).toBe(true);
    expect(buffers.has(edgesTable.columns.sourceX.buffer.byteLength)).toBe(true);
  });
});
