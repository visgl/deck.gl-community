// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  ArrowGraph,
  ArrowGraphDataBuilder,
  type NodeState,
  type EdgeState
} from '@deck.gl-community/graph-layers';

const NODE_ATTRIBUTE_KEYS_TO_REMOVE = [
  'id',
  'state',
  'selectable',
  'highlightConnectedEdges',
  'label',
  'weight'
] as const;

const EDGE_ATTRIBUTE_KEYS_TO_REMOVE = [
  'id',
  'sourceId',
  'targetId',
  'directed',
  'state',
  'label',
  'weight'
] as const;

export type JsonGraph = {
  version?: number;
  nodes?: unknown[] | null;
  edges?: unknown[] | null;
};

type SanitizedNode = {
  id: string | number;
  state?: NodeState;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  label?: string;
  weight?: number;
  attributes: Record<string, unknown>;
};

type SanitizedEdge = {
  id: string | number;
  sourceId: string | number;
  targetId: string | number;
  directed?: boolean;
  state?: EdgeState;
  label?: string;
  weight?: number;
  attributes: Record<string, unknown>;
};

export function createArrowGraphFromJson(json: JsonGraph | null | undefined): ArrowGraph | null {
  if (!json) {
    return null;
  }

  const nodes = json.nodes ?? [];
  const edges = json.edges ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return null;
  }

  const builder = new ArrowGraphDataBuilder({version: json.version});
  let nodesAdded = false;

  for (const nodeEntry of nodes) {
    const node = sanitizeNode(nodeEntry);
    if (!node) {
      continue;
    }
    builder.addNode(node);
    nodesAdded = true;
  }

  for (const edgeEntry of edges) {
    const edge = sanitizeEdge(edgeEntry);
    if (!edge) {
      continue;
    }
    builder.addEdge(edge);
  }

  if (!nodesAdded) {
    return null;
  }

  return new ArrowGraph({data: builder.finish()});
}

function sanitizeNode(data: unknown): SanitizedNode | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const node = data as Record<string, unknown>;
  const id = node.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    return null;
  }
  const attributes = pruneAttributes(node, NODE_ATTRIBUTE_KEYS_TO_REMOVE);
  const state = typeof node.state === 'string' ? (node.state as NodeState) : undefined;
  const selectable =
    typeof node.selectable === 'boolean' ? node.selectable : undefined;
  const highlightConnectedEdges =
    typeof node.highlightConnectedEdges === 'boolean'
      ? node.highlightConnectedEdges
      : undefined;
  const label = typeof node.label === 'string' ? node.label : undefined;
  const weight = typeof node.weight === 'number' ? node.weight : undefined;

  return {
    id,
    state,
    selectable,
    highlightConnectedEdges,
    label,
    weight,
    attributes
  };
}

function sanitizeEdge(data: unknown): SanitizedEdge | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const edge = data as Record<string, unknown>;
  const id = edge.id;
  const sourceId = edge.sourceId;
  const targetId = edge.targetId;
  if (
    (typeof id !== 'string' && typeof id !== 'number') ||
    (typeof sourceId !== 'string' && typeof sourceId !== 'number') ||
    (typeof targetId !== 'string' && typeof targetId !== 'number')
  ) {
    return null;
  }
  const attributes = pruneAttributes(edge, EDGE_ATTRIBUTE_KEYS_TO_REMOVE);
  const state = typeof edge.state === 'string' ? (edge.state as EdgeState) : undefined;
  const directed =
    typeof edge.directed === 'boolean' ? edge.directed : undefined;
  const label = typeof edge.label === 'string' ? edge.label : undefined;
  const weight = typeof edge.weight === 'number' ? edge.weight : undefined;

  return {
    id,
    sourceId,
    targetId,
    directed,
    state,
    label,
    weight,
    attributes
  };
}

function pruneAttributes(
  source: Record<string, unknown>,
  keysToRemove: readonly string[]
): Record<string, unknown> {
  const attributes = {...source};
  for (const key of keysToRemove) {
    if (key in attributes) {
      delete attributes[key];
    }
  }
  return attributes;
}
