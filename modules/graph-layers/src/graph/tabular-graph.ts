// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphStylesheet} from '../style/graph-style-engine';
import {GraphStyleEngine} from '../style/graph-style-engine';
import {TabularGraphStylesheetEngine} from '../style/tabular-graph-style-engine';

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

export class TabularNode<Handle> implements NodeInterface {
  public readonly isNode = true;
  public get id(): string | number {
    return this.getId();
  }

  public get state(): NodeState {
    return this.getState();
  }

  public set state(state: NodeState) {
    this.setState(state);
  }

  private readonly handle: Handle;
  private readonly accessors: TabularNodeAccessors<Handle>;
  private _state: NodeState = 'default';
  private _selectable: boolean = false;
  private _highlightConnectedEdges: boolean = false;
  private _data: Record<string, unknown> = {};
  private _connectedEdges: Record<string, EdgeInterface> = {};

  constructor(handle: Handle, accessors: TabularNodeAccessors<Handle>) {
    this.handle = handle;
    this.accessors = accessors;

    if (typeof accessors.getState === 'function') {
      this._state = accessors.getState(handle);
    }
    if (typeof accessors.isSelectable === 'function') {
      this._selectable = Boolean(accessors.isSelectable(handle));
    }
    if (typeof accessors.shouldHighlightConnectedEdges === 'function') {
      this._highlightConnectedEdges = Boolean(accessors.shouldHighlightConnectedEdges(handle));
    }
    if (typeof accessors.getData === 'function') {
      const data = accessors.getData(handle);
      if (data && typeof data === 'object') {
        this._data = {...data};
      }
    }
  }

  getId(): string | number {
    return this.accessors.getId(this.handle);
  }

  getDegree(): number {
    return Object.keys(this._connectedEdges).length;
  }

