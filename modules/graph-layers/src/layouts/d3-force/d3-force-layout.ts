// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutOptions} from '../../core/graph-layout';

import {EDGE_TYPE} from '../../core/constants';

export type D3ForceLayoutOptions = GraphLayoutOptions & {
  alpha?: number;
  resumeAlpha?: number;
  nBodyStrength?: number;
  nBodyDistanceMin?: number;
  nBodyDistanceMax?: number;
  getCollisionRadius?: number;
};

export class D3ForceLayout extends GraphLayout<D3ForceLayoutOptions> {
  static defaultOptions: Required<D3ForceLayoutOptions> = {
    alpha: 0.3,
    resumeAlpha: 0.1,
    nBodyStrength: -900,
    nBodyDistanceMin: 100,
    nBodyDistanceMax: 400,
    getCollisionRadius: 0
  };

  protected readonly _name = 'D3';
  private _positionsByNodeId = new Map();
  private _graph: any;
  private _worker: any;

  constructor(options?: D3ForceLayoutOptions) {
    super(options);

    this._options = {
      ...D3ForceLayout.defaultOptions,
      ...options
    };
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

    this._onLayoutStart();

    this._worker.onmessage = (event) => {
      const {type, nodes} = event.data;
      if (type !== 'tick' && type !== 'end') {
        return;
      }

      this._updateNodePositions(nodes);
      this._onLayoutChange();

      if (type === 'end') {
        this._onLayoutDone();
        this._worker = null;
      }
    };

    this._worker.onerror = () => {
      this._onLayoutError();
      this._worker = null;
    };
  }

  resume() {
    throw new Error('Resume unavailable');
  }

  stop() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
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

  private _updateNodePositions(nodes) {
    if (!nodes) {
      return;
    }

    nodes.forEach(({id, x, y, ...rest}) =>
      this._positionsByNodeId.set(id, {
        ...rest,
        x,
        y,
        // precompute so that when we return the node position we do not need to do the conversion
        coordinates: [x, y]
      })
    );
  }
}
