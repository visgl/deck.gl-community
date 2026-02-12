// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ArrowGraph} from '../arrow-graph';
import type {ArrowGraphDataBuilderOptions} from '../../graph-data/arrow-graph-data-builder';
import {ArrowGraphDataBuilder} from '../../graph-data/arrow-graph-data-builder';
import type {TabularGraph, TabularNode, TabularEdge} from '../tabular-graph';

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

type SanitizedNodeData = {
  label?: string;
  weight?: number;
  attributes: Record<string, unknown>;
};

type SanitizedEdgeData = {
  label?: string;
  weight?: number;
  attributes: Record<string, unknown>;
};

export type ConvertTabularGraphToArrowGraphOptions = ArrowGraphDataBuilderOptions;

export function convertTabularGraphToArrowGraph(
  tabularGraph: TabularGraph,
  options?: ConvertTabularGraphToArrowGraphOptions
): ArrowGraph {
  const builder = new ArrowGraphDataBuilder({
    ...options,
    version: options?.version ?? tabularGraph.version
  });

  for (const node of tabularGraph.getNodes() as Iterable<TabularNode>) {
    const {label, weight, attributes} = sanitizeNodeData(
      tabularGraph.getNodeDataByIndex(node.index)
    );

    builder.addNode({
      id: node.getId(),
      state: node.getState(),
      selectable: node.isSelectable(),
      highlightConnectedEdges: node.shouldHighlightConnectedEdges(),
      label,
      weight,
      attributes
    });
  }

  for (const edge of tabularGraph.getEdges() as Iterable<TabularEdge>) {
    const {label, weight, attributes} = sanitizeEdgeData(
      tabularGraph.getEdgeDataByIndex(edge.index)
    );

    builder.addEdge({
      id: edge.getId(),
      sourceId: edge.getSourceNodeId(),
      targetId: edge.getTargetNodeId(),
      directed: edge.isDirected(),
      state: edge.getState(),
      label,
      weight,
      attributes
    });
  }

  return new ArrowGraph({...tabularGraph.props, data: builder.finish()});
}

function sanitizeNodeData(data: Record<string, unknown>): SanitizedNodeData {
  const rawLabel = data.label;
  const label = typeof rawLabel === 'string' ? rawLabel : undefined;
  const rawWeight = data.weight;
  const weight = typeof rawWeight === 'number' ? rawWeight : undefined;
  const attributes = pruneAttributes(data, NODE_ATTRIBUTE_KEYS_TO_REMOVE);

  return {label, weight, attributes};
}

function sanitizeEdgeData(data: Record<string, unknown>): SanitizedEdgeData {
  const rawLabel = data.label;
  const label = typeof rawLabel === 'string' ? rawLabel : undefined;
  const rawWeight = data.weight;
  const weight = typeof rawWeight === 'number' ? rawWeight : undefined;
  const attributes = pruneAttributes(data, EDGE_ATTRIBUTE_KEYS_TO_REMOVE);

  return {label, weight, attributes};
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
