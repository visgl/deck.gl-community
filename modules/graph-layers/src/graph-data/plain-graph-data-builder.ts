// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PlainGraphData, GraphEdgeData, GraphNodeData} from './graph-data';
import {GraphDataBuilder} from './graph-data-builder';
import {cloneRecord, normalizeVersion} from '../graph/graph-normalization';

export type PlainGraphDataBuilderOptions = {
  version?: number;
};

export class PlainGraphDataBuilder implements GraphDataBuilder {
  private readonly nodes: GraphNodeData[] = [];
  private readonly edges: GraphEdgeData[] = [];

  private _version: number;

  constructor(options: PlainGraphDataBuilderOptions = {}) {
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
    this._assignNodeAttributes(attributes, node);
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
    this._assignEdgeAttributes(attributes, edge);
    const record: GraphEdgeData = {
      ...edge,
      attributes
    };

    this.edges.push(record);
    return this.edges.length - 1;
  }

  private _assignNodeAttributes(target: Record<string, unknown>, node: GraphNodeData): void {
    if (typeof node.label !== 'undefined') {
      target.label = node.label;
    }
    if (typeof node.weight !== 'undefined') {
      target.weight = node.weight;
    }
    if (typeof node.state !== 'undefined') {
      target.state = node.state;
    }
    if (typeof node.selectable !== 'undefined') {
      target.selectable = node.selectable;
    }
    if (typeof node.highlightConnectedEdges !== 'undefined') {
      target.highlightConnectedEdges = node.highlightConnectedEdges;
    }
  }

  private _assignEdgeAttributes(target: Record<string, unknown>, edge: GraphEdgeData): void {
    if (typeof edge.label !== 'undefined') {
      target.label = edge.label;
    }
    if (typeof edge.weight !== 'undefined') {
      target.weight = edge.weight;
    }
    if (typeof edge.state !== 'undefined') {
      target.state = edge.state;
    }
    if (typeof edge.directed !== 'undefined') {
      target.directed = edge.directed;
    }
  }

  build(): PlainGraphData {
    return {
      shape: 'plain-graph-data',
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
