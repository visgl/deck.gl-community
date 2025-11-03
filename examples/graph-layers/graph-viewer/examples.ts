// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';
import type {ExampleDefinition, ExampleStyles, LayoutType} from './control-panel';
import witsRaw from '../../../modules/graph-layers/test/data/examples/wits.json';
import sampleMultiGraph from './sample-multi-graph.json';

type ExampleGraphData = {nodes: unknown[]; edges: unknown[]};

const MULTI_GRAPH_SAMPLE = sampleMultiGraph as ExampleGraphData & {
  nodes: Array<{id: string; type?: string; star?: boolean}>;
  edges: Array<{id: string; sourceId: string; targetId: string; type?: string}>;
};

type RawWitsNode = {
  name: string;
  group: number;
  size: number;
  others?: string;
};

type RawWitsEdge = {
  source: number;
  target: number;
  value: number;
};

type RawWitsTreeNode = {
  id: string;
  children?: string[];
};

type RawWitsDataset = {
  nodes: RawWitsNode[];
  edges: RawWitsEdge[];
  tree: RawWitsTreeNode[];
};

const WITS_DATASET = witsRaw as RawWitsDataset;

const parseWitsMetadata = (value: string | undefined): Record<string, string> => {
  if (!value) {
    return {};
  }

  return value
    .split('`')
    .map((entry) => entry.split('~'))
    .reduce((acc, [key, raw]) => {
      if (!key || !raw) {
        return acc;
      }

      const trimmedKey = key.trim();
      const trimmedValue = raw.trim();
      if (trimmedKey.length) {
        acc[trimmedKey] = trimmedValue;
      }
      return acc;
    }, {} as Record<string, string>);
};

const WITS_BASE_NODES = (WITS_DATASET.nodes ?? []).map((node) => {
  const attributes = parseWitsMetadata(node.others);
  const region = attributes.RegionName ?? 'Other';

  return {
    id: node.name,
    name: node.name,
    group: node.group,
    size: node.size,
    region,
    iso3: attributes.iso3,
    attributes
  };
});

const WITS_BASE_EDGES = (WITS_DATASET.edges ?? [])
  .map((edge, index) => {
    const source = WITS_BASE_NODES[edge.source];
    const target = WITS_BASE_NODES[edge.target];

    if (!source || !target) {
      return null;
    }

    return {
      id: `wits-${index}`,
      sourceId: source.id,
      targetId: target.id,
      weight: edge.value
    };
  })
  .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));

const WITS_GRAPH_DATA: ExampleGraphData = {
  nodes: WITS_BASE_NODES,
  edges: WITS_BASE_EDGES
};

const WITS_TREE = (WITS_DATASET.tree ?? []) as ReadonlyArray<RawWitsTreeNode>;

const WITS_REGIONS = Array.from(
  new Set(WITS_BASE_NODES.map((node) => node.region ?? 'Other'))
);

const WITS_REGION_COLORS = [
  '#1d4ed8',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#f97316',
  '#f43f5e',
  '#a855f7',
  '#6366f1'
];

const WITS_REGION_COLOR_MAP: Record<string, string> = WITS_REGIONS.reduce((acc, region, index) => {
  acc[region] = WITS_REGION_COLORS[index % WITS_REGION_COLORS.length];
  return acc;
}, {} as Record<string, string>);

const WITS_REGION_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: {
        attribute: 'size',
        fallback: 4,
        scale: (value: unknown) => {
          const size = Number(value);
          if (!Number.isFinite(size)) {
            return 4;
          }
          return Math.max(3.5, Math.sqrt(size));
        }
      },
      fill: {
        attribute: 'region',
        fallback: '#475569',
        scale: (region: unknown) =>
          WITS_REGION_COLOR_MAP[String(region)] ?? '#475569'
      },
      stroke: '#0f172a',
      strokeWidth: 0.75,
      opacity: 0.85
    }
  ],
  edges: {
    stroke: 'rgba(15, 23, 42, 0.2)',
    strokeWidth: 0.4,
    decorators: [
      {
        type: 'flow',
        color: {
          default: 'rgba(14, 165, 233, 0.7)',
          hover: '#0ea5e9'
        },
        width: {
          attribute: 'weight',
          fallback: 1,
          scale: (value: unknown) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) {
              return 1;
            }
            return Math.max(1, Math.sqrt(numericValue));
          }
        },
        speed: {
          attribute: 'weight',
          fallback: 0,
          scale: (value: unknown) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) {
              return 0;
            }
            return Math.sqrt(numericValue) / 2;
          }
        },
        tailLength: 6
      }
    ]
  }
};

