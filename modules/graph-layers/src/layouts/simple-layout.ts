// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps, GRAPH_LAYOUT_DEFAULT_PROPS} from '../core/graph-layout';
import type {Graph, NodeInterface, EdgeInterface} from '../graph/graph';

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
  nodePositionAccessor?: (node: NodeInterface) => [number, number];
};

/** A basic layout where the application controls positions of each node */
export class SimpleLayout extends GraphLayout<SimpleLayoutProps> {
  static defaultProps: Required<SimpleLayoutProps> = {
    ...GRAPH_LAYOUT_DEFAULT_PROPS,
    nodePositionAccessor: (node) =>
      [node.getPropertyValue('x'), node.getPropertyValue('y')] as [number, number]
  };

  protected readonly _name = 'SimpleLayout';
  protected _graph: Graph | null = null;
  protected _nodeMap: Map<string | number, NodeInterface> = new Map();
  protected _nodePositionMap: Map<string | number, [number, number] | null> = new Map();

  constructor(options: SimpleLayoutProps = {}) {
    super(options, SimpleLayout.defaultProps);
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
    const nodes = Array.from(graph.getNodes());
    this._nodeMap = new Map(nodes.map((node) => [node.getId(), node]));
    this._nodePositionMap = new Map(
      nodes.map((node) => [node.getId(), this._normalizePosition(this.props.nodePositionAccessor(node))])
    );
  }

  setNodePositionAccessor = (accessor) => {
    (this.props as any).nodePositionAccessor = accessor;
  };

  getNodePosition = (node: NodeInterface | null): [number, number] => {
    if (!node) {
      return [0, 0] as [number, number];
    }
    const position = this._nodePositionMap.get(node.getId());
    return position ?? [0, 0] as [number, number];
  };

  getEdgePosition = (edge: EdgeInterface) => {
    const sourceNode = this._nodeMap.get(edge.getSourceNodeId());
    const targetNode = this._nodeMap.get(edge.getTargetNodeId());
    const sourcePos = sourceNode ? this.getNodePosition(sourceNode) : [0, 0];
    const targetPos = targetNode ? this.getNodePosition(targetNode) : [0, 0];
    return {
      type: 'line',
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: []
    };
  };

  lockNodePosition = (node: NodeInterface, x: number, y: number) => {
    this._nodePositionMap.set(node.getId(), [x, y]);
    this._onLayoutChange();
    this._onLayoutDone();
  };

  _notifyLayoutComplete(): void {
    this._onLayoutStart();
    this._onLayoutChange();
    this._onLayoutDone();
  }


  protected override _updateBounds(): void {
    const positions = Array.from(this._nodePositionMap.values(), (position) =>
      this._normalizePosition(position)
    );
    this._bounds = this._calculateBounds(positions);
  }
}
