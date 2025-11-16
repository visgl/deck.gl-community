// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {
  DOTGraphLoader,
  loadDOTGraph,
  parseDOTToArrowGraphData
} from '../../src/loaders/dot-graph-loader';
import {ArrowGraph} from '../../src/graph/arrow-graph';
import clusterDot from '../data/__fixtures__/dot/cluster.dot?raw';
import karateDot from '../data/__fixtures__/dot/karate.dot?raw';

describe('loadDOTGraph', () => {
  it('parses an undirected DOT graph', () => {
    const data = loadDOTGraph(karateDot);
    const metadata = data.metadata ?? {};
    const graph = new ArrowGraph({data});

    expect(metadata.id).toBe('karate');
    expect(metadata.directed).toBe(false);
    expect(metadata.attributes).toMatchObject({label: 'Karate Club'});

    const nodes = Array.from(graph.getNodes());
    expect(nodes).toHaveLength(8);

    const nodeZero = graph.findNodeById(0);
    expect(nodeZero).toBeDefined();
    expect(nodeZero?.getPropertyValue('label')).toBe('Mr. Hi');
    expect(nodeZero?.getPropertyValue('shape')).toBe('circle');

    const edge = Array.from(graph.getEdges()).find((candidate) => {
      const source = candidate.getSourceNodeId();
      const target = candidate.getTargetNodeId();
      return (
        (source === 0 && target === 1) ||
        (source === 1 && target === 0)
      );
    });

    expect(edge).toBeDefined();
    expect(edge?.isDirected()).toBe(false);
    expect(edge?.getPropertyValue('weight')).toBe(3);
  });

  it('parses directed graphs with clusters and overrides direction when requested', () => {
    const data = loadDOTGraph(clusterDot);
    const metadata = data.metadata ?? {};
    const graph = new ArrowGraph({data});

    expect(metadata.directed).toBe(true);
    expect(metadata.attributes).toMatchObject({label: 'Cluster Example'});
    expect(metadata.subgraphs.map((entry) => entry.id).sort()).toEqual([
      'cluster_0',
      'cluster_1'
    ]);

    const cluster0 = metadata.subgraphs.find((entry) => entry.id === 'cluster_0');
    expect(cluster0?.attributes).toMatchObject({
      style: 'filled',
      color: 'lightgrey',
      label: 'process #1'
    });

    const a0 = graph.findNodeById('a0');
    expect(a0?.getPropertyValue('style')).toBe('filled');
    expect(a0?.getPropertyValue('color')).toBe('white');

    const membership = a0?.getPropertyValue('subgraphs') as
      | {id: string}[]
      | undefined;
    expect(Array.isArray(membership)).toBe(true);
    expect(membership?.[0]?.id).toBe('cluster_0');

    const endEdge = Array.from(graph.getEdges()).find(
      (candidate) =>
        candidate.getSourceNodeId() === 'a3' && candidate.getTargetNodeId() === 'end'
    );
    expect(endEdge?.isDirected()).toBe(false);
    expect(endEdge?.getPropertyValue('dir')).toBe('none');
  });
});

describe('parseDOTToArrowGraphData', () => {
  it('returns ArrowGraphData with attributes preserved', () => {
    const dot = `digraph Sample {
      graph [label="Test Graph", rankdir=LR];
      node [shape=box];
      A [label="Alpha", weight=1.5];
      B;
      A -> B [weight=2.25, dir=back];
    }`;

    const data = parseDOTToArrowGraphData(dot);
    const metadata = data.metadata ?? {};

    expect(metadata.directed).toBe(true);
    expect(metadata.attributes).toMatchObject({label: 'Test Graph', rankdir: 'LR'});
    expect(metadata.subgraphs).toHaveLength(0);

    expect((data.nodes as {numRows?: number}).numRows ?? 0).toBe(2);
    expect((data.edges as {numRows?: number}).numRows ?? 0).toBe(1);

    const graph = new ArrowGraph({data});
    const edge = Array.from(graph.getEdges())[0];
    expect(edge.isDirected()).toBe(true);
    expect(edge.getPropertyValue('dir')).toBe('back');
    expect(edge.getPropertyValue('weight')).toBe(2.25);
  });
});

describe('DOTGraphLoader', () => {
  it('parses DOT text synchronously', () => {
    const data = DOTGraphLoader.parseTextSync(karateDot);
    expect(data.metadata?.id).toBe('karate');
    const graph = new ArrowGraph({data});
    expect(Array.from(graph.getNodes())).toHaveLength(8);
  });

  it('parses DOT text from an ArrayBuffer', async () => {
    const buffer = new TextEncoder().encode(clusterDot).buffer;
    const data = await DOTGraphLoader.parse(buffer, {dot: {version: 1}});

    expect((data.metadata?.subgraphs ?? []).map((entry) => entry.id).sort()).toEqual([
      'cluster_0',
      'cluster_1'
    ]);
    expect(data.version).toBe(1);
  });
});