const KNOWLEDGE_GRAPH = {
  nodes: [
    {id: 'University', name: 'University', group: 'Overview'},
    {id: 'Sciences', name: 'Sciences', group: 'Science'},
    {id: 'Humanities', name: 'Humanities', group: 'Humanities'},
    {id: 'Professional Studies', name: 'Professional Studies', group: 'Professional'},
    {id: 'Research Labs', name: 'Research Labs', group: 'Science'},
    {id: 'Data Science', name: 'Data Science', group: 'Science'},
    {id: 'Applied Physics', name: 'Applied Physics', group: 'Science'},
    {id: 'Studio Art', name: 'Studio Art', group: 'Humanities'},
    {id: 'Design Thinking', name: 'Design Thinking', group: 'Humanities'},
    {id: 'Field Work', name: 'Field Work', group: 'Professional'},
    {id: 'Medical Center', name: 'Medical Center', group: 'Professional'},
    {id: 'Entrepreneurship Hub', name: 'Entrepreneurship Hub', group: 'Business'},
    {id: 'Finance Department', name: 'Finance Department', group: 'Business'},
    {id: 'Economics Department', name: 'Economics Department', group: 'Business'}
  ],
  edges: [
    {id: 'e-0', sourceId: 'University', targetId: 'Sciences', type: 'supports'},
    {id: 'e-1', sourceId: 'University', targetId: 'Humanities', type: 'supports'},
    {id: 'e-2', sourceId: 'University', targetId: 'Professional Studies', type: 'supports'},
    {id: 'e-3', sourceId: 'Sciences', targetId: 'Research Labs', type: 'manages'},
    {id: 'e-4', sourceId: 'Sciences', targetId: 'Data Science', type: 'collaborates'},
    {id: 'e-5', sourceId: 'Sciences', targetId: 'Applied Physics', type: 'collaborates'},
    {id: 'e-6', sourceId: 'Humanities', targetId: 'Studio Art', type: 'mentors'},
    {id: 'e-7', sourceId: 'Humanities', targetId: 'Design Thinking', type: 'mentors'},
    {id: 'e-8', sourceId: 'Professional Studies', targetId: 'Field Work', type: 'coordinates'},
    {id: 'e-9', sourceId: 'Professional Studies', targetId: 'Medical Center', type: 'coordinates'},
    {id: 'e-10', sourceId: 'Professional Studies', targetId: 'Entrepreneurship Hub', type: 'coordinates'},
    {id: 'e-11', sourceId: 'Entrepreneurship Hub', targetId: 'Finance Department', type: 'incubates'},
    {id: 'e-12', sourceId: 'Entrepreneurship Hub', targetId: 'Economics Department', type: 'incubates'},
    {id: 'e-13', sourceId: 'Data Science', targetId: 'Entrepreneurship Hub', type: 'partners'},
    {id: 'e-14', sourceId: 'Applied Physics', targetId: 'Medical Center', type: 'supports'},
    {id: 'e-15', sourceId: 'Design Thinking', targetId: 'Entrepreneurship Hub', type: 'advises'}
  ],
  tree: [
    {id: 'University', children: ['Sciences', 'Humanities', 'Professional Studies']},
    {id: 'Sciences', children: ['Research Labs', 'Data Science', 'Applied Physics']},
    {id: 'Humanities', children: ['Studio Art', 'Design Thinking']},
    {
      id: 'Professional Studies',
      children: ['Field Work', 'Medical Center', 'Entrepreneurship Hub']
    },
    {id: 'Entrepreneurship Hub', children: ['Finance Department', 'Economics Department']},
    {id: 'Research Labs'},
    {id: 'Data Science'},
    {id: 'Applied Physics'},
    {id: 'Studio Art'},
    {id: 'Design Thinking'},
    {id: 'Field Work'},
    {id: 'Medical Center'},
    {id: 'Finance Department'},
    {id: 'Economics Department'}
  ]
} as const;

