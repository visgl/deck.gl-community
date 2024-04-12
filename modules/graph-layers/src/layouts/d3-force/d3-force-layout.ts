import {BaseLayout} from '../../core/base-layout';

import {EDGE_TYPE} from '../../index';

const defaultOptions = {
  alpha: 0.3,
  resumeAlpha: 0.1,
  nBodyStrength: -900,
  nBodyDistanceMin: 100,
  nBodyDistanceMax: 400,
  getCollisionRadius: 0
};

export class D3ForceLayout extends BaseLayout {
  constructor(options) {
    super(options);

    this._name = 'D3';
    this._options = {
      ...defaultOptions,
      ...options
    };

    this._positionsByNodeId = new Map();
  }

  initializeGraph(graph) {
    this._graph = graph;
  }

  // for streaming new data on the same graph
  updateGraph(graph) {
    this._graph = graph;

    this._positionsByNodeId = new Map(
      this._graph.getNodes().map((node) => [node.id, this._positionsByNodeId.get(node.id)])
    );
  }

  start() {
    this._engageWorker();

    this._onLayoutStart();
  }

  update() {
    this._engageWorker();
  }

  _engageWorker() {
    // prevent multiple start
    if (this._worker) {
      this._worker.terminate();
    }

    this._worker = new Worker(new URL('./worker.js', import.meta.url).href);

    this._worker.postMessage({
      nodes: this._graph.getNodes().map((node) => ({
        id: node.id,
        ...this._positionsByNodeId.get(node.id)
      })),
      edges: this._graph.getEdges().map((edge) => ({
        id: edge.id,
        source: edge.getSourceNodeId(),
        target: edge.getTargetNodeId()
      })),
      options: this._options
    });

    this._worker.onmessage = (event) => {
      if (event.data.type !== 'end') {
        return;
      }

      event.data.nodes.forEach(({id, ...d3}) =>
        this._positionsByNodeId.set(id, {
          ...d3,
          // precompute so that when we return the node position we do not need to do the conversion
          coordinates: [d3.x, d3.y]
        })
      );

      this._onLayoutChange();
      this._onLayoutDone();
    };
  }

  resume() {
    throw new Error('Resume unavailable');
  }

  stop() {
    this._worker.terminate();
  }

  getEdgePosition = (edge) => {
    const sourceNode = this._graph.findNode(edge.getSourceNodeId());
    const targetNode = this._graph.findNode(edge.getTargetNodeId());
    if (!this.getNodePosition(sourceNode) || !this.getNodePosition(targetNode)) {
      return null;
    }

    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: this.getNodePosition(sourceNode),
      targetPosition: this.getNodePosition(targetNode),
      controlPoints: []
    };
  };

  getNodePosition = (node) => {
    const d3Node = this._positionsByNodeId.get(node.id);
    if (d3Node) {
      return d3Node.coordinates;
    }

    return null;
  };

  lockNodePosition = (node, x, y) => {
    const d3Node = this._positionsByNodeId.get(node.id);
    this._positionsByNodeId.set(node.id, {
      ...d3Node,
      x,
      y,
      fx: x,
      fy: y,
      coordinates: [x, y]
    });
    this._onLayoutChange();
    this._onLayoutDone();
  };

  unlockNodePosition = (node) => {
    const d3Node = this._positionsByNodeId.get(node.id);
    d3Node.fx = null;
    d3Node.fy = null;
  };
}
