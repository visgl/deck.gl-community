// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';
import type {ExampleDefinition, ExampleStyles, LayoutType} from './control-panelt';

const LAYOUT_DESCRIPTIONS: Record<LayoutType, string> = {
  'd3-force-layout':
    'Uses a physics-inspired simulation (d3-force) to iteratively spread nodes while balancing attractive and repulsive forces.',
  'gpu-force-layout':
    'Calculates a force-directed layout on the GPU. Ideal for larger graphs that benefit from massively parallel computation.',
  'simple-layout':
    'Places nodes using a deterministic algorithm that is fast to compute and helpful for debugging graph structure.'
};

const LES_MISERABLES_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 9,
      fill: '#60a5fa',
      stroke: '#1d4ed8',
      strokeWidth: 1.5,
      opacity: 0.9
    },
    {
      type: 'label',
      text: (node) => String(node.getId?.() ?? node.id ?? ''),
      color: '#0f172a',
      fontSize: 14,
      offset: [0, 18],
      textAnchor: 'middle',
      alignmentBaseline: 'top',
      scaleWithZoom: false
    }
  ],
  edgeStyle: {
    stroke: '#bfdbfe',
    strokeWidth: 1,
    decorators: []
  }
};

const RANDOM_20_40_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 8,
      fill: '#34d399',
      stroke: '#047857',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edgeStyle: {
    stroke: '#bbf7d0',
    strokeWidth: 1,
    decorators: []
  }
};

const RANDOM_100_200_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 7,
      fill: '#f59e0b',
      stroke: '#b45309',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edgeStyle: {
    stroke: '#fde68a',
    strokeWidth: 1,
    decorators: []
  }
};

const RANDOM_1000_2000_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 6,
      fill: '#818cf8',
      stroke: '#4338ca',
      strokeWidth: 1.5,
      opacity: 0.8
    }
  ],
  edgeStyle: {
    stroke: '#c7d2fe',
    strokeWidth: 1,
    decorators: []
  }
};

const RANDOM_5000_3000_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 5,
      fill: '#f97316',
      stroke: '#9a3412',
      strokeWidth: 1.5,
      opacity: 0.7
    }
  ],
  edgeStyle: {
    stroke: '#fed7aa',
    strokeWidth: 0.8,
    decorators: []
  }
};

const LADDER_10_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 7,
      fill: '#f472b6',
      stroke: '#be185d',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edgeStyle: {
    stroke: '#fbcfe8',
    strokeWidth: 1,
    decorators: []
  }
};

const BALANCED_BIN_TREE_5_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 7,
      fill: '#38bdf8',
      stroke: '#0e7490',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edgeStyle: {
    stroke: '#bae6fd',
    strokeWidth: 1,
    decorators: []
  }
};

const BALANCED_BIN_TREE_8_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 6,
      fill: '#22d3ee',
      stroke: '#0e7490',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edgeStyle: {
    stroke: '#a5f3fc',
    strokeWidth: 1,
    decorators: []
  }
};

const GRID_10_10_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 6,
      fill: '#fbbf24',
      stroke: '#b45309',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edgeStyle: {
    stroke: '#fef3c7',
    strokeWidth: 1,
    decorators: []
  }
};

const WATTS_STROGATZ_STYLE: ExampleStyles = {
  nodeStyle: [
    {
      type: 'circle',
      radius: 6,
      fill: '#fca5a5',
      stroke: '#b91c1c',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edgeStyle: {
    stroke: '#fecaca',
    strokeWidth: 1,
    decorators: []
  }
};

export const EXAMPLES: ExampleDefinition[] = [
  {
    name: 'Random (20, 40)',
    description: 'Randomly connected graph with 20 nodes and 40 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (20, 40)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: RANDOM_20_40_STYLE
  },
  {
    name: 'Les Miserable',
    description: 'Social network of co-occurring characters in Les Miserables by Victor Hugo.',
    data: SAMPLE_GRAPH_DATASETS['Les Miserable'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: LES_MISERABLES_STYLE
  },
  {
    name: 'Random (100, 200)',
    description: 'Random graph with 100 nodes and 200 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (100, 200)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: RANDOM_100_200_STYLE
  },
  {
    name: 'Random (1000, 2000)',
    description: 'Random graph with 1,000 nodes and 2,000 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (1000, 2000)'],
    layouts: ['gpu-force-layout', 'd3-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: RANDOM_1000_2000_STYLE
  },
  {
    name: 'Random (5000, 3000)',
    description: 'Sparse random graph with 5,000 nodes and 3,000 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (5000, 3000)'],
    layouts: ['gpu-force-layout', 'd3-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: RANDOM_5000_3000_STYLE
  },
  {
    name: 'Ladder (10)',
    description: 'Two parallel chains of 10 nodes connected like a ladder.',
    data: SAMPLE_GRAPH_DATASETS['Ladder (10)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: LADDER_10_STYLE
  },
  {
    name: 'BalancedBinTree (5)',
    description: 'Balanced binary tree with branching factor 2 and depth 5.',
    data: SAMPLE_GRAPH_DATASETS['BalancedBinTree (5)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: BALANCED_BIN_TREE_5_STYLE
  },
  {
    name: 'BalancedBinTree (8)',
    description: 'Balanced binary tree with branching factor 2 and depth 8.',
    data: SAMPLE_GRAPH_DATASETS['BalancedBinTree (8)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: BALANCED_BIN_TREE_8_STYLE
  },
  {
    name: 'Grid (10, 10)',
    description: '10x10 lattice grid graph.',
    data: SAMPLE_GRAPH_DATASETS['Grid (10, 10)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: GRID_10_10_STYLE
  },
  {
    name: 'WattsStrogatz (100, 10, 0.06)',
    description:
      'Watts-Strogatz small-world graph with 100 nodes, degree 10 and rewiring probability 0.06.',
    data: SAMPLE_GRAPH_DATASETS['WattsStrogatz (100, 10, 0.06)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: WATTS_STROGATZ_STYLE
  }
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
