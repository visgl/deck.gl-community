// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';
import type {GraphData} from '../graph-data/graph-data';
import type {
  ColumnarGraphColumns,
  ColumnarGraphNodeColumns,
  ColumnarGraphEdgeColumns
} from '../graph-data/columnar-graph-data-builder';
import {ColumnarGraphDataBuilder} from '../graph-data/columnar-graph-data-builder';
import {
  normalizeBooleanColumn,
  normalizeDataColumn,
  normalizeEdgeStateColumn,
  normalizeNodeStateColumn,
  normalizeVersion
} from './graph-normalization';
import type {
  TabularGraphSource,
  TabularNodeAccessors,
  TabularEdgeAccessors
} from './tabular-graph';
import {TabularGraph} from './tabular-graph';

export function createTabularGraphFromData(data: GraphData | ColumnarGraphColumns): TabularGraph {
  if (isColumnarGraphColumns(data)) {
    return createTabularGraphFromColumnarData(data);
  }

  const builder = new ColumnarGraphDataBuilder({
    nodeCapacity: Array.isArray(data.nodes) ? data.nodes.length : 0,
    edgeCapacity: Array.isArray(data.edges) ? data.edges.length : 0,
    version: data.version
  });

  if (Array.isArray(data.nodes)) {
    for (const node of data.nodes) {
      builder.addNode(node);
    }
  }

  if (Array.isArray(data.edges)) {
    for (const edge of data.edges) {
      builder.addEdge(edge);
    }
  }

  return createTabularGraphFromColumnarData(builder.build());
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

function createTabularGraphFromColumnarData(data: ColumnarGraphColumns): TabularGraph {
  const version = normalizeVersion(data.version);
  const nodes = normalizeNodeColumns(data.nodes);
  const edges = normalizeEdgeColumns(data.edges);

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

function isColumnarGraphColumns(value: GraphData | ColumnarGraphColumns): value is ColumnarGraphColumns {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeGraphData = value as GraphData;
  if (Array.isArray(maybeGraphData.nodes) || Array.isArray(maybeGraphData.edges)) {
    return false;
  }

  const maybeColumnar = value as ColumnarGraphColumns;
  return Array.isArray(maybeColumnar.nodes?.id) && Array.isArray(maybeColumnar.edges?.id);
}

function normalizeNodeColumns(columns: ColumnarGraphNodeColumns): NormalizedNodeColumns {
  const id = Array.isArray(columns.id) ? columns.id.slice() : [];
  const length = id.length;

  return {
    id,
    state: normalizeNodeStateColumn(columns.state, length),
    selectable: normalizeBooleanColumn(columns.selectable, length, false),
    highlightConnectedEdges: normalizeBooleanColumn(columns.highlightConnectedEdges, length, false),
    data: normalizeDataColumn(columns.data, length)
  };
}

function normalizeEdgeColumns(columns: ColumnarGraphEdgeColumns): NormalizedEdgeColumns {
  const id = Array.isArray(columns.id) ? columns.id.slice() : [];
  const length = id.length;

  if (!Array.isArray(columns.sourceId) || columns.sourceId.length !== length) {
    throw new Error('Columnar graph edge data requires a sourceId column matching the id column length.');
  }

  if (!Array.isArray(columns.targetId) || columns.targetId.length !== length) {
    throw new Error('Columnar graph edge data requires a targetId column matching the id column length.');
  }

  return {
    id,
    sourceId: columns.sourceId.slice(0, length),
    targetId: columns.targetId.slice(0, length),
    directed: normalizeBooleanColumn(columns.directed, length, false),
    state: normalizeEdgeStateColumn(columns.state, length),
    data: normalizeDataColumn(columns.data, length)
  };
}

function createIndexArray(length: number): number[] {
  const handles: number[] = new Array(length);
  for (let i = 0; i < length; i++) {
    handles[i] = i;
  }
  return handles;
}
