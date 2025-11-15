// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';
import * as arrow from 'apache-arrow';

/** Graph data types supported by this library */
export type GraphData = PlainGraphData | ArrowGraphData;

/** Graph data stored in Apache Arrow binary columnar tables */
export type ArrowGraphData = {
  shape: 'arrow-graph-data';
  version: number;
  nodes: arrow.Table;
  edges: arrow.Table;
};

export type PlainGraphData = {
  shape: 'plain-graph-data';
  version?: number;
  nodes?: GraphNodeData[] | null;
  edges?: GraphEdgeData[] | null;
};

export type GraphNodeData = {
  id: string | number;
  label?: string;
  state?: NodeState;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  weight?: number;
  attributes?: Record<string, unknown> | null | undefined;
};

export type GraphEdgeData = {
  id: string | number;
  sourceId: string | number;
  targetId: string | number;
  label?: string;
  state?: EdgeState;
  directed?: boolean;
  weight?: number;
  attributes?: Record<string, unknown> | null | undefined;
};

export function isArrowGraphData(value: unknown): value is ArrowGraphData {
  const candidate = value as ArrowGraphData;
  return typeof value === 'object' && candidate?.shape === 'arrow-graph-data';
}

export function isPlainGraphData(value: unknown): value is PlainGraphData {
  const candidate = value as PlainGraphData;
  return typeof value === 'object' && candidate?.shape === 'plain-graph-data';
}
