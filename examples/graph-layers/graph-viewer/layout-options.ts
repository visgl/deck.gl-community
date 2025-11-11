// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphLayerProps} from '@deck.gl-community/graph-layers';
import {
  D3DagLayout,
  D3ForceLayout,
  GPUForceLayout,
  ForceMultiGraphLayout,
  RadialLayout,
  HivePlotLayout
} from '@deck.gl-community/graph-layers';
import type {NumberPropDescription, PropDescription} from './props-form';

export type GraphExampleType = 'graph' | 'radial' | 'multi-graph' | 'hive' | 'dag';

export type LayoutType =
  | 'd3-force-layout'
  | 'gpu-force-layout'
  | 'simple-layout'
  | 'radial-layout'
  | 'hive-plot-layout'
  | 'force-multi-graph-layout'
  | 'd3-dag-layout';

export type ExampleStyles = NonNullable<GraphLayerProps['stylesheet']>;

export type ExampleGraphData = {nodes: unknown[]; edges: unknown[]};

export type ExampleMetadata = {
  nodeCount?: number;
  edgeCount?: number;
  graphId?: string;
  directed?: boolean;
  strict?: boolean;
  attributes?: Record<string, unknown>;
  sourceType?: 'inline' | 'remote';
};

export type ExampleLayoutContext = {
  data?: ExampleGraphData;
  metadata?: ExampleMetadata;
};

type ExampleDefinitionBase = {
  name: string;
  description: string;
  type: GraphExampleType;
  /** First listed layout is the default */
  layouts: LayoutType[];
  layoutDescriptions: Record<LayoutType, string>;
  style: ExampleStyles;
  graphLoader?: GraphLayerProps['graphLoader'];
  getLayoutOptions?: (
    layout: LayoutType,
    context: ExampleLayoutContext
  ) => Record<string, unknown> | undefined;
};

type InlineExampleDefinition = ExampleDefinitionBase & {
  data: () => ExampleGraphData;
  dataUrl?: undefined;
  loaders?: undefined;
  loadOptions?: undefined;
};

type RemoteExampleDefinition = ExampleDefinitionBase & {
  data?: undefined;
  dataUrl: string;
  loaders?: GraphLayerProps['loaders'];
  loadOptions?: GraphLayerProps['loadOptions'];
};

export type ExampleDefinition = InlineExampleDefinition | RemoteExampleDefinition;

export const LAYOUT_LABELS: Record<LayoutType, string> = {
  'd3-force-layout': 'D3 Force Layout',
  'gpu-force-layout': 'GPU Force Layout',
  'simple-layout': 'Simple Layout',
  'radial-layout': 'Radial Layout',
  'hive-plot-layout': 'Hive Plot Layout',
  'force-multi-graph-layout': 'Force Multi-Graph Layout',
  'd3-dag-layout': 'D3 DAG Layout'
};

const NUMBER_FALLBACK = (value: unknown, fallback: number): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const D3_FORCE_DEFAULT_OPTIONS = D3ForceLayout.defaultProps;
export const GPU_FORCE_DEFAULT_OPTIONS = GPUForceLayout.defaultProps;
export const FORCE_MULTI_GRAPH_DEFAULT_OPTIONS = ForceMultiGraphLayout.defaultProps;
export const RADIAL_DEFAULT_OPTIONS = {
  radius: RadialLayout.defaultProps.radius
} as const;
export const HIVE_PLOT_DEFAULT_OPTIONS = {
  innerRadius: HivePlotLayout.defaultProps.innerRadius,
  outerRadius: HivePlotLayout.defaultProps.outerRadius
} as const;
export const DAG_DEFAULT_OPTIONS = D3DagLayout.defaultProps;

export type ForceLayoutNumericKey = keyof typeof D3_FORCE_DEFAULT_OPTIONS;
export type ForceLayoutFormState = Record<ForceLayoutNumericKey, number>;

export type ForceMultiGraphLayoutNumericKey = keyof typeof FORCE_MULTI_GRAPH_DEFAULT_OPTIONS;
export type ForceMultiGraphLayoutFormState = Record<ForceMultiGraphLayoutNumericKey, number>;

