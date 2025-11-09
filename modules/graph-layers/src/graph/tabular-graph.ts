// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors


import type {EdgeState, NodeState} from '../core/constants';
import type {EdgeInterface, Graph, NodeInterface} from './graph';
import {LegacyGraph} from './legacy-graph';
import {Node} from './node';
import {Edge} from './edge';

export interface TabularNodeAccessors<Handle> {
  getId(node: Handle): string | number;
  getState?(node: Handle): NodeState;
  setState?(node: Handle, state: NodeState): void;
  isSelectable?(node: Handle): boolean;
  shouldHighlightConnectedEdges?(node: Handle): boolean;
  getPropertyValue?(node: Handle, key: string): unknown;
  setData?(node: Handle, data: Record<string, unknown>): void;
  setDataProperty?(node: Handle, key: string, value: unknown): void;
  getData?(node: Handle): Record<string, unknown> | null | undefined;
}

export interface TabularEdgeAccessors<Handle> {
  getId(edge: Handle): string | number;
  getSourceId(edge: Handle): string | number;
  getTargetId(edge: Handle): string | number;
  isDirected?(edge: Handle): boolean;
  getState?(edge: Handle): EdgeState;
  setState?(edge: Handle, state: EdgeState): void;
  getPropertyValue?(edge: Handle, key: string): unknown;
  setData?(edge: Handle, data: Record<string, unknown>): void;
  setDataProperty?(edge: Handle, key: string, value: unknown): void;
  getData?(edge: Handle): Record<string, unknown> | null | undefined;
}

export type TabularGraphAccessors<NodeHandle, EdgeHandle> = {
  node: TabularNodeAccessors<NodeHandle>;
  edge: TabularEdgeAccessors<EdgeHandle>;
};

export interface TabularGraphSource<NodeHandle = unknown, EdgeHandle = unknown> {
  readonly version: number;
  getNodes(): Iterable<NodeHandle>;
  getEdges(): Iterable<EdgeHandle>;
  getAccessors(): TabularGraphAccessors<NodeHandle, EdgeHandle>;
  findNodeById?(id: string | number): NodeHandle | null | undefined;
}

export type NodeIndex = number;
export type EdgeIndex = number;

type TabularNodeRecord<Handle> = {
  handle: Handle;
  id: string | number;
  state: NodeState;
  selectable: boolean;
  highlightConnectedEdges: boolean;
  data: Record<string, unknown>;
  connectedEdgeIndices: EdgeIndex[];
};

type TabularEdgeRecord<Handle> = {
  handle: Handle;
  id: string | number;
  state: EdgeState;
  directed: boolean;
  sourceId: string | number;
  targetId: string | number;
  data: Record<string, unknown>;
};

export class TabularNode<NodeHandle = unknown, EdgeHandle = unknown> implements NodeInterface {
  public readonly isNode = true;
  public readonly index: NodeIndex;
  public get id(): string | number {
    return this.getId();
  }

  public get state(): NodeState {
    return this.getState();
  }

  public set state(state: NodeState) {
    this.setState(state);
  }

  private readonly graph: TabularGraph<NodeHandle, EdgeHandle>;

  constructor(graph: TabularGraph<NodeHandle, EdgeHandle>, index: NodeIndex) {
    this.graph = graph;
    this.index = index;
  }

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

type EdgeNodeReference = {
  id: string | number;
  node: NodeInterface;
};

export class TabularEdge<NodeHandle = unknown, EdgeHandle = unknown> implements EdgeInterface {
  public readonly isEdge = true;
  public readonly index: EdgeIndex;
  public get id(): string | number {
    return this.getId();
  }

  public get directed(): boolean {
    return this.isDirected();
  }

  public get state(): EdgeState {
    return this.getState();
  }

  public set state(state: EdgeState) {
    this.setState(state);
  }

  private readonly graph: TabularGraph<NodeHandle, EdgeHandle>;
  private _connectedNodes: Record<string, NodeInterface> = {};

