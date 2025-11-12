// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

const windowStub = vi.hoisted(() => ({} as Record<string, unknown>));

vi.mock('global', () => ({window: windowStub}));

import {GraphLayer} from '../../src/layers/graph-layer';
import {GraphEngine} from '../../src/core/graph-engine';
import {SimpleLayout} from '../../src/layouts/simple-layout';
import type {GraphData} from '../../src/graph-data/graph-data';
import type {ArrowGraphData} from '../../src/graph-data/arrow-graph-data';

let originalWindow: unknown;

beforeAll(() => {
  originalWindow = (globalThis as {window?: unknown}).window;
  (globalThis as {window?: unknown}).window = windowStub;
});

afterAll(() => {
  if (typeof originalWindow === 'undefined') {
    delete (globalThis as {window?: unknown}).window;
  } else {
    (globalThis as {window?: unknown}).window = originalWindow;
  }
});

describe('GraphLayer data handling', () => {
  it('builds a graph engine from GraphData inputs', () => {
    const layout = new SimpleLayout();
    const layer = new GraphLayer({id: 'graph-data', layout, data: null} as any);

    const graphData: GraphData = {
      type: 'graph-data',
      version: 1,
      nodes: [{type: 'graph-node-data', id: 'a'}],
      edges: []
    };

    const engine = (layer as any)._deriveEngineFromData(graphData, layer.props);

    expect(engine).toBeInstanceOf(GraphEngine);
  });

  it('builds a graph engine from ArrowGraphData inputs', () => {
    const layout = new SimpleLayout();
    const layer = new GraphLayer({id: 'arrow-data', layout, data: null} as any);
    const arrowData = createArrowGraphData();

    const engine = (layer as any)._deriveEngineFromData(arrowData, layer.props);

    expect(engine).toBeInstanceOf(GraphEngine);
  });

  it('builds a graph engine when the loader resolves to GraphData', () => {
    const layout = new SimpleLayout();
    const loaderGraphData: GraphData = {
      type: 'graph-data',
      nodes: [{type: 'graph-node-data', id: 'a'}],
      edges: [{type: 'graph-edge-data', id: 'edge', sourceId: 'a', targetId: 'a'}]
    };

    const layer = new GraphLayer({
      id: 'loader-graph',
      layout,
      data: null,
      graphLoader: () => loaderGraphData
    } as any);

    const rawData = {nodes: [], edges: []};
    const engine = (layer as any)._deriveEngineFromData(rawData, layer.props);

    expect(engine).toBeInstanceOf(GraphEngine);
  });

  it('builds a graph engine when the loader resolves to ArrowGraphData', () => {
    const layout = new SimpleLayout();
    const arrowData = createArrowGraphData();

    const layer = new GraphLayer({
      id: 'loader-arrow',
      layout,
      data: null,
      graphLoader: () => arrowData
    } as any);

    const rawData = {nodes: [], edges: []};
    const engine = (layer as any)._deriveEngineFromData(rawData, layer.props);

    expect(engine).toBeInstanceOf(GraphEngine);
  });
});

function createArrowGraphData(): ArrowGraphData {
  return {
    type: 'arrow-graph-data',
    version: 1,
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