export type RadialLayoutFormState = typeof RADIAL_DEFAULT_OPTIONS;

export type HivePlotLayoutFormState = typeof HIVE_PLOT_DEFAULT_OPTIONS;

export const FORCE_LAYOUT_PROP_DESCRIPTIONS = {
  alpha: {type: 'number', title: 'Alpha', step: 0.1},
  resumeAlpha: {type: 'number', title: 'Resume alpha', step: 0.1},
  nBodyStrength: {type: 'number', title: 'N-body strength'},
  nBodyDistanceMin: {type: 'number', title: 'N-body distance min'},
  nBodyDistanceMax: {type: 'number', title: 'N-body distance max'},
  getCollisionRadius: {type: 'number', title: 'Collision radius'}
} as const satisfies Record<ForceLayoutNumericKey, NumberPropDescription<ForceLayoutFormState>>;

const FORCE_LAYOUT_KEYS = Object.keys(FORCE_LAYOUT_PROP_DESCRIPTIONS) as ForceLayoutNumericKey[];

export const FORCE_MULTI_GRAPH_PROP_DESCRIPTIONS = {
  alpha: {type: 'number', title: 'Alpha', step: 0.1},
  nBodyStrength: {type: 'number', title: 'N-body strength'},
  nBodyDistanceMin: {type: 'number', title: 'N-body distance min'},
  nBodyDistanceMax: {type: 'number', title: 'N-body distance max'}
} as const satisfies Record<
  ForceMultiGraphLayoutNumericKey,
  NumberPropDescription<ForceMultiGraphLayoutFormState>
>;

const FORCE_MULTI_GRAPH_KEYS = Object.keys(
  FORCE_MULTI_GRAPH_PROP_DESCRIPTIONS
) as ForceMultiGraphLayoutNumericKey[];

export const RADIAL_LAYOUT_PROP_DESCRIPTIONS = {
  radius: {type: 'number', title: 'Radius', min: 0}
} as const satisfies Record<keyof RadialLayoutFormState, NumberPropDescription<RadialLayoutFormState>>;

export const HIVE_PLOT_PROP_DESCRIPTIONS = {
  innerRadius: {
    type: 'number',
    title: 'Inner radius',
    min: 0,
    max: (values: HivePlotLayoutFormState) => values.outerRadius
  },
  outerRadius: {
    type: 'number',
    title: 'Outer radius',
    min: (values: HivePlotLayoutFormState) => values.innerRadius
  }
} as const satisfies Record<keyof HivePlotLayoutFormState, NumberPropDescription<HivePlotLayoutFormState>>;

export type DagNodeRankOption = 'none' | 'rank';

export type DagLayoutFormState = {
  layout: 'sugiyama' | 'grid' | 'zherebko';
  layering: 'simplex' | 'longestPath' | 'topological';
  nodeRank: DagNodeRankOption;
  decross: 'twoLayer' | 'opt' | 'dfs';
  coord: 'simplex' | 'greedy' | 'quad' | 'center' | 'topological';
  orientation: 'TB' | 'BT' | 'LR' | 'RL';
  dagBuilder: 'graph' | 'connect' | 'stratify';
  centerX: boolean;
  centerY: boolean;
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  separationX: number;
  separationY: number;
};

