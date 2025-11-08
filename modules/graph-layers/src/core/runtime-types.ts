// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds2D} from '@math.gl/types';

import {Graph} from '../graph/graph';
import type {Edge} from '../graph/edge';
import type {Node} from '../graph/node';
import {GraphLayout, type GraphLayoutState} from './graph-layout';
import type {GraphStylesheet} from '../style/graph-style-engine';
import {GraphStyleEngine} from '../style/graph-style-engine';
import {TabularGraphStylesheetEngine} from '../style/tabular-graph-style-engine';

import type {NodeState, EdgeState} from './constants';

/** Shared interface for graph nodes used by the rendering runtime. */
export interface NodeInterface {
  readonly isNode: boolean;
  getId(): string | number;
  getDegree(): number;
  getInDegree(): number;
  getOutDegree(): number;
  getSiblingIds(): (string | number)[];
  getConnectedEdges(): EdgeInterface[];
  addConnectedEdges(edge: EdgeInterface | EdgeInterface[]): void;
  removeConnectedEdges(edge: EdgeInterface | EdgeInterface[]): void;
  clearConnectedEdges(): void;
  getPropertyValue(key: string): unknown;
  setData(data: Record<string, unknown>): void;
  setDataProperty(key: string, value: unknown): void;
  setState(state: NodeState): void;
  getState(): NodeState;
  isSelectable(): boolean;
  shouldHighlightConnectedEdges(): boolean;
}

/** Shared interface for graph edges used by the rendering runtime. */
export interface EdgeInterface {
  readonly isEdge: boolean;
  getId(): string | number;
  isDirected(): boolean;
  getSourceNodeId(): string | number;
  getTargetNodeId(): string | number;
  getConnectedNodes(): NodeInterface[];
  addNode(node: NodeInterface): void;
  removeNode(node: NodeInterface): void;
  getPropertyValue(key: string): unknown;
  setData(data: Record<string, unknown>): void;
  setDataProperty(key: string, value: unknown): void;
  setState(state: EdgeState): void;
  getState(): EdgeState;
}

/** Layout contract used by the rendering runtime. */
export interface GraphRuntimeLayout extends EventTarget {
  readonly version: number;
  readonly state: GraphLayoutState;
  initializeGraph(graph: GraphInterface): void;
  updateGraph(graph: GraphInterface): void;
  start(): void;
  update(): void;
  resume(): void;
  stop(): void;
  getBounds(): Bounds2D | null;
  getNodePosition(node: NodeInterface): [number, number] | null | undefined;
  getEdgePosition(edge: EdgeInterface): unknown;
  lockNodePosition(node: NodeInterface, x: number, y: number): void;
  unlockNodePosition(node: NodeInterface): void;
  destroy?(): void;
}

export type TabularGraphLayout = GraphRuntimeLayout;

/** Runtime abstraction consumed by the rendering engine. */
export interface GraphInterface extends EventTarget {
  readonly version: number;
  getNodes(): Iterable<NodeInterface>;
  getEdges(): Iterable<EdgeInterface>;
  findNodeById?(id: string | number): NodeInterface | undefined;
  createStylesheetEngine(
    style: GraphStylesheet,
    options?: {stateUpdateTrigger?: unknown}
  ): GraphStyleEngine;
  destroy?(): void;
}

/** Accessor contract for tabular-node backed runtimes. */
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

/** Accessor contract for tabular-edge backed runtimes. */
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

/** External tabular graph source consumed by {@link TabularGraph}. */
export interface TabularGraphSource<NodeHandle = unknown, EdgeHandle = unknown> {
  readonly version: number;
  getNodes(): Iterable<NodeHandle>;
  getEdges(): Iterable<EdgeHandle>;
  getAccessors(): TabularGraphAccessors<NodeHandle, EdgeHandle>;
  findNodeById?(id: string | number): NodeHandle | null | undefined;
}

/**
 * Wrapper for tabular graph nodes so the rendering stack can interact with them
 * using the familiar {@link NodeInterface} contract.
 */
export class TabularNode<Handle> implements NodeInterface {
  public readonly isNode = true;

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
    const edges = Array.isArray(edge) ? edge : [edge];
    for (const entry of edges) {
      this._connectedEdges[entry.getId()] = entry;
      entry.addNode(this);
    }
  }

  removeConnectedEdges(edge: EdgeInterface | EdgeInterface[]): void {
    const edges = Array.isArray(edge) ? edge : [edge];
    for (const entry of edges) {
      entry.removeNode(this);
      delete this._connectedEdges[entry.getId()];
    }
  }

  clearConnectedEdges(): void {
    for (const edge of Object.values(this._connectedEdges)) {
      edge.removeNode(this);
    }
    this._connectedEdges = {};
  }

  getPropertyValue(key: string): unknown {
    if (typeof this.accessors.getPropertyValue === 'function') {
      const value = this.accessors.getPropertyValue(this.handle, key);
      if (value !== undefined) {
        return value;
      }
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
    if (typeof this.accessors.isSelectable === 'function') {
      return Boolean(this.accessors.isSelectable(this.handle));
    }
    return this._selectable;
  }

  shouldHighlightConnectedEdges(): boolean {
    if (typeof this.accessors.shouldHighlightConnectedEdges === 'function') {
      return Boolean(this.accessors.shouldHighlightConnectedEdges(this.handle));
    }
    return this._highlightConnectedEdges;
  }
}