  constructor(
    graph: TabularGraph<NodeHandle, EdgeHandle>,
    index: EdgeIndex,
    connectedNodes: EdgeNodeReference[] = []
  ) {
    this.graph = graph;
    this.index = index;
    for (const reference of connectedNodes) {
      this._connectedNodes[reference.id] = reference.node;
    }
  }

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
    return Object.values(this._connectedNodes);
  }

  addNode(node: NodeInterface): void {
    this._connectedNodes[node.getId()] = node;
    this.graph.registerEdgeForNode(node, this);
  }

  removeNode(node: NodeInterface): void {
    delete this._connectedNodes[node.getId()];
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

export class TabularGraph<NodeHandle = unknown, EdgeHandle = unknown>
  extends EventTarget
  implements Graph
{
  private readonly source: TabularGraphSource<NodeHandle, EdgeHandle>;

  private _nodes: TabularNode<NodeHandle, EdgeHandle>[] | null = null;
  private _edges: TabularEdge<NodeHandle, EdgeHandle>[] | null = null;
  private _nodeMap: Map<string | number, TabularNode<NodeHandle, EdgeHandle>> | null = null;
  private _nodeTable: TabularNodeRecord<NodeHandle>[] | null = null;
  private _edgeTable: TabularEdgeRecord<EdgeHandle>[] | null = null;
  private _nodeIndices: WeakMap<NodeInterface, NodeIndex> = new WeakMap();
  private _edgeIndices: WeakMap<EdgeInterface, EdgeIndex> = new WeakMap();
  private _accessors: TabularGraphAccessors<NodeHandle, EdgeHandle> | null = null;
  private _lastVersion = -1;

  constructor(source: TabularGraphSource<NodeHandle, EdgeHandle>) {
    super();
    this.source = source;
  }

  get version(): number {
    return this.source.version;
  }

  getNodes(): Iterable<NodeInterface> {
    this._synchronize();
    return this._nodes ?? [];
  }

  getEdges(): Iterable<EdgeInterface> {
    this._synchronize();
    return this._edges ?? [];
  }

  findNodeById(id: string | number): NodeInterface | undefined {
    this._synchronize();
    return this._nodeMap?.get(id);
  }

  destroy(): void {
    this._nodes = null;
    this._edges = null;
    this._nodeMap = null;
    this._nodeTable = null;
    this._edgeTable = null;
    this._nodeIndices = new WeakMap();
    this._edgeIndices = new WeakMap();
    this._accessors = null;
  }

  toLegacyGraph(): LegacyGraph {
    this._synchronize();

    const nodeTable = this._nodeTable ?? [];
    const edgeTable = this._edgeTable ?? [];

    const legacyNodes: Node[] = nodeTable.map((record) => {
      const node = new Node({
        id: record.id,
        selectable: record.selectable,
        highlightConnectedEdges: record.highlightConnectedEdges,
        data: cloneRecord(record.data)
      });
      node.setState(record.state);
      return node;
    });

    const legacyEdges: Edge[] = edgeTable.map((record) => {
      const edge = new Edge({
        id: record.id,
        sourceId: record.sourceId,
        targetId: record.targetId,
        directed: record.directed,
        data: cloneRecord(record.data)
      });
      edge.setState(record.state);
      return edge;
    });

    const graph = new LegacyGraph();
    if (legacyNodes.length > 0) {
      graph.batchAddNodes(legacyNodes);
    }
    if (legacyEdges.length > 0) {
      graph.batchAddEdges(legacyEdges);
    }
    return graph;
  }

  getNodeIdByIndex(index: NodeIndex): string | number {
    return this._getNodeRecord(index).id;
  }

  getNodeStateByIndex(index: NodeIndex): NodeState {
    return this._getNodeRecord(index).state;
  }

  setNodeStateByIndex(index: NodeIndex, state: NodeState): void {
    const record = this._getNodeRecord(index);
    record.state = state;
    const accessors = this._getAccessors();
    accessors.node.setState?.(record.handle, state);
  }

  isNodeSelectableByIndex(index: NodeIndex): boolean {
    return this._getNodeRecord(index).selectable;
  }

  shouldHighlightConnectedEdgesByIndex(index: NodeIndex): boolean {
    return this._getNodeRecord(index).highlightConnectedEdges;
  }

  getNodeDegreeByIndex(index: NodeIndex): number {
    return this._getNodeRecord(index).connectedEdgeIndices.length;
  }

  getNodeInDegreeByIndex(index: NodeIndex): number {
    const nodeId = this.getNodeIdByIndex(index);
    return this._getNodeRecord(index).connectedEdgeIndices.reduce((count, edgeIndex) => {
      const edgeRecord = this._getEdgeRecord(edgeIndex);
      if (edgeRecord.directed && edgeRecord.targetId === nodeId) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  getNodeOutDegreeByIndex(index: NodeIndex): number {
    const nodeId = this.getNodeIdByIndex(index);
    return this._getNodeRecord(index).connectedEdgeIndices.reduce((count, edgeIndex) => {
      const edgeRecord = this._getEdgeRecord(edgeIndex);
      if (edgeRecord.directed && edgeRecord.sourceId === nodeId) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  getNodeSiblingIdsByIndex(index: NodeIndex): (string | number)[] {
    const nodeId = this.getNodeIdByIndex(index);
    return this._getNodeRecord(index).connectedEdgeIndices.reduce<(string | number)[]>(
      (siblings, edgeIndex) => {
        const edgeRecord = this._getEdgeRecord(edgeIndex);
        if (edgeRecord.targetId === nodeId) {
          siblings.push(edgeRecord.sourceId);
        } else {
          siblings.push(edgeRecord.targetId);
        }
        return siblings;
      },
      []
    );
  }

  getNodeConnectedEdgesByIndex(index: NodeIndex): EdgeInterface[] {
    const edges = this._edges ?? [];
    const record = this._getNodeRecord(index);
    return record.connectedEdgeIndices
      .map((edgeIndex) => edges[edgeIndex])
      .filter((edge): edge is TabularEdge<NodeHandle, EdgeHandle> => Boolean(edge));
  }

  setNodeDataByIndex(index: NodeIndex, data: Record<string, unknown>): void {
    const record = this._getNodeRecord(index);
    record.data = {...data};
    const accessors = this._getAccessors();
    accessors.node.setData?.(record.handle, record.data);
  }

  setNodeDataPropertyByIndex(index: NodeIndex, key: string, value: unknown): void {
    const record = this._getNodeRecord(index);
    record.data = {...record.data, [key]: value};
    const accessors = this._getAccessors();
    if (accessors.node.setDataProperty) {
      accessors.node.setDataProperty(record.handle, key, value);
    } else if (accessors.node.setData) {
      accessors.node.setData(record.handle, record.data);
    }
  }

  getNodeDataByIndex(index: NodeIndex): Record<string, unknown> {
    return {...this._getNodeRecord(index).data};
  }

  getNodePropertyValueByIndex(index: NodeIndex, key: string): unknown {
    const record = this._getNodeRecord(index);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const accessor = this._getAccessors().node.getPropertyValue;
    if (accessor) {
      const value = accessor(record.handle, key);
      if (value !== undefined) {
        return value;
      }
    }
    return record.data[key];
  }

  registerEdgeForNode(node: NodeInterface, edge: EdgeInterface): void {
    const nodeIndex = this._findNodeIndex(node);
    const edgeIndex = this._findEdgeIndex(edge);
    if (nodeIndex === undefined || edgeIndex === undefined) {
      return;
    }
    const record = this._getNodeRecord(nodeIndex);
    if (!record.connectedEdgeIndices.includes(edgeIndex)) {
      record.connectedEdgeIndices = [...record.connectedEdgeIndices, edgeIndex];
    }
  }

  unregisterEdgeForNode(node: NodeInterface, edge: EdgeInterface): void {
    const nodeIndex = this._findNodeIndex(node);
    const edgeIndex = this._findEdgeIndex(edge);
    if (nodeIndex === undefined || edgeIndex === undefined) {
      return;
    }
    const record = this._getNodeRecord(nodeIndex);
    record.connectedEdgeIndices = record.connectedEdgeIndices.filter((idx) => idx !== edgeIndex);
  }

  getEdgeIdByIndex(index: EdgeIndex): string | number {
    return this._getEdgeRecord(index).id;
  }

  getEdgeStateByIndex(index: EdgeIndex): EdgeState {
    return this._getEdgeRecord(index).state;
  }

  setEdgeStateByIndex(index: EdgeIndex, state: EdgeState): void {
    const record = this._getEdgeRecord(index);
    record.state = state;
    const accessors = this._getAccessors();
    accessors.edge.setState?.(record.handle, state);
  }

  isEdgeDirectedByIndex(index: EdgeIndex): boolean {
    return this._getEdgeRecord(index).directed;
  }

  getEdgeSourceIdByIndex(index: EdgeIndex): string | number {
    return this._getEdgeRecord(index).sourceId;
  }

  getEdgeTargetIdByIndex(index: EdgeIndex): string | number {
    return this._getEdgeRecord(index).targetId;
  }

  getEdgePropertyValueByIndex(index: EdgeIndex, key: string): unknown {
    const record = this._getEdgeRecord(index);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const accessor = this._getAccessors().edge.getPropertyValue;
    if (accessor) {
      const value = accessor(record.handle, key);
      if (value !== undefined) {
        return value;
      }
    }
    return record.data[key];
  }

  setEdgeDataByIndex(index: EdgeIndex, data: Record<string, unknown>): void {
    const record = this._getEdgeRecord(index);
    record.data = {...data};
    const accessors = this._getAccessors();
    accessors.edge.setData?.(record.handle, record.data);
  }

  setEdgeDataPropertyByIndex(index: EdgeIndex, key: string, value: unknown): void {
    const record = this._getEdgeRecord(index);
    record.data = {...record.data, [key]: value};
    const accessors = this._getAccessors();
    if (accessors.edge.setDataProperty) {
      accessors.edge.setDataProperty(record.handle, key, value);
    } else if (accessors.edge.setData) {
      accessors.edge.setData(record.handle, record.data);
    }
  }

  getEdgeDataByIndex(index: EdgeIndex): Record<string, unknown> {
    return {...this._getEdgeRecord(index).data};
  }

  private _synchronize(): void {
    if (
      this._lastVersion === this.source.version &&
      this._nodes &&
      this._edges &&
      this._nodeMap &&
      this._nodeTable &&
      this._edgeTable
    ) {
      return;
    }

    const {nodes, edges, nodeMap, nodeTable, edgeTable, nodeIndices, edgeIndices, accessors} =
      this._createEntities();
    this._nodes = nodes;
    this._edges = edges;
    this._nodeMap = nodeMap;
    this._nodeTable = nodeTable;
    this._edgeTable = edgeTable;
    this._nodeIndices = nodeIndices;
    this._edgeIndices = edgeIndices;
    this._accessors = accessors;
    this._lastVersion = this.source.version;
  }

  // eslint-disable-next-line max-statements
  private _createEntities(): {
    nodes: TabularNode<NodeHandle, EdgeHandle>[];
    edges: TabularEdge<NodeHandle, EdgeHandle>[];
    nodeMap: Map<string | number, TabularNode<NodeHandle, EdgeHandle>>;
    nodeTable: TabularNodeRecord<NodeHandle>[];
    edgeTable: TabularEdgeRecord<EdgeHandle>[];
    nodeIndices: WeakMap<NodeInterface, NodeIndex>;
    edgeIndices: WeakMap<EdgeInterface, EdgeIndex>;
    accessors: TabularGraphAccessors<NodeHandle, EdgeHandle>;
  } {
    const accessors = this.source.getAccessors();

    const nodeTable: TabularNodeRecord<NodeHandle>[] = [];
    const nodes: TabularNode<NodeHandle, EdgeHandle>[] = [];
    const nodeMap = new Map<string | number, TabularNode<NodeHandle, EdgeHandle>>();
    const nodeIndexById = new Map<string | number, NodeIndex>();
    const nodeIndices = new WeakMap<NodeInterface, NodeIndex>();

    let nodeIndex: NodeIndex = 0;
    for (const handle of this.source.getNodes()) {
      const id = accessors.node.getId(handle);
      const selectable = Boolean(accessors.node.isSelectable?.(handle));
      const highlightConnectedEdges = Boolean(
        accessors.node.shouldHighlightConnectedEdges?.(handle)
      );
      const state = accessors.node.getState?.(handle) ?? 'default';
      const data = cloneRecord(accessors.node.getData?.(handle));

      nodeTable.push({
        handle,
        id,
        selectable,
        highlightConnectedEdges,
        state,
        data,
        connectedEdgeIndices: []
      });

      const node = new TabularNode<NodeHandle, EdgeHandle>(this, nodeIndex);
      nodes.push(node);
      nodeMap.set(id, node);
      nodeIndexById.set(id, nodeIndex);
      nodeIndices.set(node, nodeIndex);
      nodeIndex += 1;
    }

    const edgeTable: TabularEdgeRecord<EdgeHandle>[] = [];
    const edges: TabularEdge<NodeHandle, EdgeHandle>[] = [];
    const edgeIndices = new WeakMap<EdgeInterface, EdgeIndex>();

    let edgeIndex: EdgeIndex = 0;
    for (const handle of this.source.getEdges()) {
      const id = accessors.edge.getId(handle);
      const sourceId = accessors.edge.getSourceId(handle);
      const targetId = accessors.edge.getTargetId(handle);
      const directed = Boolean(accessors.edge.isDirected?.(handle));
      const state = accessors.edge.getState?.(handle) ?? 'default';
      const data = cloneRecord(accessors.edge.getData?.(handle));

      const connectedNodes: EdgeNodeReference[] = [];
      const sourceIndex = nodeIndexById.get(sourceId);
      if (sourceIndex !== undefined) {
        nodeTable[sourceIndex].connectedEdgeIndices.push(edgeIndex);
        connectedNodes.push({
          id: nodeTable[sourceIndex].id,
          node: nodes[sourceIndex]
        });
      }
      const targetIndex = nodeIndexById.get(targetId);
      if (targetIndex !== undefined) {
        nodeTable[targetIndex].connectedEdgeIndices.push(edgeIndex);
        if (targetIndex !== sourceIndex) {
          connectedNodes.push({
            id: nodeTable[targetIndex].id,
            node: nodes[targetIndex]
          });
        }
      }

      edgeTable.push({
        handle,
        id,
        sourceId,
        targetId,
        directed,
        state,
        data
      });

      const edge = new TabularEdge<NodeHandle, EdgeHandle>(this, edgeIndex, connectedNodes);
      edges.push(edge);
      edgeIndices.set(edge, edgeIndex);
      edgeIndex += 1;
    }

    return {
      nodes,
      edges,
      nodeMap,
      nodeTable,
      edgeTable,
      nodeIndices,
      edgeIndices,
      accessors
    };
  }

  private _getNodeRecord(index: NodeIndex): TabularNodeRecord<NodeHandle> {
    if (!this._nodeTable || !this._nodeTable[index]) {
      throw new Error(`Node record not found for index ${index}`);
    }
    return this._nodeTable[index];
  }

  private _getEdgeRecord(index: EdgeIndex): TabularEdgeRecord<EdgeHandle> {
    if (!this._edgeTable || !this._edgeTable[index]) {
      throw new Error(`Edge record not found for index ${index}`);
    }
    return this._edgeTable[index];
  }

  private _getAccessors(): TabularGraphAccessors<NodeHandle, EdgeHandle> {
    if (!this._accessors) {
      this._accessors = this.source.getAccessors();
    }
    return this._accessors;
  }

  private _findEdgeIndex(edge: EdgeInterface): EdgeIndex | undefined {
    return this._edgeIndices.get(edge);
  }

  private _findNodeIndex(node: NodeInterface): NodeIndex | undefined {
    return this._nodeIndices.get(node);
  }
}

function cloneRecord(
  value: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return {...value};
}
