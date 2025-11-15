// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';
import type {GraphNodeData, GraphEdgeData} from './graph-data';
import {
  cloneDataColumn,
  cloneRecord,
  normalizeEdgeState,
  normalizeNodeState,
  normalizeVersion
} from '../graph/graph-normalization';

export type ColumnarGraphDataBuilderOptions = {
  nodeCapacity?: number;
  edgeCapacity?: number;
  version?: number;
};

export interface ColumnarGraphNodeColumns {
  id: (string | number)[];
  state?: NodeState[];
  selectable?: boolean[];
  highlightConnectedEdges?: boolean[];
  data?: Record<string, unknown>[];
  [columnName: string]: unknown;
}

export interface ColumnarGraphEdgeColumns {
  id: (string | number)[];
  sourceId: (string | number)[];
  targetId: (string | number)[];
  directed?: boolean[];
  state?: EdgeState[];
  data?: Record<string, unknown>[];
  [columnName: string]: unknown;
}

export interface ColumnarGraphColumns {
  type?: 'columnar-graph-data';
  version?: number;
  nodes: ColumnarGraphNodeColumns;
  edges: ColumnarGraphEdgeColumns;
}

type MutableNodeColumns = {
  id: (string | number)[];
  state: NodeState[];
  selectable: boolean[];
  highlightConnectedEdges: boolean[];
  data: Record<string, unknown>[];
};

type MutableEdgeColumns = {
  id: (string | number)[];
  sourceId: (string | number)[];
  targetId: (string | number)[];
  directed: boolean[];
  state: EdgeState[];
  data: Record<string, unknown>[];
};

export class ColumnarGraphDataBuilder {
  private nodeColumns: MutableNodeColumns;
  private edgeColumns: MutableEdgeColumns;

  private nodeCapacity: number;
  private edgeCapacity: number;

  private nodeLength = 0;
  private edgeLength = 0;

  private _version: number;

  constructor(options: ColumnarGraphDataBuilderOptions = {}) {
    this.nodeCapacity = Math.max(0, options.nodeCapacity ?? 0);
    this.edgeCapacity = Math.max(0, options.edgeCapacity ?? 0);
    this.nodeColumns = createMutableNodeColumns(this.nodeCapacity);
    this.edgeColumns = createMutableEdgeColumns(this.edgeCapacity);
    this._version = normalizeVersion(options.version);
  }

  get version(): number {
    return this._version;
  }

  setVersion(version: unknown): void {
    this._version = normalizeVersion(version);
  }

  get nodeCount(): number {
    return this.nodeLength;
  }

  get edgeCount(): number {
    return this.edgeLength;
  }

  addNode(node: GraphNodeData): number {
    if (typeof node?.id === 'undefined') {
      throw new Error('Graph node requires an "id" field.');
    }

    this.ensureNodeCapacity(this.nodeLength + 1);

    const index = this.nodeLength++;
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

    this.nodeColumns.id[index] = node.id;
    this.nodeColumns.state[index] = normalizeNodeState(stateCandidate);
    this.nodeColumns.selectable[index] = Boolean(selectableCandidate);
    this.nodeColumns.highlightConnectedEdges[index] = Boolean(highlightCandidate);
    this.nodeColumns.data[index] = attributes;

    return index;
  }

  addEdge(edge: GraphEdgeData): number {
    if (
      typeof edge?.id === 'undefined' ||
      typeof edge?.sourceId === 'undefined' ||
      typeof edge?.targetId === 'undefined'
    ) {
      throw new Error('Graph edge requires "id", "sourceId", and "targetId" fields.');
    }

    this.ensureEdgeCapacity(this.edgeLength + 1);

    const index = this.edgeLength++;
    const attributes = cloneRecord(edge.attributes);

    if (typeof edge.label !== 'undefined') {
      attributes.label = edge.label;
    }

    if (typeof edge.weight !== 'undefined') {
      attributes.weight = edge.weight;
    }

    const stateCandidate = edge.state ?? (attributes.state as EdgeState | undefined);
    const directedCandidate = edge.directed ?? (attributes.directed as boolean | undefined);

    this.edgeColumns.id[index] = edge.id;
    this.edgeColumns.sourceId[index] = edge.sourceId;
    this.edgeColumns.targetId[index] = edge.targetId;
    this.edgeColumns.directed[index] = Boolean(directedCandidate);
    this.edgeColumns.state[index] = normalizeEdgeState(stateCandidate);
    this.edgeColumns.data[index] = attributes;

    return index;
  }

