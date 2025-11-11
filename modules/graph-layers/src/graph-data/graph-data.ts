// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';
import type * as arrow from 'apache-arrow';

export interface GraphNodeData {
  id: string | number;
  label?: string;
  state?: NodeState;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  weight?: number;
  attributes?: Record<string, unknown> | null | undefined;
}

export interface GraphEdgeData {
  id: string | number;
  sourceId: string | number;
  targetId: string | number;
  label?: string;
  state?: EdgeState;
  directed?: boolean;
  weight?: number;
  attributes?: Record<string, unknown> | null | undefined;
}

export interface GraphData {
  version?: number;
  nodes?: GraphNodeData[] | null;
  edges?: GraphEdgeData[] | null;
}

export type ArrowGraphData = {
  version: number;
  nodes: ReturnType<typeof arrow.Table['new']>;
  edges: ReturnType<typeof arrow.Table['new']>;
};