const GROUP_COLOR_MAP: Record<string, string> = {
  Overview: '#64748b',
  Science: '#0ea5e9',
  Humanities: '#a855f7',
  Professional: '#f59e0b',
  Business: '#10b981'
};

const DEFAULT_EDGE_COLOR = 'rgba(80, 80, 80, 0.3)';

const cloneGraphData = (data: ExampleGraphData): ExampleGraphData => ({
  nodes: data.nodes.map((node) => ({...node})),
  edges: data.edges.map((edge) => ({...edge}))
});

const cloneTree = <T extends {id: string; children?: readonly string[]}>(
  tree: readonly T[]
): T[] => tree.map((node) => ({...node, children: node.children ? [...node.children] : undefined})) as T[];

const LAYOUT_DESCRIPTIONS: Record<LayoutType, string> = {
  'd3-force-layout':
    'Uses a physics-inspired simulation (d3-force) to iteratively spread nodes while balancing attractive and repulsive forces.',
  'gpu-force-layout':
    'Calculates a force-directed layout on the GPU. Ideal for larger graphs that benefit from massively parallel computation.',
  'simple-layout':
    'Places nodes using a deterministic algorithm that is fast to compute and helpful for debugging graph structure.',
  'radial-layout':
    'Arranges nodes around concentric circles derived from a hierarchy, making parent-child relationships easy to read.',
  'hive-plot-layout':
    'Positions nodes along axes grouped by a property and draws curved connections between axes to reduce visual clutter.',
  'force-multi-graph-layout':
    'Runs a tailored force simulation that keeps parallel edges legible by introducing virtual edges and spacing overlapping links.',
  'd3-dag-layout':
    'Builds a directed acyclic graph layout using layered sugiyama algorithms with automatic edge routing and arrow decoration.'
};

const LES_MISERABLES_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: {
        default: 9,
        hover: 11,
        selected: 12
      },
      fill: {
        default: '#60a5fa',
        hover: '#2563eb',
        selected: '#f97316'
      },
      stroke: {
        default: '#1d4ed8',
        hover: '#1e3a8a',
        selected: '#c2410c'
      },
      strokeWidth: {
        default: 1.5,
        hover: 3,
        selected: 3.5
      },
      opacity: {
        default: 0.9,
        hover: 1,
        selected: 1
      }
    },
    {
      type: 'label',
      text: '@id',
      color: '#0f172a',
      fontSize: 14,
      offset: [0, 18],
      textAnchor: 'middle',
      alignmentBaseline: 'top',
      scaleWithZoom: false
    }
  ],
  edges: {
    stroke: {
      default: '#bfdbfe',
      hover: '#2563eb',
      selected: '#f97316'
    },
    strokeWidth: {
      default: 1,
      hover: 3,
      selected: 3.5
    },
    decorators: []
  }
};

const RANDOM_20_40_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 8,
      fill: '#34d399',
      stroke: '#047857',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edges: {
    stroke: '#bbf7d0',
    strokeWidth: 1,
    decorators: []
  }
};

const RANDOM_100_200_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 7,
      fill: '#f59e0b',
      stroke: '#b45309',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edges: {
    stroke: '#fde68a',
    strokeWidth: 1,
    decorators: []
  }
};

const RANDOM_1000_2000_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 6,
      fill: '#818cf8',
      stroke: '#4338ca',
      strokeWidth: 1.5,
      opacity: 0.8
    }
  ],
  edges: {
    stroke: '#c7d2fe',
    strokeWidth: 1,
    decorators: []
  }
};

const RANDOM_5000_3000_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 5,
      fill: '#f97316',
      stroke: '#9a3412',
      strokeWidth: 1.5,
      opacity: 0.7
    }
  ],
  edges: {
    stroke: '#fed7aa',
    strokeWidth: 0.8,
    decorators: []
  }
};

