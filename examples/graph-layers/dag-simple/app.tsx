// deck.gl-community
// SPDX-License-Identifier: MIT

import React, {useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {
  GraphLayer,
  Graph,
  SimpleLayout,
  Node,
  Edge,
  NODE_TYPE
} from '@deck.gl-community/graph-layers';
import {dagStratify, sugiyama, layeringLongestPath, decrossTwoLayer, coordCenter} from 'd3-dag';

type DagRecord = {
  id: string;
  label: string;
  parentIds?: string[];
};

const DAG_DATA: DagRecord[] = [
  {id: 'collect', label: 'Collect events'},
  {id: 'ingest', label: 'Ingest', parentIds: ['collect']},
  {id: 'quality', label: 'Quality checks', parentIds: ['ingest']},
  {id: 'clean', label: 'Clean data', parentIds: ['quality']},
  {id: 'warehouse', label: 'Warehouse sync', parentIds: ['clean']},
  {id: 'feature', label: 'Feature store', parentIds: ['warehouse']},
  {id: 'training', label: 'Train models', parentIds: ['feature']},
  {id: 'serving', label: 'Serve models', parentIds: ['training']},
  {id: 'monitor', label: 'Monitor', parentIds: ['serving']},
  {id: 'alert', label: 'Alerting', parentIds: ['monitor']},
  {id: 'feedback', label: 'Feedback', parentIds: ['alert', 'monitor']},
  {id: 'experiments', label: 'Experimentation', parentIds: ['feature', 'feedback']}
];

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0],
  zoom: 0
};

const NODE_SPACING: [number, number] = [140, 120];

type DagGraphResult = {
  graph: Graph;
  layout: SimpleLayout;
};

function createDagGraph(): DagGraphResult {
  const stratify = dagStratify<DagRecord>();
  const dag = stratify(DAG_DATA);

  const dagLayout = sugiyama()
    .layering(layeringLongestPath())
    .decross(decrossTwoLayer())
    .coord(coordCenter())
    .nodeSize(NODE_SPACING);

  dagLayout(dag);

  const positionedNodes: {id: string; label: string; x: number; y: number}[] = [];

  dag.each((node) => {
    positionedNodes.push({
      id: node.data.id,
      label: node.data.label,
      x: node.x,
      y: node.y
    });
  });

  const minX = Math.min(...positionedNodes.map((d) => d.x));
  const maxX = Math.max(...positionedNodes.map((d) => d.x));
  const minY = Math.min(...positionedNodes.map((d) => d.y));
  const maxY = Math.max(...positionedNodes.map((d) => d.y));

  const offsetX = (minX + maxX) / 2;
  const offsetY = (minY + maxY) / 2;

  const nodes = positionedNodes.map((entry) =>
    new Node({
      id: entry.id,
      data: {
        label: entry.label,
        x: entry.x - offsetX,
        y: -(entry.y - offsetY)
      }
    })
  );

  const edges: Edge[] = [];
  dag.each((node) => {
    node.children.forEach((child) => {
      edges.push(
        new Edge({
          id: `${node.data.id}->${child.data.id}`,
          sourceId: node.data.id,
          targetId: child.data.id,
          directed: true
        })
      );
    });
  });

  const graph = new Graph({nodes, edges});
  const layout = new SimpleLayout({
    nodePositionAccessor: (node) => [
      node.getPropertyValue('x') as number,
      node.getPropertyValue('y') as number
    ]
  });

  return {graph, layout};
}

export default function App(): React.ReactElement {
  const {graph, layout} = useMemo(() => createDagGraph(), []);

  const layers = useMemo(
    () => [
      new GraphLayer({
        id: 'dag-layer',
        graph,
        layout,
        nodeStyle: [
          {
            type: NODE_TYPE.CIRCLE,
            radius: 18,
            fill: '#4c6ef5',
            stroke: '#102a82',
            strokeWidth: 2
          },
          {
            type: NODE_TYPE.LABEL,
            text: (node) => node.getPropertyValue('label') as string,
            fontSize: 16,
            color: '#102a82',
            offset: [0, 28],
            textAnchor: 'middle',
            alignmentBaseline: 'top'
          }
        ],
        edgeStyle: {
          stroke: '#8da2fb',
          strokeWidth: 2,
          decorators: []
        }
      })
    ],
    [graph, layout]
  );

  return (
    <DeckGL
      views={[new OrthographicView({id: 'ortho'})]}
      controller={{dragPan: true, scrollZoom: true, doubleClickZoom: false}}
      initialViewState={INITIAL_VIEW_STATE}
      style={{width: '100vw', height: '100vh'}}
      layers={layers}
      getTooltip={(info) => {
        const {object} = info;
        if (!object) {
          return null;
        }
        if (object.isNode) {
          return `Node: ${object.getPropertyValue('label')}`;
        }
        return `Edge: ${object.getSourceNodeId()} → ${object.getTargetNodeId()}`;
      }}
    />
  );
}
