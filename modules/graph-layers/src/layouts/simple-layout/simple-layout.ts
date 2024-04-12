import {BaseLayout, BaseLayoutOptions } from '../../core/base-layout';
import {Node} from '../../core/node';
import {EDGE_TYPE} from '../../core/constants';
import {Graph} from '../../core/graph';

type AccessorVec2 = (node: Node) => [number, number];

interface SimpleLayoutOptions extends BaseLayoutOptions {
  nodePositionAccessor?: AccessorVec2
}

const defaultOptions: Required<SimpleLayoutOptions> = {
  nodePositionAccessor: (node) => [node.getPropertyValue('x'), node.getPropertyValue('y')]
};

export class SimpleLayout extends BaseLayout {
  protected readonly _name = 'SimpleLayout';
  protected _graph: Graph | null = null;
  protected _nodeMap: Record<string, Node>  = {};
  protected _nodePositionMap: Record<string, AccessorVec2> = {};

  constructor(options = {}) {
    super({...defaultOptions, ...options});
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
    this._onLayoutChange();
    this._onLayoutDone();
  };
}