const LADDER_10_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 7,
      fill: '#f472b6',
      stroke: '#be185d',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edges: {
    stroke: '#fbcfe8',
    strokeWidth: 1,
    decorators: []
  }
};

const BALANCED_BIN_TREE_5_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 7,
      fill: '#38bdf8',
      stroke: '#0e7490',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edges: {
    stroke: '#bae6fd',
    strokeWidth: 1,
    decorators: []
  }
};

const BALANCED_BIN_TREE_8_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 6,
      fill: '#22d3ee',
      stroke: '#0e7490',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edges: {
    stroke: '#a5f3fc',
    strokeWidth: 1,
    decorators: []
  }
};

const GRID_10_10_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 6,
      fill: '#fbbf24',
      stroke: '#b45309',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edges: {
    stroke: '#fef3c7',
    strokeWidth: 1,
    decorators: []
  }
};

const WATTS_STROGATZ_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 6,
      fill: '#fca5a5',
      stroke: '#b91c1c',
      strokeWidth: 1.5,
      opacity: 0.9
    }
  ],
  edges: {
    stroke: '#fecaca',
    strokeWidth: 1,
    decorators: []
  }
};

const KNOWLEDGE_GRAPH_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 7,
      fill: {
        attribute: 'group',
        fallback: '#94a3b8',
        scale: (group: unknown) => GROUP_COLOR_MAP[String(group)] ?? '#94a3b8'
      },
      stroke: '#0f172a',
      strokeWidth: 1.25,
      opacity: 0.95
    },
    {
      type: 'label',
      text: {attribute: 'name', fallback: ''},
      color: '#334155',
      fontSize: 12,
      textAnchor: 'start',
      offset: [10, 0],
      alignmentBaseline: 'middle',
      scaleWithZoom: false
    }
  ],
  edges: {
    stroke: DEFAULT_EDGE_COLOR,
    strokeWidth: 1,
    decorators: []
  }
};

const MULTI_GRAPH_STYLE: ExampleStyles = {
  nodes: [
    {
      type: 'circle',
      radius: 40,
      fill: 'rgb(240, 240, 240)'
    },
    {
      type: 'circle',
      radius: 30,
      fill: '#cf4569'
    },
    {
      type: 'circle',
      radius: {
        attribute: 'star',
        fallback: false,
        scale: (isStar: unknown) => (isStar ? 6 : 0)
      },
      fill: [255, 255, 0],
      offset: [18, -18]
    },
    {
      type: 'label',
      text: '@id',
      color: [255, 255, 255],
      fontSize: 14,
      textAnchor: 'middle',
      alignmentBaseline: 'middle',
      scaleWithZoom: false
    }
  ],
  edges: {
    stroke: '#cf4569',
    strokeWidth: 2,
    decorators: [
      {
        type: 'edge-label',
        text: {attribute: 'type', fallback: ''},
        color: [0, 0, 0],
        fontSize: 14
      }
    ]
  }
};

const dagPipelineDataset = () => {
  const nodes = DAG_PIPELINE_DATA.map((entry) => ({id: entry.id, label: entry.label}));
  const edges = [] as {id: string; sourceId: string; targetId: string; directed: boolean}[];

  for (const entry of DAG_PIPELINE_DATA) {
    if (!entry.parentIds) {
      continue;
    }
    for (const parentId of entry.parentIds) {
      edges.push({
        id: `${parentId}->${entry.id}`,
        sourceId: parentId,
        targetId: entry.id,
        directed: true
      });
    }
  }

  return {nodes, edges};
};

type DagRecord = {
  id: string;
  label: string;
  parentIds?: string[];
};

