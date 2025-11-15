// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as arrow from 'apache-arrow';

import type {NodeState, EdgeState} from '../core/constants';
import type {ArrowGraphData} from '../graph-data/graph-data';
import type {GraphProps, NodeInterface, EdgeInterface} from './graph';
import {Graph} from './graph';
import {cloneRecord, normalizeEdgeState, normalizeNodeState} from './graph-normalization';

import {getVectorLength,
getVectorValue,
getColumnVector,
parseDataRecord,
coerceIdentifier
} from './functions/arrow-utils'

type NodeOverride = {
  state?: NodeState;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  data?: Record<string, unknown>;
};

type EdgeOverride = {
  state?: EdgeState;
  directed?: boolean;
  data?: Record<string, unknown>;
};

type NodeVectors = {
  id: arrow.Vector | null;
  state: arrow.Vector | null;
  selectable: arrow.Vector | null;
  highlightConnectedEdges: arrow.Vector | null;
  data: arrow.Vector | null;
};

type EdgeVectors = {
  id: arrow.Vector | null;
  sourceId: arrow.Vector | null;
  targetId: arrow.Vector | null;
  directed: arrow.Vector | null;
  state: arrow.Vector | null;
  data: arrow.Vector | null;
};

export type ArrowGraphProps = GraphProps & {
  data: ArrowGraphData;
}

export class ArrowGraph extends Graph<ArrowGraphProps> {
  private readonly nodeTable: arrow.Table;
  private readonly edgeTable: arrow.Table;

  private readonly nodeVectors: NodeVectors;
  private readonly edgeVectors: EdgeVectors;

  private readonly nodeOverrides: NodeOverride[];
  private readonly edgeOverrides: EdgeOverride[];

  private readonly nodeDataCache: Array<Record<string, unknown> | null>;
  private readonly edgeDataCache: Array<Record<string, unknown> | null>;

  private readonly nodeEdgeIndices: number[][];
  private nodeIndices: WeakMap<NodeInterface, number> = new WeakMap();
  private edgeIndices: WeakMap<EdgeInterface, number> = new WeakMap();

  private readonly nodes: ArrowGraphNode[];
  private readonly edges: ArrowGraphEdge[];
  private readonly nodeMap: Map<string | number, ArrowGraphNode> = new Map();

  private readonly _version: number;

  constructor(props: ArrowGraphProps) {
    super(props);
    
    this._version = props.data.version;
    this.nodeTable = props.data.nodes;
    this.edgeTable = props.data.edges;

    this.nodeVectors = this.extractNodeVectors();
    this.edgeVectors = this.extractEdgeVectors();
    this.assertRequiredColumns();

    const nodeCount = getVectorLength(this.nodeVectors.id);
    const edgeCount = getVectorLength(this.edgeVectors.id);

    this.nodeOverrides = new Array(nodeCount);
    this.edgeOverrides = new Array(edgeCount);
    this.nodeDataCache = new Array(nodeCount).fill(null);
    this.edgeDataCache = new Array(edgeCount).fill(null);
    this.nodeEdgeIndices = Array.from({length: nodeCount}, () => []);

    this.nodes = this.initializeNodes(nodeCount);
    this.edges = this.initializeEdges(edgeCount);

    this.registerNodes();
    this.registerEdges();
  }

  get version(): number {
    return this._version;
  }

  getNodes(): Iterable<NodeInterface> {
    return this.nodes;
  }

  getEdges(): Iterable<EdgeInterface> {
    return this.edges;
  }

  findNode(id: string | number): NodeInterface | undefined {
    return this.nodeMap.get(id) ?? this.nodeMap.get(String(id));
  }

  findNodeById(id: string | number): NodeInterface | undefined {
    return this.findNode(id);
  }

  destroy(): void {
    this.nodeMap.clear();
    this.nodeIndices = new WeakMap();
    this.edgeIndices = new WeakMap();
    this.nodeEdgeIndices.length = 0;
    this.nodes.length = 0;
    this.edges.length = 0;
  }

  getNodeIdByIndex(index: number): string | number {
    const value = getVectorValue(this.nodeVectors.id, index);
    if (typeof value === 'undefined') {
      throw new Error('Arrow graph requires an id column for nodes.');
    }
    return coerceIdentifier(value);
  }

  getNodeStateByIndex(index: number): NodeState {
    const override = this.nodeOverrides[index]?.state;
    if (override) {
      return override;
    }
    const value = getVectorValue(this.nodeVectors.state, index);
    return normalizeNodeState(typeof value === 'string' ? (value as NodeState) : undefined);
  }

  setNodeStateByIndex(index: number, state: NodeState): void {
    const override = (this.nodeOverrides[index] ??= {});
    override.state = state;
  }

