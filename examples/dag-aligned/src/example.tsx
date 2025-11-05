// deck.gl-community
// SPDX-License-Identifier: MIT

import React, {useEffect, useMemo, useState} from 'react';
import DeckGL from '@deck.gl/react';
import {COORDINATE_SYSTEM, OrthographicView} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';

import {
  DagAlignedLayout,
  Graph,
  GraphEngine,
  GraphLayer,
  Node,
  Edge,
  type GraphLayerStylesheet
} from '@deck.gl-community/graph-layers';

const ORTHO_VIEW = new OrthographicView({id: 'ortho'});
const HORIZONTAL_GAP = 180;
const VERTICAL_GAP = 60;
const TIME_SCALE = 40;
const BRANCH_COLORS: Record<string, string> = {
  Alpha: '#2563eb',
  Beta: '#0ea5e9'
};
const EDGE_COLOR = '#475569';
const LABEL_COLOR = '#0f172a';

type ExampleNodeData = {
  id: string;
  label: string;
  branch: string;
  step: number;
  elapsed: number;
};

type ExampleEdgeData = {
  id: string;
  source: string;
  target: string;
};

const RAW_NODES: ExampleNodeData[] = [
  {id: 'alpha-0', label: 'Alpha • 0', branch: 'Alpha', step: 0, elapsed: 0},
  {id: 'alpha-1', label: 'Alpha • 1', branch: 'Alpha', step: 1, elapsed: 1},
  {id: 'alpha-2', label: 'Alpha • 2', branch: 'Alpha', step: 2, elapsed: 2},
  {id: 'alpha-3', label: 'Alpha • 3', branch: 'Alpha', step: 3, elapsed: 3},
  {id: 'beta-0', label: 'Beta • 0', branch: 'Beta', step: 0, elapsed: 0},
  {id: 'beta-1', label: 'Beta • 1', branch: 'Beta', step: 1, elapsed: 2},
  {id: 'beta-2', label: 'Beta • 2', branch: 'Beta', step: 2, elapsed: 4},
  {id: 'beta-3', label: 'Beta • 3', branch: 'Beta', step: 3, elapsed: 6}
];

const RAW_EDGES: ExampleEdgeData[] = [
  {id: 'alpha-0-1', source: 'alpha-0', target: 'alpha-1'},
  {id: 'alpha-1-2', source: 'alpha-1', target: 'alpha-2'},
  {id: 'alpha-2-3', source: 'alpha-2', target: 'alpha-3'},
  {id: 'beta-0-1', source: 'beta-0', target: 'beta-1'},
  {id: 'beta-1-2', source: 'beta-1', target: 'beta-2'},
  {id: 'beta-2-3', source: 'beta-2', target: 'beta-3'}
];

const MAX_RANK = RAW_NODES.reduce((max, node) => Math.max(max, node.step), 0);

function buildGraph(): Graph {
  const nodes = RAW_NODES.map((node) => new Node({id: node.id, data: node}));
  const edges = RAW_EDGES.map((edge) =>
    new Edge({id: edge.id, sourceId: edge.source, targetId: edge.target, directed: true, data: edge})
  );
  return new Graph({nodes, edges});
}

function buildStretchedScale(): (rank: number) => number {
  const maxElapsedByRank = new Map<number, number>();
  for (const node of RAW_NODES) {
    const current = maxElapsedByRank.get(node.step);
    maxElapsedByRank.set(node.step, current === undefined ? node.elapsed : Math.max(current, node.elapsed));
  }
  const sorted = Array.from(maxElapsedByRank.entries()).sort((a, b) => a[0] - b[0]);
  let last = 0;
  const mapping = new Map<number, number>();
  for (const [rank, elapsed] of sorted) {
    const scaled = elapsed * TIME_SCALE;
    const value = rank === 0 ? 0 : Math.max(scaled, last + TIME_SCALE);
    mapping.set(rank, value);
    last = value;
  }
  return (rank: number) => mapping.get(rank) ?? rank * VERTICAL_GAP;
}

