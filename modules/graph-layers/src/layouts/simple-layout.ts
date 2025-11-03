// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutOptions} from '../core/graph-layout';
import {Node} from '../graph/node';
import {Graph} from '../graph/graph';

export type SimpleLayoutOptions = GraphLayoutOptions & {
  /** The accessor lets the application supply the position ([x, y]) of each node.
   * @example
    ```js
    <GraphGL
      {...otherProps}
      layout={
        new SimpleLayout({
          nodePositionAccessor: node => [
            node.getPropertyValue('x'),
            node.getPropertyValue('y'),
          ]
        })
      }
    />
    ```
  */
  nodePositionAccessor?: (node: Node) => [number, number];
};

/** A basic layout where the application controls positions of each node */
export class SimpleLayout extends GraphLayout<SimpleLayoutOptions> {
  static defaultOptions: Required<SimpleLayoutOptions> = {
    nodePositionAccessor: (node) =>
      [node.getPropertyValue('x'), node.getPropertyValue('y')] as [number, number]
  };

  protected readonly _name = 'SimpleLayout';
  protected _graph: Graph | null = null;
  protected _nodeMap: Record<string, Node> = {};
  protected _nodePositionMap: Record<string, [number, number] | null> = {};

  constructor(options: SimpleLayoutOptions = {}) {
    super({...SimpleLayout.defaultOptions, ...options});
  }

  initializeGraph(graph: Graph): void {
    this.updateGraph(graph);
  }

  _notifyLayoutComplete(): void {
    this._onLayoutStart();
    this._onLayoutChange();
    this._onLayoutDone();
  }

  start(): void {
    this._notifyLayoutComplete();
  }

  update(): void {
    this._notifyLayoutComplete();
  }

  resume(): void {
    this._notifyLayoutComplete();
  }

  updateGraph(graph: Graph): void {
    this._graph = graph;
    this._nodeMap = graph.getNodes().reduce((res, node) => {
      res[node.getId()] = node;
      return res;
    }, {});
    this._nodePositionMap = graph.getNodes().reduce((res, node) => {
      res[node.getId()] = this._options.nodePositionAccessor(node);
      return res;
    }, {});
  }

  setNodePositionAccessor = (accessor) => {
    (this._options as any).nodePositionAccessor = accessor;
  };

  getNodePosition = (node) => this._nodePositionMap[node.getId()];

  getEdgePosition = (edge) => {
    const sourcePos = this._nodePositionMap[edge.getSourceNodeId()];
    const targetPos = this._nodePositionMap[edge.getTargetNodeId()];
    return {
      type: 'line',
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: []
    } as any;
  };

  lockNodePosition = (node, x, y) => {
    this._nodePositionMap[node.getId()] = [x, y];
    this._onLayoutChange();
    this._onLayoutDone();
  };

  protected override _updateBounds(): void {
    const positions = Object.values(this._nodePositionMap);
    this._bounds = this._calculateBounds(positions);
  }
}
