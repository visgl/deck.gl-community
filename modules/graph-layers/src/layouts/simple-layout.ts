// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutDefaultProps, GraphLayoutProps} from '../core/graph-layout';
import {Node} from '../graph/node';
import {Edge} from '../graph/edge';
import {LegacyGraph} from '../graph/legacy-graph';

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
  static defaultProps = {
    nodePositionAccessor: (node) =>
      [node.getPropertyValue('x'), node.getPropertyValue('y')] as [number, number]
  } as const satisfies GraphLayoutDefaultProps<SimpleLayoutProps>;

  protected readonly _name = 'SimpleLayout';
  protected _graph: LegacyGraph | null = null;
  protected _nodeMap: Record<string, Node> = {};
  protected _nodePositionMap: Record<string, [number, number] | null> = {};

  constructor(options: SimpleLayoutProps = {}) {
    super(options, SimpleLayout.defaultProps);
  }

  override setProps(props: Partial<SimpleLayoutProps>): boolean {
    const shouldUpdate = super.setProps(props);
    if ('nodePositionAccessor' in props) {
      this._refreshNodePositions();
    }
    return shouldUpdate;
  }

  initializeGraph(graph: LegacyGraph): void {
    this.setProps({graph});
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

  protected override updateGraph(graph: LegacyGraph): void {
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

  private _refreshNodePositions(): void {
    if (!this._graph) {
      return;
    }
    const nodes = Array.isArray(this._graph.getNodes())
      ? (this._graph.getNodes() as Node[])
      : (Array.from(this._graph.getNodes()) as Node[]);
    this._nodePositionMap = nodes.reduce<Record<string, [number, number] | null>>((res, node) => {
      res[node.getId()] = this._normalizePosition(this.props.nodePositionAccessor(node));
      return res;
    }, {});
  }
}
