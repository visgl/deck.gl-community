// deck.gl-community
// SPDX-License-Identifier: MIT

import React, {useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {
  GraphLayer,
  Graph,
  D3DagLayout,
  Node,
  Edge,
} from '@deck.gl-community/graph-layers';

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
  zoom: -1
};

const NODE_SPACING: [number, number] = [140, 120];

type DagGraphResult = {
  graph: Graph;
  layout: D3DagLayout;
};

function createDagGraph(): DagGraphResult {
  const nodes = DAG_DATA.map(
    (entry) =>
      new Node({
        id: entry.id,
        data: {label: entry.label}
      })
  );

  const edges: Edge[] = [];
  for (const entry of DAG_DATA) {
    if (!entry.parentIds) {
      continue;
    }
    for (const parentId of entry.parentIds) {
      edges.push(
        new Edge({
          id: `${parentId}->${entry.id}`,
          sourceId: parentId,
          targetId: entry.id,
          directed: true
        })
      );
    }
  }

  const graph = new Graph({nodes, edges});
  const layout = new D3DagLayout({
    nodeSize: NODE_SPACING,
    layering: 'topological',
    decross: 'twoLayer',
    coord: 'greedy'
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
        stylesheet: {
          nodes: [
            {
              type: 'circle',
              radius: 18,
              fill: '#4c6ef520',
              stroke: '#102a8220',
              strokeWidth: 2
            },
            {
              type: 'label',
              text: '@label',
              fontSize: 16,
              color: '#102a82',
              offset: [0, 28],
              textAnchor: 'middle',
              alignmentBaseline: 'top'
            }
          ],
          edges: [
            {
              stroke: '#8da2fb',
              strokeWidth: 2,
              decorators: [
                {
                  type: 'arrow',
                  size: 6,
                  fill: '#8da2fb'
                }
              ]
            }
          ]
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
