// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';
import type {ExampleDefinition, LayoutType} from './control-panelt';

import lesMiserablesStyle from './styles/les-miserables';
import random2040Style from './styles/random-20-40';
import random100200Style from './styles/random-100-200';
import random10002000Style from './styles/random-1000-2000';
import random50003000Style from './styles/random-5000-3000';
import ladder10Style from './styles/ladder-10';
import balancedBinTree5Style from './styles/balanced-bintree-5';
import balancedBinTree8Style from './styles/balanced-bintree-8';
import grid1010Style from './styles/grid-10-10';
import wattsStrogatzStyle from './styles/watts-strogatz-100-10-006';

const LAYOUT_DESCRIPTIONS: Record<LayoutType, string> = {
  'd3-force-layout':
    'Uses a physics-inspired simulation (d3-force) to iteratively spread nodes while balancing attractive and repulsive forces.',
  'gpu-force-layout':
    'Calculates a force-directed layout on the GPU. Ideal for larger graphs that benefit from massively parallel computation.',
  'simple-layout': 'Places nodes with a lightweight deterministic layout useful for quick previews and debugging.'
};

export const EXAMPLES: ExampleDefinition[] = [
  {
    name: 'Les Miserable',
    description: 'Social network of co-occurring characters in Les Miserables by Victor Hugo.',
    data: SAMPLE_GRAPH_DATASETS['Les Miserable'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: lesMiserablesStyle
  },
  {
    name: 'Random (20, 40)',
    description: 'Randomly connected graph with 20 nodes and 40 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (20, 40)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: random2040Style
  },
  {
    name: 'Random (100, 200)',
    description: 'Random graph with 100 nodes and 200 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (100, 200)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: random100200Style
  },
  {
    name: 'Random (1000, 2000)',
    description: 'Random graph with 1,000 nodes and 2,000 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (1000, 2000)'],
    layouts: ['gpu-force-layout', 'd3-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: random10002000Style
  },
  {
    name: 'Random (5000, 3000)',
    description: 'Sparse random graph with 5,000 nodes and 3,000 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (5000, 3000)'],
    layouts: ['gpu-force-layout', 'd3-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: random50003000Style
  },
  {
    name: 'Ladder (10)',
    description: 'Two parallel chains of 10 nodes connected like a ladder.',
    data: SAMPLE_GRAPH_DATASETS['Ladder (10)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: ladder10Style
  },
  {
    name: 'BalancedBinTree (5)',
    description: 'Balanced binary tree with branching factor 2 and depth 5.',
    data: SAMPLE_GRAPH_DATASETS['BalancedBinTree (5)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: balancedBinTree5Style
  },
  {
    name: 'BalancedBinTree (8)',
    description: 'Balanced binary tree with branching factor 2 and depth 8.',
    data: SAMPLE_GRAPH_DATASETS['BalancedBinTree (8)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: balancedBinTree8Style
  },
  {
    name: 'Grid (10, 10)',
    description: '10x10 lattice grid graph.',
    data: SAMPLE_GRAPH_DATASETS['Grid (10, 10)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: grid1010Style
  },
  {
    name: 'WattsStrogatz (100, 10, 0.06)',
    description: 'Watts-Strogatz small-world graph with 100 nodes, degree 10 and rewiring probability 0.06.',
    data: SAMPLE_GRAPH_DATASETS['WattsStrogatz (100, 10, 0.06)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: wattsStrogatzStyle
  }
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
