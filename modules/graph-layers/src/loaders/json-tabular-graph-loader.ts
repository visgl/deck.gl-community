// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';
import type {GraphData, GraphNodeData, GraphEdgeData} from '../graph-data/graph-data';
import {GraphDataBuilder} from '../graph-data/graph-data-builder';
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
  builder?: GraphDataBuilder;
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
  builder,
  nodeParser = basicNodeParser,
  edgeParser = basicEdgeParser
}: JSONTabularGraphLoaderOptions): GraphData | null {
  const nodes = json?.nodes ?? null;
  const edges = json?.edges ?? null;
  if (!Array.isArray(nodes)) {
    error('Invalid graph: nodes is missing.');
    return null;
  }

  const graphBuilder = builder ?? new GraphDataBuilder();
  graphBuilder.setVersion(json?.version);

  parseNodes(nodes, nodeParser, graphBuilder);
  parseEdges(Array.isArray(edges) ? edges : [], edgeParser, graphBuilder);

  return graphBuilder.build();
}

function parseNodes(
  nodes: unknown[],
  nodeParser: JSONTabularGraphLoaderOptions['nodeParser'],
  builder: GraphDataBuilder
): void {
  
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
      builder.addNode(nodeRecord);
    }
  }
}

function parseEdges(
  edges: unknown[],
  edgeParser: JSONTabularGraphLoaderOptions['edgeParser'],
  builder: GraphDataBuilder
): void {

  for (const edge of edges) {
    const parsed = edgeParser?.(edge);
    if (
      parsed &&
      typeof parsed.sourceId !== 'undefined' &&
      typeof parsed.targetId !== 'undefined'
    ) {
      const attributes = cloneRecord(edge);
      const edgeRecord: GraphEdgeData = {
        type: 'graph-edge-data',
        id: parsed.id,
        directed: parsed.directed ?? (attributes.directed as boolean | undefined),
        sourceId: parsed.sourceId,
        targetId: parsed.targetId,
        state: parsed.state ?? (attributes.state as EdgeState | undefined),
        label: parsed.label ?? (attributes.label as string | undefined),
        weight: parsed.weight ?? (attributes.weight as number | undefined),
        attributes
      };
      builder.addEdge(edgeRecord);
    }
  }
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return {...(value as Record<string, unknown>)};
  }
  return {};
}
