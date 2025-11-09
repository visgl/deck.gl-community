// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds2D} from '@math.gl/types';

import type {GraphLayoutProps, GraphLayoutState} from './graph-layout';
import type {EdgeInterface, Graph, NodeInterface} from '../graph/graph';

export interface GraphRuntimeLayout {
  readonly version: number;
  readonly state: GraphLayoutState;
  getProps(): GraphLayoutProps;
  setProps(props: Partial<GraphLayoutProps>): void;
  initializeGraph(graph: Graph): void;
  updateGraph(graph: Graph): void;
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