export const DAG_LAYOUT_PROP_DESCRIPTIONS = {
  layout: {
    type: 'select',
    title: 'Layout operator',
    options: [
      {value: 'sugiyama', label: 'Sugiyama'},
      {value: 'grid', label: 'Grid'},
      {value: 'zherebko', label: 'Zherebko'}
    ] as const
  },
  layering: {
    type: 'select',
    title: 'Layering',
    options: [
      {value: 'topological', label: 'Topological'},
      {value: 'longestPath', label: 'Longest path'},
      {value: 'simplex', label: 'Simplex'}
    ] as const
  },
  nodeRank: {
    type: 'select',
    title: 'Node rank',
    options: [
      {value: 'none', label: 'Automatic'},
      {value: 'rank', label: 'Use node.rank'}
    ] as const
  },
  decross: {
    type: 'select',
    title: 'Decross',
    options: [
      {value: 'twoLayer', label: 'Two layer'},
      {value: 'opt', label: 'Opt'},
      {value: 'dfs', label: 'DFS'}
    ] as const
  },
  coord: {
    type: 'select',
    title: 'Coordinate assignment',
    options: [
      {value: 'greedy', label: 'Greedy'},
      {value: 'simplex', label: 'Simplex'},
      {value: 'quad', label: 'Quad'},
      {value: 'center', label: 'Center'},
      {value: 'topological', label: 'Topological'}
    ] as const
  },
  orientation: {
    type: 'select',
    title: 'Orientation',
    options: [
      {value: 'TB', label: 'Top to bottom'},
      {value: 'BT', label: 'Bottom to top'},
      {value: 'LR', label: 'Left to right'},
      {value: 'RL', label: 'Right to left'}
    ] as const
  },
  dagBuilder: {
    type: 'select',
    title: 'DAG builder',
    options: [
      {value: 'graph', label: 'Graph'},
      {value: 'connect', label: 'Connect'},
      {value: 'stratify', label: 'Stratify'}
    ] as const
  },
  nodeWidth: {type: 'number', title: 'Node width'},
  nodeHeight: {type: 'number', title: 'Node height'},
  gapX: {type: 'number', title: 'Gap X'},
  gapY: {type: 'number', title: 'Gap Y'},
  separationX: {type: 'number', title: 'Separation X'},
  separationY: {type: 'number', title: 'Separation Y'},
  centerX: {type: 'boolean', title: 'Center horizontally', fullWidth: true},
  centerY: {type: 'boolean', title: 'Center vertically', fullWidth: true}
} as const satisfies Record<keyof DagLayoutFormState, PropDescription<DagLayoutFormState>>;

export function createForceLayoutFormState(
  options?: Record<string, unknown>,
  defaults: Record<ForceLayoutNumericKey, number> = D3_FORCE_DEFAULT_OPTIONS
): ForceLayoutFormState {
  return FORCE_LAYOUT_KEYS.reduce<ForceLayoutFormState>((state, key) => {
    state[key] = NUMBER_FALLBACK(options?.[key], defaults[key]);
    return state;
  }, {} as ForceLayoutFormState);
}

export function mapForceLayoutFormStateToOptions(
  state: ForceLayoutFormState
): Record<string, number> {
  return FORCE_LAYOUT_KEYS.reduce<Record<string, number>>((options, key) => {
    options[key] = state[key];
    return options;
  }, {});
}

export function createForceMultiGraphFormState(
  options?: Record<string, unknown>,
  defaults: Record<ForceMultiGraphLayoutNumericKey, number> =
    FORCE_MULTI_GRAPH_DEFAULT_OPTIONS
): ForceMultiGraphLayoutFormState {
  return FORCE_MULTI_GRAPH_KEYS.reduce<ForceMultiGraphLayoutFormState>((state, key) => {
    state[key] = NUMBER_FALLBACK(options?.[key], defaults[key]);
    return state;
  }, {} as ForceMultiGraphLayoutFormState);
}

export function mapForceMultiGraphFormStateToOptions(
  state: ForceMultiGraphLayoutFormState
): Record<string, number> {
  return FORCE_MULTI_GRAPH_KEYS.reduce<Record<string, number>>((options, key) => {
    options[key] = state[key];
    return options;
  }, {});
}

export function createRadialLayoutFormState(
  options?: Record<string, unknown>,
  defaults: RadialLayoutFormState = RADIAL_DEFAULT_OPTIONS
): RadialLayoutFormState {
  return {
    radius: NUMBER_FALLBACK(options?.radius, defaults.radius)
  };
}

export function mapRadialLayoutFormStateToOptions(
  state: RadialLayoutFormState
): Record<string, number> {
  return {
    radius: state.radius
  };
}

export function createHivePlotLayoutFormState(
  options?: Record<string, unknown>,
  defaults: HivePlotLayoutFormState = HIVE_PLOT_DEFAULT_OPTIONS
): HivePlotLayoutFormState {
  return {
    innerRadius: NUMBER_FALLBACK(options?.innerRadius, defaults.innerRadius),
    outerRadius: NUMBER_FALLBACK(options?.outerRadius, defaults.outerRadius)
  };
}

