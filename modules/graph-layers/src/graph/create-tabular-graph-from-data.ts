// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';
import type {GraphData, GraphEdgeData, GraphNodeData} from '../graph-data/graph-data';
import {cloneRecord, normalizeEdgeState, normalizeNodeState, normalizeVersion} from './graph-normalization';
import type {TabularGraphSource, TabularNodeAccessors, TabularEdgeAccessors} from './tabular-graph';
import {TabularGraph} from './tabular-graph';

export function createTabularGraphFromData(data: GraphData): TabularGraph {
  const version = normalizeVersion(data.version);
  const nodes = normalizeNodes(Array.isArray(data.nodes) ? data.nodes : []);
  const edges = normalizeEdges(Array.isArray(data.edges) ? data.edges : []);

  const nodeCount = nodes.id.length;
  const edgeCount = edges.id.length;

  const nodeHandles = createIndexArray(nodeCount);
  const edgeHandles = createIndexArray(edgeCount);

  const nodeIndexById = new Map<string | number, NodeHandle>();
  for (let i = 0; i < nodeCount; i++) {
    nodeIndexById.set(nodes.id[i], i);
  }

  const nodeAccessors: TabularNodeAccessors<NodeHandle> = {
    getId: (handle) => nodes.id[handle],
    getState: (handle) => nodes.state[handle],
    setState: (handle, state) => {
      nodes.state[handle] = state;
    },
    isSelectable: (handle) => nodes.selectable[handle],
    shouldHighlightConnectedEdges: (handle) => nodes.highlightConnectedEdges[handle],
    getPropertyValue: (handle, key) => nodes.data[handle]?.[key],
    setData: (handle, value) => {
      nodes.data[handle] = {...value};
    },
    setDataProperty: (handle, key, value) => {
      const record = nodes.data[handle] ?? {};
      record[key] = value;
      nodes.data[handle] = record;
    },
    getData: (handle) => nodes.data[handle]
  };

  const edgeAccessors: TabularEdgeAccessors<EdgeHandle> = {
    getId: (handle) => edges.id[handle],
    getSourceId: (handle) => edges.sourceId[handle],
    getTargetId: (handle) => edges.targetId[handle],
    isDirected: (handle) => edges.directed[handle],
    getState: (handle) => edges.state[handle],
    setState: (handle, state) => {
      edges.state[handle] = state;
    },
    getPropertyValue: (handle, key) => edges.data[handle]?.[key],
    setData: (handle, value) => {
      edges.data[handle] = {...value};
    },
    setDataProperty: (handle, key, value) => {
      const record = edges.data[handle] ?? {};
      record[key] = value;
      edges.data[handle] = record;
    },
    getData: (handle) => edges.data[handle]
  };

  const accessors = {node: nodeAccessors, edge: edgeAccessors};

  const source: TabularGraphSource<NodeHandle, EdgeHandle> = {
    version,
    getNodes: () => nodeHandles,
    getEdges: () => edgeHandles,
    getAccessors: () => accessors,
    findNodeById: (id) => nodeIndexById.get(id)
  };

  return new TabularGraph(source);
}

type NodeHandle = number;
type EdgeHandle = number;

type NormalizedNodeColumns = {
  id: (string | number)[];
  state: NodeState[];
  selectable: boolean[];
  highlightConnectedEdges: boolean[];
  data: Record<string, unknown>[];
};

type NormalizedEdgeColumns = {
  id: (string | number)[];
  sourceId: (string | number)[];
  targetId: (string | number)[];
  directed: boolean[];
  state: EdgeState[];
  data: Record<string, unknown>[];
};

function normalizeNodes(nodes: GraphNodeData[]): NormalizedNodeColumns {
  const normalized: NormalizedNodeColumns = {
    id: [],
    state: [],
    selectable: [],
    highlightConnectedEdges: [],
    data: []
  };

  for (const node of nodes) {
    if (typeof node?.id === 'undefined') {
      throw new Error('Graph node requires an "id" field.');
    }

    const attributes = cloneRecord(node.attributes);
    if (typeof node.label !== 'undefined') {
      attributes.label = node.label;
    }
    if (typeof node.weight !== 'undefined') {
      attributes.weight = node.weight;
    }

    const stateCandidate = node.state ?? (attributes.state as NodeState | undefined);
    const selectableCandidate = node.selectable ?? (attributes.selectable as boolean | undefined);
    const highlightCandidate =
      node.highlightConnectedEdges ?? (attributes.highlightConnectedEdges as boolean | undefined);

    normalized.id.push(node.id);
    normalized.state.push(normalizeNodeState(stateCandidate));
    normalized.selectable.push(Boolean(selectableCandidate));
    normalized.highlightConnectedEdges.push(Boolean(highlightCandidate));
    normalized.data.push(attributes);
  }

  return normalized;
}

function normalizeEdges(edges: GraphEdgeData[]): NormalizedEdgeColumns {
  const normalized: NormalizedEdgeColumns = {
    id: [],
    sourceId: [],
    targetId: [],
    directed: [],
    state: [],
    data: []
  };

  for (const edge of edges) {
    if (
      typeof edge?.id === 'undefined' ||
      typeof edge?.sourceId === 'undefined' ||
      typeof edge?.targetId === 'undefined'
    ) {
      throw new Error('Graph edge requires "id", "sourceId", and "targetId" fields.');
    }

    const attributes = cloneRecord(edge.attributes);
    if (typeof edge.label !== 'undefined') {
      attributes.label = edge.label;
    }
    if (typeof edge.weight !== 'undefined') {
      attributes.weight = edge.weight;
    }

    const stateCandidate = edge.state ?? (attributes.state as EdgeState | undefined);
    const directedCandidate = edge.directed ?? (attributes.directed as boolean | undefined);

    normalized.id.push(edge.id);
    normalized.sourceId.push(edge.sourceId);
    normalized.targetId.push(edge.targetId);
    normalized.directed.push(Boolean(directedCandidate));
    normalized.state.push(normalizeEdgeState(stateCandidate));
    normalized.data.push(attributes);
  }

  return normalized;
}

function createIndexArray(length: number): number[] {
  const handles: number[] = new Array(length);
  for (let i = 0; i < length; i++) {
    handles[i] = i;
  }
  return handles;
}
