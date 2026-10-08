// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Graph} from '../graph/graph';
import type {GraphNodeData, GraphEdgeData} from '../graph-data/graph-data';
import {isArrowGraphData, isPlainGraphData} from '../graph-data/graph-data';
import {createGraphFromData} from '../graph/functions/create-graph-from-data';

/** Convert resolved JSON or normalized graph data without mutating the input. */
export function loadGraphData(input: unknown): Graph | null {
  if (isArrowGraphData(input) || isPlainGraphData(input)) {
    return createGraphFromData(input);
  }

  const json = asRecord(input);
  if (!Array.isArray(input) && !Array.isArray(json.nodes) && !Array.isArray(json.edges)) {
    return null;
  }

  const nodes = new Map<string | number, GraphNodeData>();
  for (const value of Array.isArray(json.nodes) ? json.nodes : []) {
    const node = asRecord(value);
    if (isId(node.id)) {
      nodes.set(node.id, {...node, id: node.id, attributes: getAttributes(node)});
    }
  }

  const edgeRecords = Array.isArray(input) ? input : Array.isArray(json.edges) ? json.edges : [];
  const edges: GraphEdgeData[] = [];
  const edgeIds = new Set(edgeRecords.map(value => asRecord(value).id).filter(isId));
  for (const value of edgeRecords) {
    const edge = asRecord(value);
    if (!isId(edge.sourceId) || !isId(edge.targetId)) {
      continue;
    }
    let id: string | number;
    if (isId(edge.id)) {
      id = edge.id;
    } else {
      let index = edges.length;
      do {
        id = `edge-${index++}`;
      } while (edgeIds.has(id));
    }
    edgeIds.add(id);
    edges.push({
      ...edge,
      id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      attributes: getAttributes(edge)
    });
    for (const nodeId of [edge.sourceId, edge.targetId]) {
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {id: nodeId, attributes: {id: nodeId}});
      }
    }
  }

  return createGraphFromData({
    shape: 'plain-graph-data',
    version: typeof json.version === 'number' ? json.version : undefined,
    nodes: [...nodes.values()],
    edges
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function getAttributes(record: Record<string, unknown>): Record<string, unknown> {
  const {attributes, ...properties} = record;
  return {...properties, ...asRecord(attributes)};
}
