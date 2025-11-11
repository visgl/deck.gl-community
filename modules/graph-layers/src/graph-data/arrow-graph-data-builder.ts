// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// eslint-disable-next-line import/no-unresolved
import * as arrow from 'apache-arrow';

import type {EdgeState, NodeState} from '../core/constants';
import type {GraphEdgeData, GraphNodeData} from './graph-data';
import type {ArrowGraphData} from './arrow-graph-data';
import {
  cloneRecord,
  normalizeEdgeState,
  normalizeNodeState,
  normalizeVersion
} from '../graph/graph-normalization';

type Builder = ReturnType<typeof arrow.makeBuilder>;
type ArrowVector = ReturnType<Builder['toVector']>;
type ColumnBuilderMap = Map<string, Builder>;

export type ArrowGraphDataBuilderOptions = {
  version?: number;
};

export class ArrowGraphDataBuilder {
  private readonly nodeBuilders: ColumnBuilderMap = new Map();
  private readonly edgeBuilders: ColumnBuilderMap = new Map();

  private nodeLength = 0;
  private edgeLength = 0;

  private _version: number;

  constructor(options: ArrowGraphDataBuilderOptions = {}) {
    this._version = normalizeVersion(options.version);
  }

  get version(): number {
    return this._version;
  }

  setVersion(version: unknown): void {
    this._version = normalizeVersion(version);
  }

  addNode(node: GraphNodeData): number {
    if (typeof node?.id === 'undefined') {
      throw new Error('Graph node requires an "id" field.');
    }

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

    this.appendUtf8(this.nodeBuilders, 'id', node.id);
    this.appendUtf8(this.nodeBuilders, 'state', normalizeNodeState(stateCandidate));
    this.appendBoolean(this.nodeBuilders, 'selectable', Boolean(selectableCandidate));
    this.appendBoolean(this.nodeBuilders, 'highlightConnectedEdges', Boolean(highlightCandidate));
    this.appendJson(this.nodeBuilders, 'data', attributes);

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

    this.appendUtf8(this.edgeBuilders, 'id', edge.id);
    this.appendUtf8(this.edgeBuilders, 'sourceId', edge.sourceId);
    this.appendUtf8(this.edgeBuilders, 'targetId', edge.targetId);
    this.appendBoolean(this.edgeBuilders, 'directed', Boolean(directedCandidate));
    this.appendUtf8(this.edgeBuilders, 'state', normalizeEdgeState(stateCandidate));
    this.appendJson(this.edgeBuilders, 'data', attributes);

    return index;
  }

  finish(): ArrowGraphData {
    return {
      type: 'arrow-graph-data',
      version: this._version,
      nodes: tableFromBuilders(this.nodeBuilders),
      edges: tableFromBuilders(this.edgeBuilders)
    };
  }

  private appendUtf8(builders: ColumnBuilderMap, columnName: string, value: string | number): void {
    const builder = this.getOrCreateBuilder(builders, columnName, () =>
      arrow.makeBuilder({type: new arrow.Utf8(), nullValues: [null, undefined]})
    );
    builder.append(typeof value === 'number' ? String(value) : value);
  }

  private appendBoolean(builders: ColumnBuilderMap, columnName: string, value: boolean): void {
    const builder = this.getOrCreateBuilder(builders, columnName, () =>
      arrow.makeBuilder({type: new arrow.Bool(), nullValues: [null, undefined]})
    );
    builder.append(value);
  }

  private appendJson(builders: ColumnBuilderMap, columnName: string, value: Record<string, unknown>): void {
    const builder = this.getOrCreateBuilder(builders, columnName, () =>
      arrow.makeBuilder({type: new arrow.Utf8(), nullValues: [null, undefined]})
    );
    builder.append(JSON.stringify(value));
  }

  private getOrCreateBuilder(
    builders: ColumnBuilderMap,
    columnName: string,
    factory: () => Builder
  ): Builder {
    let builder = builders.get(columnName);
    if (!builder) {
      builder = factory();
      builders.set(columnName, builder);
    }
    return builder;
  }
}

function tableFromBuilders(builders: ColumnBuilderMap): arrow.Table {
  const columns: Record<string, ArrowVector> = {};

  for (const [columnName, builder] of builders.entries()) {
    builder.finish();
    columns[columnName] = builder.toVector();
  }

  return new arrow.Table(columns);
}

