// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {GraphLayer} from '../../src/layers/graph-layer';
import {SimpleLayout} from '../../src/layouts/simple-layout';
import {isGraphData, type PlainGraphData} from '../../src/graph-data/graph-data';
import type {GraphLayerProps} from '../../src/layers/graph-layer';

type TestableGraphLayer = GraphLayer & {
  _deriveEngineFromData(data: GraphLayerProps['data'], props: GraphLayerProps): unknown;
};

const graphData: PlainGraphData = {
  shape: 'plain-graph-data',
  version: 1,
  nodes: [
    {id: 'a', attributes: {x: 0, y: 0}},
    {id: 'b', attributes: {x: 1, y: 1}}
  ],
  edges: [{id: 'ab', sourceId: 'a', targetId: 'b'}]
};

describe('layers/graph-layer', () => {
  it('recognizes normalized graph data', () => {
    expect(isGraphData(graphData)).toBe(true);
    expect(isGraphData({nodes: [], edges: []})).toBe(false);
  });

  it('builds graph engines directly from normalized graph data', () => {
    const graphLoader = vi.fn(() => null);
    const layer = new GraphLayer({id: 'graph-layer-test'}) as TestableGraphLayer;
    const layout = new SimpleLayout();

    const engine = layer._deriveEngineFromData(graphData, {
      id: 'graph-layer-test',
      data: graphData,
      layout,
      graphLoader
    } as GraphLayerProps) as {getNodes: () => unknown[]; getEdges: () => unknown[]};

    expect(graphLoader).not.toHaveBeenCalled();
    expect(engine.getNodes()).toHaveLength(2);
    expect(engine.getEdges()).toHaveLength(1);
  });
});