  isNodeSelectableByIndex(index: number): boolean {
    const override = this.nodeOverrides[index]?.selectable;
    if (typeof override === 'boolean') {
      return override;
    }
    const value = getVectorValue(this.nodeVectors.selectable, index);
    return coerceBoolean(value, false);
  }

  shouldHighlightConnectedEdgesByIndex(index: number): boolean {
    const override = this.nodeOverrides[index]?.highlightConnectedEdges;
    if (typeof override === 'boolean') {
      return override;
    }
    const value = getVectorValue(this.nodeVectors.highlightConnectedEdges, index);
    return coerceBoolean(value, false);
  }

  getNodeDegreeByIndex(index: number): number {
    return this.nodeEdgeIndices[index]?.length ?? 0;
  }

  getNodeInDegreeByIndex(index: number): number {
    const id = this.getNodeIdByIndex(index);
    return (this.nodeEdgeIndices[index] ?? []).reduce((count, edgeIndex) => {
      if (this.getEdgeTargetIdByIndex(edgeIndex) === id && this.isEdgeDirectedByIndex(edgeIndex)) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  getNodeOutDegreeByIndex(index: number): number {
    const id = this.getNodeIdByIndex(index);
    return (this.nodeEdgeIndices[index] ?? []).reduce((count, edgeIndex) => {
      if (this.getEdgeSourceIdByIndex(edgeIndex) === id && this.isEdgeDirectedByIndex(edgeIndex)) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  getNodeSiblingIdsByIndex(index: number): (string | number)[] {
    const id = this.getNodeIdByIndex(index);
    const edges = this.nodeEdgeIndices[index] ?? [];
    const siblings: (string | number)[] = [];
    for (const edgeIndex of edges) {
      const source = this.getEdgeSourceIdByIndex(edgeIndex);
      const target = this.getEdgeTargetIdByIndex(edgeIndex);
      if (source === id) {
        siblings.push(target);
      } else {
        siblings.push(source);
      }
    }
    return siblings;
  }

  getNodeConnectedEdgesByIndex(index: number): EdgeInterface[] {
    return (this.nodeEdgeIndices[index] ?? [])
      .map((edgeIndex) => this.edges[edgeIndex])
      .filter((edge): edge is ArrowGraphEdge => Boolean(edge));
  }

  setNodeDataByIndex(index: number, data: Record<string, unknown>): void {
    const override = (this.nodeOverrides[index] ??= {});
    override.data = {...data};
    this.nodeDataCache[index] = {...data};
  }

  setNodeDataPropertyByIndex(index: number, key: string, value: unknown): void {
    const data = this.getNodeDataInternal(index);
    data[key] = value;
    const override = (this.nodeOverrides[index] ??= {});
    override.data = {...data};
    this.nodeDataCache[index] = {...data};
  }

  getNodeDataByIndex(index: number): Record<string, unknown> {
    return cloneRecord(this.getNodeDataInternal(index));
  }

  getNodePropertyValueByIndex(index: number, key: string): unknown {
    const data = this.getNodeDataInternal(index);
    if (key in data) {
      return data[key];
    }
    const accessors = this.nodeVectors.data;
    if (!accessors) {
      return undefined;
    }
    return undefined;
  }

  registerEdgeForNode(node: NodeInterface, edge: EdgeInterface): void {
    const nodeIndex = this.nodeIndices.get(node);
    const edgeIndex = this.edgeIndices.get(edge);
    if (nodeIndex === undefined || edgeIndex === undefined) {
      return;
    }
    const edges = this.nodeEdgeIndices[nodeIndex];
    if (!edges.includes(edgeIndex)) {
      edges.push(edgeIndex);
    }
  }

  unregisterEdgeForNode(node: NodeInterface, edge: EdgeInterface): void {
    const nodeIndex = this.nodeIndices.get(node);
    const edgeIndex = this.edgeIndices.get(edge);
    if (nodeIndex === undefined || edgeIndex === undefined) {
      return;
    }
    const edges = this.nodeEdgeIndices[nodeIndex];
    const next = edges.filter((candidate) => candidate !== edgeIndex);
    this.nodeEdgeIndices[nodeIndex] = next;
  }

  getEdgeIdByIndex(index: number): string | number {
    const value = getVectorValue(this.edgeVectors.id, index);
    if (typeof value === 'undefined') {
      throw new Error('Arrow graph requires an id column for edges.');
    }
    return coerceIdentifier(value);
  }

  getEdgeStateByIndex(index: number): EdgeState {
    const override = this.edgeOverrides[index]?.state;
    if (override) {
      return override;
    }
    const value = getVectorValue(this.edgeVectors.state, index);
    return normalizeEdgeState(typeof value === 'string' ? (value as EdgeState) : undefined);
  }

  setEdgeStateByIndex(index: number, state: EdgeState): void {
    const override = (this.edgeOverrides[index] ??= {});
    override.state = state;
  }

  isEdgeDirectedByIndex(index: number): boolean {
    const override = this.edgeOverrides[index]?.directed;
    if (typeof override === 'boolean') {
      return override;
    }
    const value = getVectorValue(this.edgeVectors.directed, index);
    return coerceBoolean(value, false);
  }

  getEdgeSourceIdByIndex(index: number): string | number {
    const value = getVectorValue(this.edgeVectors.sourceId, index);
    if (typeof value === 'undefined') {
      throw new Error('Arrow graph requires a sourceId column.');
    }
    return coerceIdentifier(value);
  }

  getEdgeTargetIdByIndex(index: number): string | number {
    const value = getVectorValue(this.edgeVectors.targetId, index);
    if (typeof value === 'undefined') {
      throw new Error('Arrow graph requires a targetId column.');
    }
    return coerceIdentifier(value);
  }

  getEdgePropertyValueByIndex(index: number, key: string): unknown {
    const data = this.getEdgeDataInternal(index);
    return data[key];
  }

  setEdgeDataByIndex(index: number, data: Record<string, unknown>): void {
    const override = (this.edgeOverrides[index] ??= {});
    override.data = {...data};
    this.edgeDataCache[index] = {...data};
  }

  setEdgeDataPropertyByIndex(index: number, key: string, value: unknown): void {
    const data = this.getEdgeDataInternal(index);
    data[key] = value;
    const override = (this.edgeOverrides[index] ??= {});
    override.data = {...data};
    this.edgeDataCache[index] = {...data};
  }

  getEdgeDataByIndex(index: number): Record<string, unknown> {
    return cloneRecord(this.getEdgeDataInternal(index));
  }

  getEdgeConnectedNodesByIndex(index: number): NodeInterface[] {
    return this.edges[index]?.getConnectedNodes() ?? [];
  }

  private getNodeDataInternal(index: number): Record<string, unknown> {
    const override = this.nodeOverrides[index]?.data;
    if (override) {
      return override;
    }
    const cached = this.nodeDataCache[index];
    if (cached) {
      return cached;
    }
    const value = getVectorValue(this.nodeVectors.data, index);
    const data = parseDataRecord(value);
    this.nodeDataCache[index] = data;
    return data;
  }

  private getEdgeDataInternal(index: number): Record<string, unknown> {
    const override = this.edgeOverrides[index]?.data;
    if (override) {
      return override;
    }
    const cached = this.edgeDataCache[index];
    if (cached) {
      return cached;
    }
    const value = getVectorValue(this.edgeVectors.data, index);
    const data = parseDataRecord(value);
    this.edgeDataCache[index] = data;
    return data;
  }
  private extractNodeVectors(): NodeVectors {
    return {
      id: getColumnVector(this.nodeTable, 'id'),
      state: getColumnVector(this.nodeTable, 'state'),
      selectable: getColumnVector(this.nodeTable, 'selectable'),
      highlightConnectedEdges: getColumnVector(this.nodeTable, 'highlightConnectedEdges'),
      data: getColumnVector(this.nodeTable, 'data')
    };
  }

  private extractEdgeVectors(): EdgeVectors {
    return {
      id: getColumnVector(this.edgeTable, 'id'),
      sourceId: getColumnVector(this.edgeTable, 'sourceId'),
      targetId: getColumnVector(this.edgeTable, 'targetId'),
      directed: getColumnVector(this.edgeTable, 'directed'),
      state: getColumnVector(this.edgeTable, 'state'),
      data: getColumnVector(this.edgeTable, 'data')
    };
  }

  private assertRequiredColumns(): void {
    if (!this.nodeVectors.id) {
      throw new Error('Arrow graph requires an "id" column for nodes.');
    }
    if (!this.edgeVectors.id || !this.edgeVectors.sourceId || !this.edgeVectors.targetId) {
      throw new Error('Arrow graph requires "id", "sourceId", and "targetId" columns for edges.');
    }
  }

  private initializeNodes(count: number): ArrowGraphNode[] {
    return Array.from({length: count}, (_, index) => new ArrowGraphNode(this, index));
  }

  private initializeEdges(count: number): ArrowGraphEdge[] {
    return Array.from({length: count}, (_, index) => new ArrowGraphEdge(this, index));
  }

  private registerNodes(): void {
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index];
      const id = this.getNodeIdByIndex(index);
      registerNodeVariants(this.nodeMap, id, node);
      this.nodeIndices.set(node, index);
    }
  }

  private registerEdges(): void {
    for (let index = 0; index < this.edges.length; index++) {
      const edge = this.edges[index];
      this.edgeIndices.set(edge, index);

      const source = this.findNodeById(this.getEdgeSourceIdByIndex(index));
      if (source) {
        edge.addNode(source);
      }

      const target = this.findNodeById(this.getEdgeTargetIdByIndex(index));
      if (target) {
        edge.addNode(target);
      }
    }
  }
}

class ArrowGraphNode implements NodeInterface {
  public readonly isNode = true;

  get id(): string | number {
    return this.getId();
  }

  constructor(private readonly graph: ArrowGraph, private readonly index: number) {}

  getId(): string | number {
    return this.graph.getNodeIdByIndex(this.index);
  }

  getDegree(): number {
    return this.graph.getNodeDegreeByIndex(this.index);
  }

  getInDegree(): number {
    return this.graph.getNodeInDegreeByIndex(this.index);
  }

  getOutDegree(): number {
    return this.graph.getNodeOutDegreeByIndex(this.index);
  }

  getSiblingIds(): (string | number)[] {
    return this.graph.getNodeSiblingIdsByIndex(this.index);
  }

  getConnectedEdges(): EdgeInterface[] {
    return this.graph.getNodeConnectedEdgesByIndex(this.index);
  }

  addConnectedEdges(edge: EdgeInterface | EdgeInterface[]): void {
    const edges = Array.isArray(edge) ? edge : [edge];
    for (const candidate of edges) {
      candidate.addNode(this);
    }
  }

  removeConnectedEdges(edge: EdgeInterface | EdgeInterface[]): void {
    const edges = Array.isArray(edge) ? edge : [edge];
    for (const candidate of edges) {
      candidate.removeNode(this);
    }
  }

  clearConnectedEdges(): void {
    const edges = this.getConnectedEdges();
    for (const edge of edges) {
      edge.removeNode(this);
    }
  }

  getPropertyValue(key: string): unknown {
    return this.graph.getNodePropertyValueByIndex(this.index, key);
  }

  setData(data: Record<string, unknown>): void {
    this.graph.setNodeDataByIndex(this.index, data);
  }

  setDataProperty(key: string, value: unknown): void {
    this.graph.setNodeDataPropertyByIndex(this.index, key, value);
  }

  setState(state: NodeState): void {
    this.graph.setNodeStateByIndex(this.index, state);
  }

  getState(): NodeState {
    return this.graph.getNodeStateByIndex(this.index);
  }

  isSelectable(): boolean {
    return this.graph.isNodeSelectableByIndex(this.index);
  }

  shouldHighlightConnectedEdges(): boolean {
    return this.graph.shouldHighlightConnectedEdgesByIndex(this.index);
  }
}

class ArrowGraphEdge implements EdgeInterface {
  public readonly isEdge = true;
  private readonly connectedNodes: Map<string | number, NodeInterface> = new Map();

  get id(): string | number {
    return this.getId();
  }

  constructor(private readonly graph: ArrowGraph, private readonly index: number) {}

  getId(): string | number {
    return this.graph.getEdgeIdByIndex(this.index);
  }

  isDirected(): boolean {
    return this.graph.isEdgeDirectedByIndex(this.index);
  }

  getSourceNodeId(): string | number {
    return this.graph.getEdgeSourceIdByIndex(this.index);
  }

  getTargetNodeId(): string | number {
    return this.graph.getEdgeTargetIdByIndex(this.index);
  }

  getConnectedNodes(): NodeInterface[] {
    return [...this.connectedNodes.values()];
  }

  addNode(node: NodeInterface): void {
    this.connectedNodes.set(node.getId(), node);
    this.graph.registerEdgeForNode(node, this);
  }

  removeNode(node: NodeInterface): void {
    this.connectedNodes.delete(node.getId());
    this.graph.unregisterEdgeForNode(node, this);
  }

  getPropertyValue(key: string): unknown {
    return this.graph.getEdgePropertyValueByIndex(this.index, key);
  }

  setData(data: Record<string, unknown>): void {
    this.graph.setEdgeDataByIndex(this.index, data);
  }

  setDataProperty(key: string, value: unknown): void {
    this.graph.setEdgeDataPropertyByIndex(this.index, key, value);
  }

  setState(state: EdgeState): void {
    this.graph.setEdgeStateByIndex(this.index, state);
  }

  getState(): EdgeState {
    return this.graph.getEdgeStateByIndex(this.index);
  }
}

function registerNodeVariants(
  map: Map<string | number, ArrowGraphNode>,
  id: string | number,
  node: ArrowGraphNode
): void {
  map.set(id, node);
  if (typeof id === 'string') {
    const numeric = Number(id);
    if (!Number.isNaN(numeric) && id.trim() !== '') {
      map.set(numeric, node);
    }
  } else {
    map.set(String(id), node);
  }
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === '') {
      return false;
    }
  }
  return fallback;
}

