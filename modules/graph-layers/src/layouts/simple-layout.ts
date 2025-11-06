// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../core/graph-layout';
import {Node} from '../graph/node';
import {Edge} from '../graph/edge';
import {Graph} from '../graph/graph';

export type SimpleLayoutProps = GraphLayoutProps & {
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
export class SimpleLayout extends GraphLayout<SimpleLayoutProps> {
  static defaultProps: Required<SimpleLayoutProps> = {
    nodePositionAccessor: (node) =>
      [node.getPropertyValue('x'), node.getPropertyValue('y')] as [number, number]
  };

  protected readonly _name = 'SimpleLayout';
  protected _graph: Graph | null = null;
  protected _nodeMap: Record<string, Node> = {};
  protected _nodePositionMap: Record<string, [number, number] | null> = {};

  constructor(options: SimpleLayoutProps = {}) {
    super({...SimpleLayout.defaultProps, ...options});
  }

  initializeGraph(graph: Graph): void {
    this.updateGraph(graph);
  }

  start(): void {
    this._notifyLayoutComplete();
  }

  stop() : void {}

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
    this._nodePositionMap = graph.getNodes().reduce<Record<string, [number, number] | null>>(
      (res, node) => {
        res[node.getId()] = this._normalizePosition(
          this._options.nodePositionAccessor(node)
        );
        return res;
      },
      {}
    );
  }

  setNodePositionAccessor = (accessor) => {
    (this._options as any).nodePositionAccessor = accessor;
  };

  getNodePosition = (node: Node | null): [number, number] => {
    if (!node) {
      return [0, 0] as [number, number];
    }
    const position = this._nodePositionMap[node.getId()];
    return position ?? [0, 0] as [number, number];
  };

  getEdgePosition = (edge: Edge) => {
    const sourceNode = this._nodeMap[edge.getSourceNodeId()];
    const targetNode = this._nodeMap[edge.getTargetNodeId()];
    const sourcePos = sourceNode ? this.getNodePosition(sourceNode) : [0, 0];
    const targetPos = targetNode ? this.getNodePosition(targetNode) : [0, 0];
    return {
      type: 'line',
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: []
    };
  };

  lockNodePosition = (node, x, y) => {
    this._nodePositionMap[node.getId()] = [x, y];
    this._onLayoutChange();
    this._onLayoutDone();
  };

  _notifyLayoutComplete(): void {
    this._onLayoutStart();
    this._onLayoutChange();
    this._onLayoutDone();
  }


  protected override _updateBounds(): void {
    const positions = Object.values(this._nodePositionMap).map((position) =>
      this._normalizePosition(position)
    );
    this._bounds = this._calculateBounds(positions);
  }
}