const DAG_PIPELINE_DATA: DagRecord[] = [
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

const DAG_PIPELINE_STYLE: ExampleStyles = {
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
  edges: {
    stroke: '#8da2fb',
    strokeWidth: 2,
    decorators: [
      {
        type: 'arrow',
        size: 6,
        color: '#8da2fb'
      }
    ]
  }
};

export const EXAMPLES: ExampleDefinition[] = [
  {
    name: 'Les Miserable',
    description: 'Social network of co-occurring characters in Les Miserables by Victor Hugo.',
    data: SAMPLE_GRAPH_DATASETS['Les Miserable'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: LES_MISERABLES_STYLE
  },
  {
    name: 'Random (20, 40)',
    description: 'Randomly connected graph with 20 nodes and 40 edges.',
    data: SAMPLE_GRAPH_DATASETS['Random (20, 40)'],
    layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: RANDOM_20_40_STYLE
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
  },
  {
    name: 'University hierarchy (radial)',
    description:
      'Synthetic university organisational network demonstrating how hierarchical relationships expand from a central hub.',
    data: () => cloneGraphData(KNOWLEDGE_GRAPH),
    layouts: ['radial-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: KNOWLEDGE_GRAPH_STYLE,
    getLayoutOptions: (layout, _data) =>
      layout === 'radial-layout'
        ? {
            radius: 380,
            tree: cloneTree(KNOWLEDGE_GRAPH.tree)
          }
        : undefined
  },
  {
    name: 'World trade (radial, graph.gl)',
    description:
      'Recreates the original graph.gl radial layout example using World Integrated Trade Solution partner flows grouped by region.',
    data: () => cloneGraphData(WITS_GRAPH_DATA),
    layouts: ['radial-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: WITS_REGION_STYLE,
    getLayoutOptions: (layout, _data) =>
      layout === 'radial-layout'
        ? {
            radius: 520,
            tree: cloneTree(WITS_TREE)
          }
        : undefined
  },
  {
    name: 'University hierarchy (hive plot)',
    description:
      'The same organisational network arranged along hive plot axes to highlight connections between disciplines.',
    data: () => cloneGraphData(KNOWLEDGE_GRAPH),
    layouts: ['hive-plot-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: KNOWLEDGE_GRAPH_STYLE,
    getLayoutOptions: (layout, _data) =>
      layout === 'hive-plot-layout'
        ? {
            innerRadius: 60,
            outerRadius: 220,
            getNodeAxis: (node: any) => node?.getPropertyValue?.('group') ?? 'Overview'
          }
        : undefined
  },
  {
    name: 'World trade (hive plot, graph.gl)',
    description:
      'Original graph.gl hive plot demo data visualising international trade communities grouped by their regional bloc.',
    data: () => cloneGraphData(WITS_GRAPH_DATA),
    layouts: ['hive-plot-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: WITS_REGION_STYLE,
    getLayoutOptions: (layout, _data) =>
      layout === 'hive-plot-layout'
        ? {
            innerRadius: 90,
            outerRadius: 420,
            getNodeAxis: (node: any) => node?.getPropertyValue?.('region') ?? 'Other'
          }
        : undefined
  },
  {
    name: 'Community multi-graph',
    description:
      'A compact social network with multiple edge types between the same people rendered using the force multi-graph layout.',
    data: () => cloneGraphData(MULTI_GRAPH_SAMPLE),
    layouts: ['force-multi-graph-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: MULTI_GRAPH_STYLE,
    getLayoutOptions: (layout, _data) =>
      layout === 'force-multi-graph-layout'
        ? {
            nBodyStrength: -8000,
            nBodyDistanceMin: 80,
            nBodyDistanceMax: 1200
          }
        : undefined
  },
  {
    name: 'World trade (force multi-graph, graph.gl)',
    description:
      'Applies the force multi-graph layout to the graph.gl WITS dataset to emphasise dense trade corridors and minimise overlapping links.',
    data: () => cloneGraphData(WITS_GRAPH_DATA),
    layouts: ['force-multi-graph-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: WITS_REGION_STYLE,
    getLayoutOptions: (layout, _data) =>
      layout === 'force-multi-graph-layout'
        ? {
            alpha: 2.5,
            nBodyStrength: -6000,
            nBodyDistanceMin: 40,
            nBodyDistanceMax: 1200
          }
        : undefined
  }, 
  {
    name: 'ML Pipeline DAG',
    description:
      'Directed acyclic graph of a simplified machine-learning pipeline with dependencies between each processing stage.',
    data: dagPipelineDataset,
    layouts: ['d3-dag-layout'],
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    style: DAG_PIPELINE_STYLE
  }
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
