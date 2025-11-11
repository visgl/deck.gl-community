// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';

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

export type GraphProps = {
  onTransactionStart?: () => void;
  onTransactionEnd?: () => void;
  onNodeAdded?: (node: NodeInterface) => void;
  onNodeRemoved?: (node: NodeInterface) => void;
  onNodeUpdated?: (node: NodeInterface) => void;
  onEdgeAdded?: (edge: EdgeInterface) => void;
  onEdgeRemoved?: (edge: EdgeInterface) => void;
  onEdgeUpdated?: (edge: EdgeInterface) => void;
};

/** Runtime abstraction consumed by the rendering engine. */
export abstract class Graph {
  private _props: GraphProps;

  protected constructor(props: GraphProps = {}) {
    this._props = {...props};
  }

  get props(): GraphProps {
    return {...this._props};
  }

  setProps(props: GraphProps): void {
    this._props = {...props};
  }

  updateProps(props: GraphProps): void {
    this._props = {...this._props, ...props};
  }

  abstract get version(): number;
  abstract getNodes(): Iterable<NodeInterface>;
  abstract getEdges(): Iterable<EdgeInterface>;
  abstract findNodeById?(id: string | number): NodeInterface | undefined;
  abstract destroy?(): void;
}
