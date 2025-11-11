// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';

type GraphNodeDataShape = {
  id: string | number;
  label?: string;
  state?: NodeState;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  weight?: number;
  attributes?: Record<string, unknown> | null | undefined;
};

export type GraphNodeData = GraphNodeDataShape & {
  type?: 'graph-node-data';
};

type GraphEdgeDataShape = {
  id: string | number;
  sourceId: string | number;
  targetId: string | number;
  label?: string;
  state?: EdgeState;
  directed?: boolean;
  weight?: number;
  attributes?: Record<string, unknown> | null | undefined;
};

export type GraphEdgeData = GraphEdgeDataShape & {
  type?: 'graph-edge-data';
};

type GraphDataShape = {
  version?: number;
  nodes?: GraphNodeData[] | null;
  edges?: GraphEdgeData[] | null;
};

export type GraphData = GraphDataShape & {
  type?: 'graph-data';
};
