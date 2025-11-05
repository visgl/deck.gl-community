// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createGraph} from './create-graph';
import {basicNodeParser} from './node-parsers';
import {basicEdgeParser} from './edge-parsers';
import {error, warn} from '../utils/log';
import {Graph} from '../graph/graph';

type JsonGraphPayload = {
  name?: string;
  nodes?: unknown[] | null;
  edges?: unknown[] | null;
};

type NormalizedGraphPayload = {
  name?: string;
  nodes: unknown[];
  edges: unknown[];
};

function isPlainObject(value: unknown): value is Record<string | number | symbol, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizePayload(json: unknown): NormalizedGraphPayload | null {
  if (!json) {
    error('JSONLoader: Missing graph data.');
    return null;
  }

  if (json instanceof Graph) {
    error('JSONLoader: Expected raw graph JSON, received a Graph instance.');
    return null;
  }

  if (Array.isArray(json)) {
    return {nodes: [], edges: json};
  }

  if (isPlainObject(json)) {
    const {name, nodes, edges} = json as JsonGraphPayload;
    return {
      name,
      nodes: Array.isArray(nodes) ? [...nodes] : [],
      edges: Array.isArray(edges) ? [...edges] : []
    };
  }

  error('JSONLoader: Unsupported graph data format.');
  return null;
}

function deriveEndpointId(edge: Record<string, unknown>, key: 'sourceId' | 'targetId') {
  const fallbacks =
    key === 'sourceId'
      ? ['sourceId', 'source', 'from', 'fromId']
      : ['targetId', 'target', 'to', 'toId'];

  for (const candidate of fallbacks) {
    if (candidate in edge) {
      const value = edge[candidate];
      if (value !== null && value !== undefined) {
        return value;
      }
    }
  }

  return undefined;
}

function deriveNodeId(node: Record<string, unknown>, index: number) {
  const candidates = ['id', 'nodeId', 'name', 'key'];

  for (const candidate of candidates) {
    if (candidate in node) {
      const value = node[candidate];
      if (value !== null && value !== undefined) {
        return value;
      }
    }
  }

  return `node-${index}`;
}

export const JSONLoader = ({json, nodeParser = basicNodeParser, edgeParser = basicEdgeParser}) => {
  const payload = normalizePayload(json);
  if (!payload) {
    return null;
  }

  const {name = 'default'} = payload;
  const nodes = Array.isArray(payload.nodes) ? [...payload.nodes] : [];
  const edges = Array.isArray(payload.edges) ? [...payload.edges] : [];

  const nodeIdSet = new Set<string | number>();
  const normalizedNodes = nodes
    .map((node, index) => {
      if (!node || typeof node !== 'object') {
        warn('JSONLoader: Ignoring malformed node without object structure.');
        return null;
      }

      const mutableNode = {...(node as Record<string, unknown>)};
      const nodeId = deriveNodeId(mutableNode, index);

      if (nodeIdSet.has(nodeId as string | number)) {
        warn(`JSONLoader: Duplicate node id "${String(nodeId)}" encountered.`);
        return null;
      }

      if (mutableNode.id === undefined || mutableNode.id === null) {
        mutableNode.id = nodeId;
      }

      nodeIdSet.add(mutableNode.id as string | number);
      return mutableNode;
    })
    .filter(Boolean) as Record<string, unknown>[];

  const normalizedEdges = edges
    .map((edge, index) => {
      if (!edge || typeof edge !== 'object') {
        error('JSONLoader: Skipping malformed edge entry.');
        return null;
      }

      const mutableEdge = {...(edge as Record<string, unknown>)};
      const sourceId = deriveEndpointId(mutableEdge, 'sourceId');
      const targetId = deriveEndpointId(mutableEdge, 'targetId');

      if (sourceId === undefined || targetId === undefined) {
        error('Invalid edge: sourceId or targetId is missing.');
        return null;
      }

      mutableEdge.sourceId = sourceId;
      mutableEdge.targetId = targetId;

      if (mutableEdge.id === undefined || mutableEdge.id === null) {
        mutableEdge.id = `${String(sourceId)}-${String(targetId)}-${index}`;
      }

      if (!nodeIdSet.has(sourceId)) {
        normalizedNodes.push({id: sourceId});
        nodeIdSet.add(sourceId);
      }
      if (!nodeIdSet.has(targetId)) {
        normalizedNodes.push({id: targetId});
        nodeIdSet.add(targetId);
      }

      return mutableEdge;
    })
    .filter(Boolean);

  const graph = createGraph({
    name,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    nodeParser,
    edgeParser
  });

  return graph;
};
