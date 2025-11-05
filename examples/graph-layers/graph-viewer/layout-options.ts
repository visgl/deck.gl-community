// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphLayerProps} from '@deck.gl-community/graph-layers';
import {D3DagLayout} from '@deck.gl-community/graph-layers';

export type LayoutType =
  | 'd3-force-layout'
  | 'gpu-force-layout'
  | 'simple-layout'
  | 'radial-layout'
  | 'hive-plot-layout'
  | 'force-multi-graph-layout'
  | 'd3-dag-layout';

export type ExampleStyles = NonNullable<GraphLayerProps['stylesheet']>;

export type ExampleDefinition = {
  name: string;
  description: string;
  data: () => {nodes: unknown[]; edges: unknown[]};
  /** First listed layout is the default */
  layouts: LayoutType[];
  layoutDescriptions: Record<LayoutType, string>;
  style: ExampleStyles;
  getLayoutOptions?: (
    layout: LayoutType,
    data: {nodes: unknown[]; edges: unknown[]}
  ) => Record<string, unknown> | undefined;
};

export const LAYOUT_LABELS: Record<LayoutType, string> = {
  'd3-force-layout': 'D3 Force Layout',
  'gpu-force-layout': 'GPU Force Layout',
  'simple-layout': 'Simple Layout',
  'radial-layout': 'Radial Layout',
  'hive-plot-layout': 'Hive Plot Layout',
  'force-multi-graph-layout': 'Force Multi-Graph Layout',
  'd3-dag-layout': 'D3 DAG Layout'
};

export type DagLayoutFormState = {
  layout: 'sugiyama' | 'grid' | 'zherebko';
  layering: 'simplex' | 'longestPath' | 'topological';
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

export type DagSelectKey =
  | 'layout'
  | 'layering'
  | 'decross'
  | 'coord'
  | 'orientation'
  | 'dagBuilder';

export type DagNumericKey =
  | 'nodeWidth'
  | 'nodeHeight'
  | 'gapX'
  | 'gapY'
  | 'separationX'
  | 'separationY';

export const DAG_DEFAULT_OPTIONS = D3DagLayout.defaultOptions;

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
    layout: (merged.layout ?? DAG_DEFAULT_OPTIONS.layout) as DagLayoutFormState['layout'],
    layering: (merged.layering ?? DAG_DEFAULT_OPTIONS.layering) as DagLayoutFormState['layering'],
    decross: (merged.decross ?? DAG_DEFAULT_OPTIONS.decross) as DagLayoutFormState['decross'],
    coord: (merged.coord ?? DAG_DEFAULT_OPTIONS.coord) as DagLayoutFormState['coord'],
    orientation: (merged.orientation ?? DAG_DEFAULT_OPTIONS.orientation) as DagLayoutFormState['orientation'],
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

export function dagStatesEqual(a: DagLayoutFormState, b: DagLayoutFormState): boolean {
  return (
    a.layout === b.layout &&
    a.layering === b.layering &&
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