  build(): ColumnarGraphColumns {
    return {
      type: 'columnar-graph-data',
      version: this._version,
      nodes: {
        id: this.nodeColumns.id.slice(0, this.nodeLength),
        state: this.nodeColumns.state.slice(0, this.nodeLength),
        selectable: this.nodeColumns.selectable.slice(0, this.nodeLength),
        highlightConnectedEdges: this.nodeColumns.highlightConnectedEdges.slice(0, this.nodeLength),
        data: cloneDataColumn(this.nodeColumns.data, this.nodeLength)
      },
      edges: {
        id: this.edgeColumns.id.slice(0, this.edgeLength),
        sourceId: this.edgeColumns.sourceId.slice(0, this.edgeLength),
        targetId: this.edgeColumns.targetId.slice(0, this.edgeLength),
        directed: this.edgeColumns.directed.slice(0, this.edgeLength),
        state: this.edgeColumns.state.slice(0, this.edgeLength),
        data: cloneDataColumn(this.edgeColumns.data, this.edgeLength)
      }
    };
  }

  private ensureNodeCapacity(minCapacity: number): void {
    if (this.nodeCapacity >= minCapacity) {
      return;
    }

    const nextCapacity = Math.max(8, this.nodeCapacity * 2, minCapacity);
    const nextColumns = createMutableNodeColumns(nextCapacity);

    for (let i = 0; i < this.nodeLength; i++) {
      nextColumns.id[i] = this.nodeColumns.id[i];
      nextColumns.state[i] = this.nodeColumns.state[i];
      nextColumns.selectable[i] = this.nodeColumns.selectable[i];
      nextColumns.highlightConnectedEdges[i] = this.nodeColumns.highlightConnectedEdges[i];
      nextColumns.data[i] = this.nodeColumns.data[i];
    }

    this.nodeColumns = nextColumns;
    this.nodeCapacity = nextCapacity;
  }

  private ensureEdgeCapacity(minCapacity: number): void {
    if (this.edgeCapacity >= minCapacity) {
      return;
    }

    const nextCapacity = Math.max(8, this.edgeCapacity * 2, minCapacity);
    const nextColumns = createMutableEdgeColumns(nextCapacity);

    for (let i = 0; i < this.edgeLength; i++) {
      nextColumns.id[i] = this.edgeColumns.id[i];
      nextColumns.sourceId[i] = this.edgeColumns.sourceId[i];
      nextColumns.targetId[i] = this.edgeColumns.targetId[i];
      nextColumns.directed[i] = this.edgeColumns.directed[i];
      nextColumns.state[i] = this.edgeColumns.state[i];
      nextColumns.data[i] = this.edgeColumns.data[i];
    }

    this.edgeColumns = nextColumns;
    this.edgeCapacity = nextCapacity;
  }
}

function createMutableNodeColumns(capacity: number): MutableNodeColumns {
  return {
    id: new Array<string | number>(capacity),
    state: new Array<NodeState>(capacity),
    selectable: new Array<boolean>(capacity),
    highlightConnectedEdges: new Array<boolean>(capacity),
    data: new Array<Record<string, unknown>>(capacity)
  };
}

function createMutableEdgeColumns(capacity: number): MutableEdgeColumns {
  return {
    id: new Array<string | number>(capacity),
    sourceId: new Array<string | number>(capacity),
    targetId: new Array<string | number>(capacity),
    directed: new Array<boolean>(capacity),
    state: new Array<EdgeState>(capacity),
    data: new Array<Record<string, unknown>>(capacity)
  };
}