/**
 * Wrapper for tabular graph edges so the rendering stack can interact with them
 * using the familiar {@link EdgeInterface} contract.
 */
export class TabularEdge<Handle> implements EdgeInterface {
  public readonly isEdge = true;

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
      const value = this.accessors.getPropertyValue(this.handle, key);
      if (value !== undefined) {
        return value;
      }
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

/** Graph runtime that wraps tabular sources and exposes {@link GraphInterface}. */
export class TabularGraph<NodeHandle = unknown, EdgeHandle = unknown>
  extends EventTarget
  implements GraphInterface
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

/** Graph runtime that wraps the legacy {@link Graph} implementation. */
export class LegacyGraph extends EventTarget implements GraphInterface {
  private readonly graph: Graph;
  private readonly eventForwarders = new Map<string, EventListener>();

  constructor(graph: Graph) {
    super();
    this.graph = graph;
    this._bindEvents();
  }

  get version(): number {
    return this.graph.version;
  }

  getNodes(): Iterable<NodeInterface> {
    return this.graph.getNodes();
  }

  getEdges(): Iterable<EdgeInterface> {
    return this.graph.getEdges();
  }

  findNodeById(id: string | number): NodeInterface | undefined {
    return this.graph.findNode(id);
  }

  createStylesheetEngine(
    style: GraphStylesheet,
    options: {stateUpdateTrigger?: unknown} = {}
  ): GraphStyleEngine {
    return new GraphStyleEngine(style, options);
  }

  destroy(): void {
    for (const [type, handler] of this.eventForwarders) {
      this.graph.removeEventListener(type, handler);
    }
    this.eventForwarders.clear();
  }

  /** Exposes the wrapped {@link Graph} for legacy layout adapters. */
  getLegacyGraph(): Graph {
    return this.graph;
  }

  private _bindEvents(): void {
    const eventTypes: string[] = [
      'transactionStart',
      'transactionEnd',
      'onNodeAdded',
      'onNodeRemoved',
      'onEdgeAdded',
      'onEdgeRemoved'
    ];

    for (const type of eventTypes) {
      const forwarder: EventListener = (event: Event) => {
        if (event instanceof CustomEvent) {
          this.dispatchEvent(new CustomEvent(type, {detail: event.detail}));
        } else {
          this.dispatchEvent(new Event(type));
        }
      };
      this.graph.addEventListener(type, forwarder);
      this.eventForwarders.set(type, forwarder);
    }
  }
}

/** Layout adapter that bridges {@link GraphLayout} with {@link GraphRuntimeLayout}. */
export class LegacyGraphLayoutAdapter extends EventTarget implements GraphRuntimeLayout {
  private readonly layout: GraphLayout;
  private readonly eventForwarders = new Map<string, EventListener>();

  constructor(layout: GraphLayout) {
    super();
    this.layout = layout;
    this._bindEvents();
  }

  get version(): number {
    return this.layout.version;
  }

  get state(): GraphLayoutState {
    return this.layout.state;
  }

  initializeGraph(graph: GraphInterface): void {
    this.layout.initializeGraph(this._assertLegacyGraph(graph));
  }

  updateGraph(graph: GraphInterface): void {
    this.layout.updateGraph(this._assertLegacyGraph(graph));
  }

  start(): void {
    this.layout.start();
  }

  update(): void {
    this.layout.update();
  }

  resume(): void {
    this.layout.resume();
  }

  stop(): void {
    this.layout.stop();
  }

  getBounds(): Bounds2D | null {
    return this.layout.getBounds();
  }

  getNodePosition(node: NodeInterface): [number, number] | null {
    return this.layout.getNodePosition(node as Node);
  }

  getEdgePosition(edge: EdgeInterface): unknown {
    return this.layout.getEdgePosition(edge as Edge);
  }

  lockNodePosition(node: NodeInterface, x: number, y: number): void {
    this.layout.lockNodePosition(node as Node, x, y);
  }

  unlockNodePosition(node: NodeInterface): void {
    this.layout.unlockNodePosition(node as Node);
  }

  destroy(): void {
    for (const [type, handler] of this.eventForwarders) {
      this.layout.removeEventListener(type, handler);
    }
    this.eventForwarders.clear();
  }

  private _assertLegacyGraph(graph: GraphInterface): Graph {
    if (graph instanceof LegacyGraph) {
      return graph.getLegacyGraph();
    }
    throw new Error('LegacyGraphLayoutAdapter expects a LegacyGraph instance.');
  }

  private _bindEvents(): void {
    const eventTypes: string[] = [
      'onLayoutStart',
      'onLayoutChange',
      'onLayoutDone',
      'onLayoutError'
    ];

    for (const type of eventTypes) {
      const forwarder: EventListener = (event: Event) => {
        if (event instanceof CustomEvent) {
          this.dispatchEvent(new CustomEvent(type, {detail: event.detail}));
        } else {
          this.dispatchEvent(new Event(type));
        }
      };
      this.layout.addEventListener(type, forwarder);
      this.eventForwarders.set(type, forwarder);
    }
  }
}
