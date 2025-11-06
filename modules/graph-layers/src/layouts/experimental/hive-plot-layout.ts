// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import {Node} from '../../graph/node';
import {Graph} from '../../graph/graph';

export type HivePlotLayoutProps = GraphLayoutProps & {
  innerRadius?: number;
  outerRadius?: number;
  getNodeAxis?: (node: Node) => any;
};

export class HivePlotLayout extends GraphLayout<HivePlotLayoutProps> {
  static defaultProps = {
    innerRadius: 100,
    outerRadius: 500,
    getNodeAxis: (node: Node) => node.getPropertyValue('group')
  } as const satisfies Readonly<Required<HivePlotLayoutProps>>;

  _name = 'HivePlot';
  _graph: Graph;
  _totalAxis: number;
  _axis: Record<string, any>;
  _nodeMap = {};
  _nodePositionMap = {};

  constructor(options: HivePlotLayoutProps = {}) {
    super(options);
    this._options = {
      ...HivePlotLayout.defaultProps,
      ...options
    };
  }

  initializeGraph(graph: Graph) {
    this.updateGraph(graph);
  }

  updateGraph(graph) {
    const {getNodeAxis, innerRadius, outerRadius} = this._options;
    this._graph = graph;
    this._nodeMap = graph.getNodes().reduce((res, node) => {
      res[node.getId()] = node;
      return res;
    }, {});

    // bucket nodes into few axis

    this._axis = graph.getNodes().reduce((res, node) => {
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
    this._nodePositionMap = Object.keys(this._axis).reduce((res, axis, axisIdx) => {
      const axisAngle = angleInterval * axisIdx;
      const bucketedNodes = this._axis[axis];
      const interval = (outerRadius - innerRadius) / bucketedNodes.length;

      bucketedNodes.forEach((node, idx) => {
        const radius = innerRadius + idx * interval;
        const x = Math.cos((axisAngle / 180) * Math.PI) * radius + center[0];
        const y = Math.sin((axisAngle / 180) * Math.PI) * radius + center[1];
        res[node.getId()] = [x, y];
      });
      return res;
    }, {});
  }

  start() {
    this._onLayoutChange();
    this._onLayoutDone();
  }

  stop() {}

  update() {}

  resume() {}

  getNodePosition = (node) => this._nodePositionMap[node.getId()];

  getEdgePosition = (edge) => {
    const {getNodeAxis} = this._options;
    const sourceNodeId = edge.getSourceNodeId();
    const targetNodeId = edge.getTargetNodeId();

    const sourcePosition = this._nodePositionMap[sourceNodeId];
    const targetPosition = this._nodePositionMap[targetNodeId];

    const sourceNode = this._nodeMap[sourceNodeId];
    const targetNode = this._nodeMap[targetNodeId];

    const sourceNodeAxis = getNodeAxis(sourceNode);
    const targetNodeAxis = getNodeAxis(targetNode);

    if (sourceNodeAxis === targetNodeAxis) {
      return {
        type: 'line',
        sourcePosition,
        targetPosition,
        controlPoints: []
      };
    }

    const controlPoint = computeControlPoint({
      sourcePosition,
      sourceNodeAxis,
      targetPosition,
      targetNodeAxis,
      totalAxis: this._totalAxis
    });

    return {
      type: 'spline-curve',
      sourcePosition,
      targetPosition,
      controlPoints: [controlPoint]
    };
  };

  lockNodePosition = (node, x, y) => {
    this._nodePositionMap[node.id] = [x, y];
    this._onLayoutChange();
    this._onLayoutDone();
  };

  protected override _updateBounds(): void {
    const positions = Object.values(this._nodePositionMap ?? {}).map((position) =>
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
