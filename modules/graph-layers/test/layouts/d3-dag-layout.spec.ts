// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect, vi} from 'vitest';

vi.mock('d3-dag', () => {
  const chainable = (fn) => {
    fn.nodeSize = () => fn;
    fn.layering = () => fn;
    fn.decross = () => fn;
    fn.coord = () => fn;
    return fn;
  };

  const createLayering = () => () => undefined;

  return {
    dagStratify: () => (nodes) => {
      const dagNodes = nodes.map((node) => ({
        data: node,
        x: 0,
        y: 0
      }));
      const nodesById = new Map(dagNodes.map((node) => [node.data.id, node]));
      const links = [];
      nodes.forEach((node) => {
        node.parentIds.forEach((parentId) => {
          links.push({
            source: nodesById.get(parentId),
            target: nodesById.get(node.id),
            points: []
          });
        });
      });
      return {
        descendants: () => dagNodes,
        links: () => links
      };
    },
    sugiyama: () =>
      chainable((dag) => {
        dag.descendants().forEach((node, index) => {
          node.x = index * 10;
          node.y = index * 20;
        });

        dag.links().forEach((link) => {
          link.points = [
            {x: link.source.x, y: link.source.y},
            {x: link.target.x, y: link.target.y}
          ];
        });
      }),
    layeringLongestPath: createLayering,
    layeringSimplex: createLayering,
    layeringTopological: createLayering,
    layeringCoffmanGraham: createLayering,
    decrossTwoLayer: createLayering,
    decrossOpt: createLayering,
    coordCenter: createLayering,
    coordGreedy: createLayering,
    coordQuad: createLayering
  };
});

import {Graph} from '../../src/graph/graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import {D3DagLayout} from '../../src/layouts/d3-dag/d3-dag-layout';

describe('layouts/D3DagLayout', () => {
  it('assigns coordinates to DAG nodes and edges', () => {
    const nodes = [
      new Node({id: 'root'}),
      new Node({id: 'child-a'}),
      new Node({id: 'child-b'}),
      new Node({id: 'leaf'})
    ];

    const edges = [
      new Edge({id: 'root-a', sourceId: 'root', targetId: 'child-a', directed: true}),
      new Edge({id: 'root-b', sourceId: 'root', targetId: 'child-b', directed: true}),
      new Edge({id: 'a-leaf', sourceId: 'child-a', targetId: 'leaf', directed: true}),
      new Edge({id: 'b-leaf', sourceId: 'child-b', targetId: 'leaf', directed: true})
    ];

    const graph = new Graph({nodes, edges});

    const layout = new D3DagLayout({
      nodeSize: [40, 24],
      layering: 'longest-path',
      decross: 'two-layer',
      coord: 'center'
    });

    layout.initializeGraph(graph);
    layout.start();

    graph.getNodes().forEach((node) => {
      const position = layout.getNodePosition(node);
      expect(position).toBeTruthy();
      expect(position).toHaveLength(2);
      expect(typeof position?.[0]).toBe('number');
      expect(typeof position?.[1]).toBe('number');
    });

    graph.getEdges().forEach((edge) => {
      const edgeLayout = layout.getEdgePosition(edge);
      expect(edgeLayout).toBeTruthy();
      expect(edgeLayout?.sourcePosition).toHaveLength(2);
      expect(edgeLayout?.targetPosition).toHaveLength(2);
      expect(Array.isArray(edgeLayout?.controlPoints)).toBe(true);
    });
  });
});
