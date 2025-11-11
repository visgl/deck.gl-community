// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  GraphLayout,
  GraphLayoutProps,
  GRAPH_LAYOUT_DEFAULT_PROPS,
  type GraphEdgeLayout
} from '../core/graph-layout';
import {Node} from '../graph/node';
import {Edge} from '../graph/edge';
import {ClassicGraph} from '../graph/classic-graph';

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
    ...GRAPH_LAYOUT_DEFAULT_PROPS,
    nodePositionAccessor: (node) =>
      [node.getPropertyValue('x'), node.getPropertyValue('y')] as [number, number]
  };

  protected readonly _name = 'SimpleLayout';
  protected _graph: ClassicGraph | null = null;
  protected _nodeMap: Record<string, Node> = {};
  protected _nodePositionMap: Record<string, [number, number] | null> = {};

  constructor(options: SimpleLayoutProps = {}) {
    super(options, SimpleLayout.defaultProps);
  }

  initializeGraph(graph: ClassicGraph): void {
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

  updateGraph(graph: ClassicGraph): void {
    this._graph = graph;
    const nodes = Array.isArray(graph.getNodes())
      ? (graph.getNodes() as Node[])
      : (Array.from(graph.getNodes()) as Node[]);
    this._nodeMap = nodes.reduce((res, node) => {
      res[node.getId()] = node;
      return res;
    }, {});
    this._nodePositionMap = nodes.reduce<Record<string, [number, number] | null>>((res, node) => {
      res[node.getId()] = this._normalizePosition(this.props.nodePositionAccessor(node));
      return res;
    }, {});
  }

  setNodePositionAccessor = (accessor) => {
    (this.props as any).nodePositionAccessor = accessor;
  };

  getNodePosition = (node: Node | null): [number, number] | null => {
    if (!node) {
      return null;
    }
    const position = this._nodePositionMap[node.getId()];
    return position ?? null;
  };

  getEdgePosition = (edge: Edge): GraphEdgeLayout | null => {
    const sourceNode = this._nodeMap[edge.getSourceNodeId()];
    const targetNode = this._nodeMap[edge.getTargetNodeId()];
    if (!sourceNode || !targetNode) {
      return null;
    }

    const sourcePos = this.getNodePosition(sourceNode);
    const targetPos = this.getNodePosition(targetNode);
    if (!sourcePos || !targetPos) {
      return null;
    }

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
