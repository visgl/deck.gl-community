// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps, GRAPH_LAYOUT_DEFAULT_PROPS} from '../../core/graph-layout';
import type {Graph, NodeInterface, EdgeInterface} from '../../graph/graph';

export type HivePlotLayoutProps = GraphLayoutProps & {
  innerRadius?: number;
  outerRadius?: number;
  getNodeAxis?: (node: NodeInterface) => any;
};

export class HivePlotLayout extends GraphLayout<HivePlotLayoutProps> {
  static defaultProps = {
    ...GRAPH_LAYOUT_DEFAULT_PROPS,
    innerRadius: 100,
    outerRadius: 500,
    getNodeAxis: (node: NodeInterface) => node.getPropertyValue('group')
  } as const satisfies Readonly<Required<HivePlotLayoutProps>>;

  _name = 'HivePlot';
  _graph: Graph | null = null;
  _totalAxis: number = 0;
  _axis: Record<string, NodeInterface[]> = {};
  _nodeMap = new Map<string | number, NodeInterface>();
  _nodePositionMap = new Map<string | number, [number, number]>();

  constructor(props: HivePlotLayoutProps = {}) {
    super(props, HivePlotLayout.defaultProps);
  }

  initializeGraph(graph: Graph) {
    this.updateGraph(graph);
  }

  updateGraph(graph: Graph) {
    const {getNodeAxis, innerRadius, outerRadius} = this.props;
    this._graph = graph;
    const nodes = Array.from(graph.getNodes());
    this._nodeMap = new Map(nodes.map((node) => [node.getId(), node]));

    // bucket nodes into few axis

    this._axis = nodes.reduce((res, node) => {
      const axis = getNodeAxis(node);
      if (!res[axis]) {
        res[axis] = [];
      }
      res[axis].push(node);
      return res;
    }, {});

    // sort nodes along the same axis by degree
    this._axis = Object.keys(this._axis).reduce((res, axis) => {
      const bucketedNodes = this._axis[axis];
      const sortedNodes = bucketedNodes.sort((a, b) => {
        if (a.getDegree() > b.getDegree()) {
          return 1;
        }
        if (a.getDegree() === b.getDegree()) {
          return 0;
        }
        return -1;
      });
      res[axis] = sortedNodes;
      return res;
    }, {});
    this._totalAxis = Object.keys(this._axis).length;
    const center = [0, 0];
    const angleInterval = 360 / Object.keys(this._axis).length;

    // calculate positions
    this._nodePositionMap = new Map();
    Object.keys(this._axis).forEach((axis, axisIdx) => {
      const axisAngle = angleInterval * axisIdx;
      const bucketedNodes = this._axis[axis];
      const interval = (outerRadius - innerRadius) / bucketedNodes.length;

      bucketedNodes.forEach((node, idx) => {
        const radius = innerRadius + idx * interval;
        const x = Math.cos((axisAngle / 180) * Math.PI) * radius + center[0];
        const y = Math.sin((axisAngle / 180) * Math.PI) * radius + center[1];
        this._nodePositionMap.set(node.getId(), [x, y]);
      });
    });
  }

  start() {
    this._onLayoutStart();
    this._onLayoutChange();
    this._onLayoutDone();
  }

  stop() {}

  update() {}

  resume() {}

  getNodePosition = (node: NodeInterface) => this._nodePositionMap.get(node.getId());

  getEdgePosition = (edge: EdgeInterface) => {
    const {getNodeAxis} = this.props;
    const sourceNodeId = edge.getSourceNodeId();
    const targetNodeId = edge.getTargetNodeId();

    const sourcePosition = this._nodePositionMap.get(sourceNodeId);
    const targetPosition = this._nodePositionMap.get(targetNodeId);

    if (!sourcePosition || !targetPosition) {
      return null;
    }

    const sourceNode = this._nodeMap.get(sourceNodeId);
    const targetNode = this._nodeMap.get(targetNodeId);

    const sourceNodeAxis = sourceNode ? getNodeAxis(sourceNode) : null;
    const targetNodeAxis = targetNode ? getNodeAxis(targetNode) : null;

    if (sourceNodeAxis !== null && sourceNodeAxis === targetNodeAxis) {
      return {
        type: 'line',
        sourcePosition,
        targetPosition,
        controlPoints: []
      };
    }

    const controlPoint = computeControlPoint({
      sourcePosition,
      sourceNodeAxis: sourceNodeAxis ?? 0,
      targetPosition,
      targetNodeAxis: targetNodeAxis ?? 0,
      totalAxis: this._totalAxis
    });

    return {
      type: 'spline-curve',
      sourcePosition,
      targetPosition,
      controlPoints: [controlPoint]
    };
  };

  lockNodePosition = (node: NodeInterface, x: number, y: number) => {
    this._nodePositionMap.set(node.getId(), [x, y]);
    this._onLayoutChange();
    this._onLayoutDone();
  };

  protected override _updateBounds(): void {
    const positions = Array.from(this._nodePositionMap.values(), (position) =>
      this._normalizePosition(position)
    );
    this._bounds = this._calculateBounds(positions);
  }
}

function computeControlPoint({
  sourcePosition,
  sourceNodeAxis,
  targetPosition,
  targetNodeAxis,
  totalAxis
}): [number, number] {
  const halfAxis = (totalAxis - 1) / 2;
  // check whether the source/target are at the same side.
  const sameSide =
    (sourceNodeAxis <= halfAxis && targetNodeAxis <= halfAxis) ||
    (sourceNodeAxis > halfAxis && targetNodeAxis > halfAxis);
  // curve direction
  const direction = sameSide && sourceNodeAxis <= halfAxis && targetNodeAxis <= halfAxis ? 1 : -1;

  // flip the source/target to follow the clockwise diretion
  const source = sourceNodeAxis < targetNodeAxis && sameSide ? sourcePosition : targetPosition;
  const target = sourceNodeAxis < targetNodeAxis && sameSide ? targetPosition : sourcePosition;

  // calculate offset
  const distance = Math.hypot(source[0] - target[0], source[1] - target[1]);
  const offset = distance * 0.2;

  const midPoint = [(source[0] + target[0]) / 2, (source[1] + target[1]) / 2];
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const normal = [dy, -dx];
  const length = Math.hypot(dy, -dx);
  const normalized = [normal[0] / length, normal[1] / length];
  return [
    midPoint[0] + normalized[0] * offset * direction,
    midPoint[1] + normalized[1] * offset * direction
  ];
}