  getInDegree(): number {
    const nodeId = this.getId();
    return this.getConnectedEdges().reduce((count, edge) => {
      if (edge.isDirected() && edge.getTargetNodeId() === nodeId) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  getOutDegree(): number {
    const nodeId = this.getId();
    return this.getConnectedEdges().reduce((count, edge) => {
      if (edge.isDirected() && edge.getSourceNodeId() === nodeId) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  getSiblingIds(): (string | number)[] {
    const nodeId = this.getId();
    return this.getConnectedEdges().reduce<(string | number)[]>((siblings, edge) => {
      if (edge.getTargetNodeId() === nodeId) {
        siblings.push(edge.getSourceNodeId());
      } else {
        siblings.push(edge.getTargetNodeId());
      }
      return siblings;
    }, []);
  }

  getConnectedEdges(): EdgeInterface[] {
    return Object.values(this._connectedEdges);
  }

  addConnectedEdges(edge: EdgeInterface | EdgeInterface[]): void {
    if (Array.isArray(edge)) {
      edge.forEach((e) => this.addConnectedEdges(e));
      return;
    }
    this._connectedEdges[edge.getId()] = edge;
  }

  removeConnectedEdges(edge: EdgeInterface | EdgeInterface[]): void {
    if (Array.isArray(edge)) {
      edge.forEach((e) => this.removeConnectedEdges(e));
      return;
    }
    delete this._connectedEdges[edge.getId()];
  }

  clearConnectedEdges(): void {
    this._connectedEdges = {};
  }

  getPropertyValue(key: string): unknown {
    if (typeof this.accessors.getPropertyValue === 'function') {
      return this.accessors.getPropertyValue(this.handle, key);
    }
    return this._data[key];
  }

  setData(data: Record<string, unknown>): void {
    if (typeof this.accessors.setData === 'function') {
      this.accessors.setData(this.handle, data);
    }
    this._data = {...data};
  }

  setDataProperty(key: string, value: unknown): void {
    if (typeof this.accessors.setDataProperty === 'function') {
      this.accessors.setDataProperty(this.handle, key, value);
    }
    this._data[key] = value;
  }

  setState(state: NodeState): void {
    this._state = state;
    if (typeof this.accessors.setState === 'function') {
      this.accessors.setState(this.handle, state);
    }
  }

  getState(): NodeState {
    if (typeof this.accessors.getState === 'function') {
      return this.accessors.getState(this.handle);
    }
    return this._state;
  }

  isSelectable(): boolean {
    return this._selectable;
  }

  shouldHighlightConnectedEdges(): boolean {
    return this._highlightConnectedEdges;
  }
}

export class TabularEdge<Handle> implements EdgeInterface {
  public readonly isEdge = true;
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

  private readonly handle: Handle;
  private readonly accessors: TabularEdgeAccessors<Handle>;
  private _state: EdgeState = 'default';
  private _data: Record<string, unknown> = {};
  private _connectedNodes: Record<string, NodeInterface> = {};

  constructor(handle: Handle, accessors: TabularEdgeAccessors<Handle>) {
    this.handle = handle;
    this.accessors = accessors;

    if (typeof accessors.getState === 'function') {
      this._state = accessors.getState(handle);
    }
    if (typeof accessors.getData === 'function') {
      const data = accessors.getData(handle);
      if (data && typeof data === 'object') {
        this._data = {...data};
      }
    }
  }

  getId(): string | number {
    return this.accessors.getId(this.handle);
  }

  isDirected(): boolean {
    if (typeof this.accessors.isDirected === 'function') {
      return Boolean(this.accessors.isDirected(this.handle));
    }
    return false;
  }

  getSourceNodeId(): string | number {
    return this.accessors.getSourceId(this.handle);
  }

  getTargetNodeId(): string | number {
    return this.accessors.getTargetId(this.handle);
  }

  getConnectedNodes(): NodeInterface[] {
    return Object.values(this._connectedNodes);
  }

  addNode(node: NodeInterface): void {
    this._connectedNodes[node.getId()] = node;
  }

  removeNode(node: NodeInterface): void {
    delete this._connectedNodes[node.getId()];
  }

  getPropertyValue(key: string): unknown {
    if (typeof this.accessors.getPropertyValue === 'function') {
      return this.accessors.getPropertyValue(this.handle, key);
    }
    return this._data[key];
  }

  setData(data: Record<string, unknown>): void {
    if (typeof this.accessors.setData === 'function') {
      this.accessors.setData(this.handle, data);
    }
    this._data = {...data};
  }

  setDataProperty(key: string, value: unknown): void {
    if (typeof this.accessors.setDataProperty === 'function') {
      this.accessors.setDataProperty(this.handle, key, value);
    }
    this._data[key] = value;
  }

  setState(state: EdgeState): void {
    this._state = state;
    if (typeof this.accessors.setState === 'function') {
      this.accessors.setState(this.handle, state);
    }
  }

  getState(): EdgeState {
    if (typeof this.accessors.getState === 'function') {
      return this.accessors.getState(this.handle);
    }
    return this._state;
  }
}

export class TabularGraph<NodeHandle = unknown, EdgeHandle = unknown>
  extends EventTarget
  implements Graph
{
  private readonly source: TabularGraphSource<NodeHandle, EdgeHandle>;

  private _nodes: TabularNode<NodeHandle>[] | null = null;
  private _edges: TabularEdge<EdgeHandle>[] | null = null;
  private _nodeMap: Map<string | number, TabularNode<NodeHandle>> | null = null;
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

  createStylesheetEngine(
    style: GraphStylesheet,
    options: {stateUpdateTrigger?: unknown} = {}
  ): GraphStyleEngine {
    return new TabularGraphStylesheetEngine(style, options);
  }

  destroy(): void {
    this._nodes = null;
    this._edges = null;
    this._nodeMap = null;
  }

  toLegacyGraph(): LegacyGraph {
    const accessors = this.source.getAccessors();

    const legacyNodes: Node[] = [];
    for (const handle of this.source.getNodes()) {
      const id = accessors.node.getId(handle);
      const data = cloneRecord(accessors.node.getData?.(handle));
      const node = new Node({
        id,
        selectable: Boolean(accessors.node.isSelectable?.(handle)),
        highlightConnectedEdges: Boolean(accessors.node.shouldHighlightConnectedEdges?.(handle)),
        data
      });
      const state = accessors.node.getState?.(handle);
      if (state) {
        node.setState(state);
      }
      legacyNodes.push(node);
    }

    const legacyEdges: Edge[] = [];
    for (const handle of this.source.getEdges()) {
      const edge = new Edge({
        id: accessors.edge.getId(handle),
        sourceId: accessors.edge.getSourceId(handle),
        targetId: accessors.edge.getTargetId(handle),
        directed: Boolean(accessors.edge.isDirected?.(handle)),
        data: cloneRecord(accessors.edge.getData?.(handle))
      });
      const state = accessors.edge.getState?.(handle);
      if (state) {
        edge.setState(state);
      }
      legacyEdges.push(edge);
    }

    const graph = new LegacyGraph();
    if (legacyNodes.length > 0) {
      graph.batchAddNodes(legacyNodes);
    }
    if (legacyEdges.length > 0) {
      graph.batchAddEdges(legacyEdges);
    }
    return graph;
  }

  private _synchronize(): void {
    if (this._lastVersion === this.source.version && this._nodes && this._edges && this._nodeMap) {
      return;
    }

    const {nodes, edges, nodeMap} = this._createEntities();
    this._nodes = nodes;
    this._edges = edges;
    this._nodeMap = nodeMap;
    this._lastVersion = this.source.version;
  }

  private _createEntities(): {
    nodes: TabularNode<NodeHandle>[];
    edges: TabularEdge<EdgeHandle>[];
    nodeMap: Map<string | number, TabularNode<NodeHandle>>;
  } {
    const accessors = this.source.getAccessors();
    const nodeMap = new Map<string | number, TabularNode<NodeHandle>>();
    const nodes: TabularNode<NodeHandle>[] = [];
    for (const handle of this.source.getNodes()) {
      const node = new TabularNode(handle, accessors.node);
      nodes.push(node);
      nodeMap.set(node.getId(), node);
    }

    const edges: TabularEdge<EdgeHandle>[] = [];
    for (const handle of this.source.getEdges()) {
      edges.push(new TabularEdge(handle, accessors.edge));
    }

    for (const edge of edges) {
      const sourceNode = nodeMap.get(edge.getSourceNodeId());
      const targetNode = nodeMap.get(edge.getTargetNodeId());
      if (sourceNode) {
        sourceNode.addConnectedEdges(edge);
      }
      if (targetNode) {
        targetNode.addConnectedEdges(edge);
      }
    }

    return {nodes, edges, nodeMap};
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
