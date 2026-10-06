// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, expect, it} from 'vitest';

import {DOTLoaderWithParser} from '@loaders.gl/graphs/dot-loader';
import {load} from '@loaders.gl/core';
import {ClassicGraph} from '../../src/graph/classic-graph';
import clusterDot from '../data/__fixtures__/dot/cluster.dot?raw';

describe('published DOT loader integration', () => {
  beforeAll(() => {
    globalThis.CustomEvent ??= Event as any;
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
