// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphData, GraphEdgeData, GraphNodeData} from './graph-data';
import {cloneRecord, normalizeVersion} from '../graph/graph-normalization';

export type GraphDataBuilderOptions = {
  version?: number;
};

export class GraphDataBuilder {
  private readonly nodes: GraphNodeData[] = [];
  private readonly edges: GraphEdgeData[] = [];

  private _version: number;

  constructor(options: GraphDataBuilderOptions = {}) {
    this._version = normalizeVersion(options.version);
  }

  get version(): number {
    return this._version;
  }

  setVersion(version: unknown): void {
    this._version = normalizeVersion(version);
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  get edgeCount(): number {
    return this.edges.length;
  }

  addNode(node: GraphNodeData): number {
    if (typeof node?.id === 'undefined') {
      throw new Error('Graph node requires an "id" field.');
    }

    const attributes = cloneRecord(node.attributes);
    const record: GraphNodeData = {
      ...node,
      attributes
    };

    this.nodes.push(record);
    return this.nodes.length - 1;
  }

  addEdge(edge: GraphEdgeData): number {
    if (
      typeof edge?.id === 'undefined' ||
      typeof edge?.sourceId === 'undefined' ||
      typeof edge?.targetId === 'undefined'
    ) {
      throw new Error('Graph edge requires "id", "sourceId", and "targetId" fields.');
    }

    const attributes = cloneRecord(edge.attributes);
    const record: GraphEdgeData = {
      ...edge,
      attributes
    };

    this.edges.push(record);
    return this.edges.length - 1;
  }

  build(): GraphData {
    return {
      version: this._version,
      nodes: this.nodes.map(cloneNodeData),
      edges: this.edges.map(cloneEdgeData)
    };
  }
}

function cloneNodeData(node: GraphNodeData): GraphNodeData {
  const attributes = cloneRecord(node.attributes);
  return {
    ...node,
    attributes
  };
}

function cloneEdgeData(edge: GraphEdgeData): GraphEdgeData {
  const attributes = cloneRecord(edge.attributes);
  return {
    ...edge,
    attributes
  };
}
