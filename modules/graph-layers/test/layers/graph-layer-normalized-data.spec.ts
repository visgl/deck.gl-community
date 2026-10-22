// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {tableFromArrays} from 'apache-arrow';
import {GraphLayer} from '../../src/layers/graph-layer';
import {SimpleLayout} from '../../src/layouts/simple-layout';
import {ClassicGraph} from '../../src/graph/classic-graph';
import {isGraphData, type GraphData} from '../../src/graph-data/graph-data';

function initializeLayer(layer: GraphLayer): void {
  vi.spyOn(layer, 'setNeedsRedraw').mockImplementation(() => {});
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  layer.initializeState();
}

const plainData: GraphData = {
  shape: 'plain-graph-data',
  version: 3,
  nodes: [{id: 'a', attributes: {x: 12, y: 34}}, {id: 'b'}],
  edges: [{id: 'ab', sourceId: 'a', targetId: 'b', directed: true}]
};
const arrowData: GraphData = {
  shape: 'arrow-graph-data',
  version: 3,
  nodes: tableFromArrays({id: ['a', 'b'], data: [JSON.stringify({x: 12, y: 34}), '{}']}),
  edges: tableFromArrays({id: ['ab'], sourceId: ['a'], targetId: ['b'], directed: [true]})
};

describe('normalized GraphLayer data', () => {
  it.each([
    plainData,
    arrowData
  ])('bypasses a raw converter for $shape and preserves graph data', data => {
    const graphLoader = vi.fn(() => {
      throw new Error('raw inputs only');
    });
    const layer = new GraphLayer({id: 'normalized', data, graphLoader, layout: new SimpleLayout()});
    try {
      initializeLayer(layer);
      const engine = layer.state.graphEngine!;
      expect(graphLoader).not.toHaveBeenCalled();
      expect(engine.getGraphVersion()).toBe(3);
      expect(engine.getNodes()).toHaveLength(2);
      expect(engine.getEdges()).toHaveLength(1);
      expect(engine.getNodePosition(engine.getNodes()[0])).toEqual([12, 34]);
      expect(engine.getEdges()[0].isDirected()).toBe(true);
    } finally {
      layer.finalize();
    }
  });

  it.each([
    {data: {nodes: [{id: 'raw'}]}},
    {data: [{sourceId: 'a', targetId: 'b'}]}
  ])('keeps raw inputs on the custom-loader path', ({data}) => {
    const graph = new ClassicGraph({data: plainData});
    const graphLoader = vi.fn(() => graph);
    const layer = new GraphLayer({id: 'raw', data, graphLoader, layout: new SimpleLayout()});
    try {
      initializeLayer(layer);
      expect(graphLoader).toHaveBeenCalledWith({json: data});
      expect(layer.state.graphEngine!.getNodes()[0]).toBe(graph.findNodeById('a'));
    } finally {
      layer.finalize();
    }
  });

  it('recognizes shape tags without treating raw records as normalized data', () => {
    expect(isGraphData(plainData)).toBe(true);
    expect(isGraphData(arrowData)).toBe(true);
    for (const value of [null, undefined, {}, [], {nodes: []}, {shape: 'other'}]) {
      expect(isGraphData(value)).toBe(false);
    }
  });
});
