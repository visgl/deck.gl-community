// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';
import type {TabularGraph} from '../graph/tabular-graph';
import type {GraphNodeData, GraphEdgeData} from '../graph-data/graph-data';
import {ColumnarGraphDataBuilder} from '../graph-data/columnar-graph-data-builder';
import {createTabularGraphFromData} from '../graph/create-tabular-graph-from-data';
import {basicNodeParser} from './node-parsers';
import {basicEdgeParser} from './edge-parsers';
import {error} from '../utils/log';

type GraphJSON = {
  version?: number;
  nodes?: unknown[] | null;
  edges?: unknown[] | null;
};

export type JSONTabularGraphLoaderOptions = {
  json: GraphJSON;
  nodeParser?: (node: any) => {
    id: string | number;
    state?: NodeState;
    selectable?: boolean;
    highlightConnectedEdges?: boolean;
    label?: string;
    weight?: number;
  } | null;
  edgeParser?: (edge: any) => {
    id: string | number;
    directed?: boolean;
    sourceId: string | number;
    targetId: string | number;
    state?: EdgeState;
    label?: string;
    weight?: number;
  } | null;
};

export function JSONTabularGraphLoader({
  json,
  nodeParser = basicNodeParser,
  edgeParser = basicEdgeParser
}: JSONTabularGraphLoaderOptions): TabularGraph | null {
  const nodes = json?.nodes ?? null;
  const edges = json?.edges ?? null;
  if (!Array.isArray(nodes)) {
    error('Invalid graph: nodes is missing.');
    return null;
  }

  const normalizedNodes = parseNodes(nodes, nodeParser);
  const normalizedEdges = parseEdges(Array.isArray(edges) ? edges : [], edgeParser);

  const builder = new ColumnarGraphDataBuilder({
    nodeCapacity: normalizedNodes.length,
    edgeCapacity: normalizedEdges.length,
    version: json?.version
  });

  for (const node of normalizedNodes) {
    builder.addNode(node);
  }

  for (const edge of normalizedEdges) {
    builder.addEdge(edge);
  }

  return createTabularGraphFromData(builder.build());
}

function parseNodes(
  nodes: unknown[],
  nodeParser: JSONTabularGraphLoaderOptions['nodeParser']
): GraphNodeData[] {
  const parsedNodes: GraphNodeData[] = [];

  for (const node of nodes) {
    const parsed = nodeParser?.(node);
    if (parsed && typeof parsed.id !== 'undefined') {
      const attributes = cloneRecord(node);
      const nodeRecord: GraphNodeData = {
        type: 'graph-node-data',
        id: parsed.id,
        state: parsed.state ?? (attributes.state as NodeState | undefined),
        selectable: parsed.selectable ?? (attributes.selectable as boolean | undefined),
        highlightConnectedEdges:
          parsed.highlightConnectedEdges ?? (attributes.highlightConnectedEdges as boolean | undefined),
        label: parsed.label ?? (attributes.label as string | undefined),
        weight: parsed.weight ?? (attributes.weight as number | undefined),
        attributes
      };
      parsedNodes.push(nodeRecord);
    }
  }

  return parsedNodes;
}

function parseEdges(
  edges: unknown[],
  edgeParser: JSONTabularGraphLoaderOptions['edgeParser']
): GraphEdgeData[] {
  const handles: GraphEdgeData[] = [];

  for (const edge of edges) {
    const parsed = edgeParser?.(edge);
    if (
      parsed &&
      typeof parsed.sourceId !== 'undefined' &&
      typeof parsed.targetId !== 'undefined'
    ) {
      const attributes = cloneRecord(edge);
      handles.push({
        type: 'graph-edge-data',
        id: parsed.id,
        directed: parsed.directed ?? (attributes.directed as boolean | undefined),
        sourceId: parsed.sourceId,
        targetId: parsed.targetId,
        state: parsed.state ?? (attributes.state as EdgeState | undefined),
        label: parsed.label ?? (attributes.label as string | undefined),
        weight: parsed.weight ?? (attributes.weight as number | undefined),
        attributes
      });
    }
  }

  return handles;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return {...(value as Record<string, unknown>)};
  }
  return {};
}