function buildGridLines(scale: (rank: number) => number) {
  const width = 400;
  return Array.from({length: MAX_RANK + 1}, (_, rank) => {
    const y = scale(rank);
    return {
      id: `grid-${rank}`,
      source: [-width, -y],
      target: [width, -y]
    };
  });
}

export function App(): JSX.Element {
  const [stretched, setStretched] = useState(true);

  const graph = useMemo(() => buildGraph(), []);
  const stretchedScale = useMemo(() => buildStretchedScale(), []);
  const currentScale = useMemo<((rank: number) => number) | undefined>(
    () => (stretched ? stretchedScale : undefined),
    [stretched, stretchedScale]
  );

  const stylesheet = useMemo<GraphLayerStylesheet>(
    () => ({
      nodes: [
        {
          type: 'circle',
          radius: 16,
          fill: {
            attribute: 'branch',
            scale: {
              type: 'ordinal',
              domain: Object.keys(BRANCH_COLORS),
              range: Object.keys(BRANCH_COLORS).map((branch) => BRANCH_COLORS[branch])
            }
          },
          stroke: '#0f172a',
          strokeWidth: 2
        },
        {
          type: 'label',
          text: '@label',
          color: LABEL_COLOR,
          fontSize: 14,
          offset: [0, -28]
        }
      ],
      edges: {
        type: 'edge',
        stroke: EDGE_COLOR,
        strokeWidth: 2
      }
    }),
    []
  );

  const layout = useMemo(() => {
    const dagLayout = new DagAlignedLayout({
      rank: (node) => (node.getPropertyValue('step') as number),
      yScale: currentScale,
      gap: [HORIZONTAL_GAP, VERTICAL_GAP]
    });
    return dagLayout;
  }, [currentScale]);

  const engine = useMemo(() => new GraphEngine({graph, layout}), [graph, layout]);

  useEffect(() => {
    engine.run();
    return () => {
      engine.stop();
      engine.clear();
    };
  }, [engine]);

  const gridLines = useMemo(() => {
    const scale = currentScale ?? ((rank: number) => rank * VERTICAL_GAP);
    return buildGridLines(scale);
  }, [currentScale]);

  const layers = useMemo(() => {
    const gridLayer = new LineLayer({
      id: 'dag-grid',
      data: gridLines,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getSourcePosition: (d) => d.source,
      getTargetPosition: (d) => d.target,
      getColor: [200, 200, 200, 80],
      getWidth: 1
    });

    const graphLayer = new GraphLayer({
      id: 'dag-graph',
      engine,
      enableDragging: false,
      stylesheet
    });

    return [gridLayer, graphLayer];
  }, [engine, gridLines, stylesheet]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
        color: '#0f172a',
        background: '#f8fafc'
      }}
    >
      <header
        style={{
          padding: '1rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #e2e8f0'
        }}
      >
        <div>
          <h1 style={{margin: 0, fontSize: '1.125rem'}}>Rank-Aligned DAG Layout</h1>
          <p style={{margin: 0, fontSize: '0.875rem', color: '#475569'}}>
            Toggle the spacing mode to keep branches aligned by discrete steps or stretch layers to reflect elapsed time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStretched((value) => !value)}
          style={{
            borderRadius: '999px',
            border: '1px solid #334155',
            background: stretched ? '#334155' : '#f1f5f9',
            color: stretched ? '#f8fafc' : '#334155',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            cursor: 'pointer'
          }}
        >
          {stretched ? 'Use uniform spacing' : 'Stretch by elapsed time'}
        </button>
      </header>
      <DeckGL
        views={ORTHO_VIEW}
        initialViewState={{target: [0, 0, 0], zoom: -1}}
        controller={{dragPan: true, dragRotate: false, scrollZoom: true}}
        layers={layers}
        style={{flex: 1}}
      />
    </div>
  );
}
