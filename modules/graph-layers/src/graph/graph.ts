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

/** Runtime abstraction consumed by the rendering engine. */
export interface Graph extends EventTarget {
  readonly version: number;
  getNodes(): Iterable<NodeInterface>;
  getEdges(): Iterable<EdgeInterface>;
  findNodeById?(id: string | number): NodeInterface | undefined;
  destroy?(): void;
}