export function mapHivePlotLayoutFormStateToOptions(
  state: HivePlotLayoutFormState
): Record<string, number> {
  return {
    innerRadius: state.innerRadius,
    outerRadius: state.outerRadius
  };
}

export function normalizeTuple(
  value: unknown,
  fallback: readonly [number, number]
): readonly [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const [first, second] = value;
    const firstNumber = Number(first);
    const secondNumber = Number(second);

    if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
      return [firstNumber, secondNumber];
    }
  }

  return fallback;
}

// eslint-disable-next-line complexity
export function createDagFormState(options?: Record<string, unknown>): DagLayoutFormState {
  const merged = {...DAG_DEFAULT_OPTIONS, ...(options ?? {})};
  const center = merged.center;
  const centerX =
    typeof center === 'boolean'
      ? center
      : typeof center === 'object' && center !== null && 'x' in center
      ? Boolean((center as {x?: boolean}).x)
      : true;
  const centerY =
    typeof center === 'boolean'
      ? center
      : typeof center === 'object' && center !== null && 'y' in center
      ? Boolean((center as {y?: boolean}).y)
      : true;

  const nodeSize = normalizeTuple(merged.nodeSize, DAG_DEFAULT_OPTIONS.nodeSize);
  const gap = normalizeTuple(merged.gap, DAG_DEFAULT_OPTIONS.gap);
  const separation = normalizeTuple(merged.separation, DAG_DEFAULT_OPTIONS.separation);

  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    layout: (merged.layout ?? DAG_DEFAULT_OPTIONS.layout) as DagLayoutFormState['layout'],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    layering: (merged.layering ?? DAG_DEFAULT_OPTIONS.layering) as DagLayoutFormState['layering'],
    nodeRank:
      typeof merged.nodeRank === 'string' && merged.nodeRank === 'rank'
        ? 'rank'
        : 'none',
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    decross: (merged.decross ?? DAG_DEFAULT_OPTIONS.decross) as DagLayoutFormState['decross'],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    coord: (merged.coord ?? DAG_DEFAULT_OPTIONS.coord) as DagLayoutFormState['coord'],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    orientation: (merged.orientation ?? DAG_DEFAULT_OPTIONS.orientation) as DagLayoutFormState['orientation'],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    dagBuilder: (merged.dagBuilder ?? DAG_DEFAULT_OPTIONS.dagBuilder) as DagLayoutFormState['dagBuilder'],
    centerX,
    centerY,
    nodeWidth: nodeSize[0],
    nodeHeight: nodeSize[1],
    gapX: gap[0],
    gapY: gap[1],
    separationX: separation[0],
    separationY: separation[1]
  };
}

// eslint-disable-next-line complexity
export function dagStatesEqual(a: DagLayoutFormState, b: DagLayoutFormState): boolean {
  return (
    a.layout === b.layout &&
    a.layering === b.layering &&
    a.nodeRank === b.nodeRank &&
    a.decross === b.decross &&
    a.coord === b.coord &&
    a.orientation === b.orientation &&
    a.dagBuilder === b.dagBuilder &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.nodeWidth === b.nodeWidth &&
    a.nodeHeight === b.nodeHeight &&
    a.gapX === b.gapX &&
    a.gapY === b.gapY &&
    a.separationX === b.separationX &&
    a.separationY === b.separationY
  );
}

export function mapDagFormStateToOptions(state: DagLayoutFormState): Record<string, unknown> {
  const centerOption =
    state.centerX === state.centerY
      ? state.centerX
      : ({
          x: state.centerX,
          y: state.centerY
        } as const);

  return {
    layout: state.layout,
    layering: state.layering,
    ...(state.nodeRank === 'none' ? {} : {nodeRank: state.nodeRank}),
    decross: state.decross,
    coord: state.coord,
    orientation: state.orientation,
    dagBuilder: state.dagBuilder,
    center: centerOption,
    nodeSize: [state.nodeWidth, state.nodeHeight],
    gap: [state.gapX, state.gapY],
    separation: [state.separationX, state.separationY]
  };
}
