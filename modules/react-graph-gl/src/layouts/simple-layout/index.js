import BaseLayout from '../../core/base-layout';
import {EDGE_TYPE} from '../../index';

const defaultOptions = {
  nodePositionAccessor: (node) => [node.getPropertyValue('x'), node.getPropertyValue('y')]
};

export default class SimpleLayout extends BaseLayout {
  constructor(options) {
    super(options);
    this._name = 'SimpleLayout';
    this._options = {
      ...defaultOptions,
      ...options
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
    this._nodePositionMap = graph.getNodes().reduce((res, node) => {
      res[node.getId()] = this._options.nodePositionAccessor(node);
      return res;
    }, {});
  }

  setNodePositionAccessor = (accessor) => {
    this._options.nodePositionAccessor = accessor;
  };

  getNodePosition = (node) => this._nodePositionMap[node.getId()];

  getEdgePosition = (edge) => {
    const sourcePos = this._nodePositionMap[edge.getSourceNodeId()];
    const targetPos = this._nodePositionMap[edge.getTargetNodeId()];
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: []
    };
  };

  lockNodePosition = (node, x, y) => {
    this._nodePositionMap[node.getId()] = [x, y];
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  };
}
