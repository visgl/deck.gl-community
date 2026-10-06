// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, expect, it} from 'vitest';

import {DOTLoaderWithParser} from '@loaders.gl/graphs/dot-loader';
import {load} from '@loaders.gl/core';
import {ClassicGraph} from '../../src/graph/classic-graph';
import clusterDot from '../data/__fixtures__/dot/cluster.dot?raw';
import karateDot from '../data/__fixtures__/dot/karate.dot?raw';

describe('published DOT loader integration', () => {
  beforeAll(() => {
    globalThis.CustomEvent ??= Event as any;
  });

  it('preserves string IDs, labels, weights and undirected edges in the Karate example', async () => {
    const data = await load(
      `data:text/vnd.graphviz,${encodeURIComponent(karateDot)}`,
      DOTLoaderWithParser
    );
    const graph = new ClassicGraph({data});
    expect(Array.from(graph.getNodes())).toHaveLength(8);
    expect(data.nodes.map(node => node.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(graph.findNodeById('0')?.getPropertyValue('label')).toBe('Mr. Hi');
    const edges = Array.from(graph.getEdges());
    expect(edges).toHaveLength(12);
    expect(edges.every(edge => !edge.isDirected())).toBe(true);
    const edge = edges.find(
      candidate => candidate.getSourceNodeId() === '0' && candidate.getTargetNodeId() === '1'
    );
    expect(edge?.getPropertyValue('weight')).toBe(3);
  });

  it('loads upstream plain records into the graph runtime with cluster attributes intact', async () => {
    const data = await load(
      `data:text/vnd.graphviz,${encodeURIComponent(clusterDot)}`,
      DOTLoaderWithParser
    );
    const graph = new ClassicGraph({data});
    expect(data.shape).toBe('plain-graph-data');
    expect(graph.findNodeById('a0')?.getPropertyValue('color')).toBe('white');
    expect(graph.findNodeById('a0')?.getPropertyValue('subgraphs')).toMatchObject([
      {id: 'cluster_0', attributes: {label: 'process #1'}}
    ]);
    const edge = Array.from(graph.getEdges()).find(
      candidate => candidate.getSourceNodeId() === 'a3' && candidate.getTargetNodeId() === 'end'
    );
    expect(edge?.isDirected()).toBe(false);
  });
});
