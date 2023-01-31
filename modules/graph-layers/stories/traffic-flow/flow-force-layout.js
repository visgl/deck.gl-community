import {BaseLayout, EDGE_TYPE} from 'react-graph-gl';
import {mean} from 'd3-array';

const defaultOptions = {
  nodePositionAccessor: node => [
    node.getPropertyValue('x'),
    node.getPropertyValue('y'),
  ],
  offsetScalar: 1,
};

export default class FlowForceLayout extends BaseLayout {
  constructor(options) {
    super(options);
    this._name = 'FlowForceLayout';
    this._options = {
      ...defaultOptions,
      ...options,
    };
    this._graph = null;
    this._nodePositionMap = {};
  }

  initializeGraph(graph) {
    this.updateGraph(graph);
  }

  _notifyLayoutComplete() {
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  }

  start() {
    this._notifyLayoutComplete();
  }

  resume() {
    this._notifyLayoutComplete();
  }

  updateGraph(graph) {
    this._graph = graph;
    this._nodeMap = graph.getNodes().reduce((res, node) => {
      res[node.getId()] = node;
      return res;
    }, {});

    const flows = this._options.getCurrentFlows();

    this._nodePositionMap = graph.getNodes().reduce((res, node) => {
      const sourceNodeId = node.getId();
      const sourcePos = this._options.nodePositionAccessor(node);
      // for testing only
      // res[sourceNodeId] = sourcePos;
      // return res;

      // get all connected edges, and calculate the speed vector for each
      const speedVectors = node.getConnectedEdges().map(e => {
        const fromSource = e.getSourceNodeId() === sourceNodeId;
        const targetNodeId = fromSource
          ? e.getTargetNodeId()
          : e.getSourceNodeId();
        const targetNode = this._nodeMap[targetNodeId];
        const targetPos = this._options.nodePositionAccessor(targetNode);
        const direction = [
          targetPos[0] - sourcePos[0],
          targetPos[1] - sourcePos[1],
        ];
        const norm = Math.sqrt(
          direction[0] * direction[0] + direction[1] * direction[1]
        );

        // normalized * speed
        const speed = (flows[e.getId()] && flows[e.getId()].mean) || 0;
        const scaledSpeed = this._options.speedScale(Number(speed));
        return [
          scaledSpeed * (direction[0] / norm),
          scaledSpeed * (direction[1] / norm),
        ];
      });

      const avgVector = [
        mean(speedVectors, d => d[0]) || 0,
        mean(speedVectors, d => d[1]) || 0,
      ];
      res[sourceNodeId] = [
        sourcePos[0] + this._options.offsetScalar * avgVector[0],
        sourcePos[1] + this._options.offsetScalar * avgVector[1],
      ];
      return res;
    }, {});
  }

  setNodePositionAccessor = accessor => {
    this._options.nodePositionAccessor = accessor;
  };

  getNodePosition = node => this._nodePositionMap[node.getId()];

  getEdgePosition = edge => {
    const sourcePos = this._nodePositionMap[edge.getSourceNodeId()];
    const targetPos = this._nodePositionMap[edge.getTargetNodeId()];
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: [],
    };
  };

  lockNodePosition = (node, x, y) => {
    this._nodePositionMap[node.getId()] = [x, y];
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  };
}
