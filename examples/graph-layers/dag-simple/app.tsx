// deck.gl-community
// SPDX-License-Identifier: MIT

import React, {useCallback, useEffect, useMemo, useState} from 'react';
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
    coord: 'greedy',
    collapseLinearChains: true
  });

  return {graph, layout};
}

export default function App(): React.ReactElement {
  const {graph, layout} = useMemo(() => createDagGraph(), []);

  const [collapseEnabled, setCollapseEnabled] = useState(true);

  useEffect(() => {
    layout.setPipelineOptions({collapseLinearChains: collapseEnabled});
    if (!collapseEnabled) {
      layout.setCollapsedChains([]);
    }
  }, [collapseEnabled, layout]);

  const collectChainIds = useCallback(() => {
    const chainIds = new Set<string>();
    for (const node of graph.getNodes()) {
      const chainId = node.getPropertyValue('collapsedChainId');
      const nodeIds = node.getPropertyValue('collapsedNodeIds');
      const representativeId = node.getPropertyValue('collapsedChainRepresentativeId');
      if (
        chainId &&
        Array.isArray(nodeIds) &&
        nodeIds.length > 1 &&
        representativeId === node.getId()
      ) {
        chainIds.add(String(chainId));
      }
    }
    return chainIds;
  }, [graph]);

  const collapseAllChains = useCallback(() => {
    const chainIds = collectChainIds();
    layout.setCollapsedChains(chainIds);
  }, [collectChainIds, layout]);

  const expandAllChains = useCallback(() => {
    layout.setCollapsedChains([]);
  }, [layout]);

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
    <div style={{position: 'relative', width: '100vw', height: '100vh'}}>
      <DeckGL
        views={[new OrthographicView({id: 'ortho'})]}
        controller={{dragPan: true, scrollZoom: true, doubleClickZoom: false}}
        initialViewState={INITIAL_VIEW_STATE}
        style={{width: '100%', height: '100%'}}
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

      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(16, 42, 130, 0.85)',
          color: 'white',
          padding: '12px 16px',
          borderRadius: 8,
          maxWidth: 280,
          fontFamily: 'Inter, sans-serif',
          boxShadow: '0 8px 16px rgba(16, 42, 130, 0.25)'
        }}
      >
        <h3 style={{margin: '0 0 8px', fontSize: 16}}>Collapsed chains</h3>
        <p style={{margin: '0 0 12px', fontSize: 13, lineHeight: 1.4}}>
          Linear chains collapse to a single node marked with a plus icon. Click the plus to expand
          or the minus icon to collapse the chain again.
        </p>
        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
          <button
            type="button"
            onClick={() => setCollapseEnabled((value) => !value)}
            style={{
              background: collapseEnabled ? '#4c6ef5' : '#1f2937',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            {collapseEnabled ? 'Disable collapse' : 'Enable collapse'}
          </button>
          <button
            type="button"
            onClick={collapseAllChains}
            disabled={!collapseEnabled}
            style={{
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              cursor: collapseEnabled ? 'pointer' : 'not-allowed',
              fontSize: 13,
              opacity: collapseEnabled ? 1 : 0.5
            }}
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={expandAllChains}
            disabled={!collapseEnabled}
            style={{
              background: '#16a34a',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              cursor: collapseEnabled ? 'pointer' : 'not-allowed',
              fontSize: 13,
              opacity: collapseEnabled ? 1 : 0.5
            }}
          >
            Expand all
          </button>
        </div>
      </div>
    </div>
  );
}
