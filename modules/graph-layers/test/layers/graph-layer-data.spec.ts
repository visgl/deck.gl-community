// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, expect, it, vi} from 'vitest';
import {load} from '@loaders.gl/core';
import {DOTLoaderWithParser} from '@loaders.gl/graphs/dot-loader';
import {GraphLayer} from '../../src/layers/graph-layer';
import {ClassicGraph} from '../../src/graph/classic-graph';
import {SimpleLayout} from '../../src/layouts/simple-layout';
import {loadGraphData} from '../../src/loaders/load-graph-data';
import karateDot from '../data/__fixtures__/dot/karate.dot?raw';

// Exercise graph-engine ownership without a GPU; deck.gl's rendering methods are stubbed.
function initializeLayer(layer: GraphLayer): void {
  vi.spyOn(layer, 'setNeedsRedraw').mockImplementation(() => {});
  vi.spyOn(layer, 'setState').mockImplementation(state => {
    Object.assign(layer.state, state);
  });
  layer.initializeState();
}

describe('GraphLayer data inputs', () => {
  beforeAll(() => {
    globalThis.CustomEvent ??= Event as any;
  });

  it('preserves inline custom properties, positions, states and nested attributes', () => {
    const data = {
      version: 7,
      nodes: [
        {
          id: 'a',
          x: 12,
          y: 34,
          name: 'Alpha',
          group: 'raw',
          attributes: {group: 'nested'},
          selectable: true,
          state: 'selected'
        },
        {id: 'b', x: 56, y: 78, star: true}
      ],
      edges: [{id: 'e', sourceId: 'a', targetId: 'b', type: 'depends-on', directed: true}]
    };
    const original = structuredClone(data);
    const layer = new GraphLayer({id: 'inline', data, layout: new SimpleLayout()});
    initializeLayer(layer);
    const engine = layer.state.graphEngine!;
    expect(engine.getGraphVersion()).toBe(7);
    expect(engine.getNodes()).toHaveLength(2);
    const node = engine.getNodes()[0];
    expect(node.getPropertyValue('name')).toBe('Alpha');
    expect(node.getPropertyValue('group')).toBe('nested');
    expect(node.getState()).toBe('selected');
    expect(engine.getNodePosition(node)).toEqual([12, 34]);
    expect(engine.getEdges()[0].getPropertyValue('type')).toBe('depends-on');
    expect(engine.getEdges()[0].isDirected()).toBe(true);
    expect(data).toEqual(original);
    layer.finalize();
  });

  it('accepts a loaded graph and bypasses graphLoader without requiring an engine', () => {
    const graph = new ClassicGraph({
      data: {shape: 'plain-graph-data', nodes: [{id: 'a', attributes: {x: 1, y: 2}}]}
    });
    const graphLoader = vi.fn();
    const layer = new GraphLayer({
      id: 'loaded',
      data: graph,
      graphLoader,
      layout: new SimpleLayout()
    });
    initializeLayer(layer);
    expect(layer.state.graphEngine!.getNodes()[0]).toBe(graph.findNodeById('a'));
    expect(graphLoader).not.toHaveBeenCalled();
    layer.finalize();
  });

  it('converts published DOT loader output through the default graph loader', async () => {
    const url = `data:text/vnd.graphviz,${encodeURIComponent(karateDot)}`;
    const data = await load(url, [DOTLoaderWithParser]);
    const layer = new GraphLayer({
      id: 'dot',
      data,
      loaders: [DOTLoaderWithParser],
      layout: new SimpleLayout()
    });
    initializeLayer(layer);
    expect(layer.state.graphEngine!.getNodes()).toHaveLength(8);
    expect(layer.state.graphEngine!.getEdges()).toHaveLength(12);
    expect(layer.state.graphEngine!.getNodes()[0].getPropertyValue('label')).toBe('Mr. Hi');
    layer.finalize();
  });

  it('infers endpoint nodes and generates unique IDs for edge-array input', () => {
    const graph = loadGraphData([
      {sourceId: 'a', targetId: 'b', type: 'link'},
      {id: 'edge-0', sourceId: 'b', targetId: 'c'},
      {sourceId: 'a', targetId: 'c'}
    ])!;
    expect([...graph.getNodes()].map(node => node.getId())).toEqual(['a', 'b', 'c']);
    const edges = [...graph.getEdges()];
    expect(new Set(edges.map(edge => edge.getId())).size).toBe(3);
    expect(edges[0].getPropertyValue('type')).toBe('link');
  });

  it('preserves declared nodes when endpoint IDs use a different numeric representation', () => {
    const graph = loadGraphData({
      nodes: [{id: 1, attributes: {x: 10, y: 20, name: 'Declared'}}, {id: 2}],
      edges: [{id: 'e', sourceId: '1', targetId: 2}]
    })!;
    const nodes = [...graph.getNodes()];
    expect(nodes).toHaveLength(2);
    expect(nodes[0].getId()).toBe(1);
    expect(nodes[0].getPropertyValue('name')).toBe('Declared');
    const layout = new SimpleLayout();
    layout.initializeGraph(graph);
    expect(layout.getNodePosition(nodes[0])).toEqual([10, 20]);
  });

  it('skips malformed raw records and accepts empty graphs', () => {
    const graph = loadGraphData({nodes: [null, {id: 'a'}], edges: [null, {sourceId: 'a'}]})!;
    expect([...graph.getNodes()]).toHaveLength(1);
    expect([...graph.getEdges()]).toHaveLength(0);
    expect(loadGraphData({nodes: [], edges: []})).toBeInstanceOf(ClassicGraph);
    expect(loadGraphData({unrelated: true})).toBeNull();
  });
});
