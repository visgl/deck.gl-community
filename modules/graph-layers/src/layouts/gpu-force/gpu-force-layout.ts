// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';

export type GPUForceLayoutOptions = GraphLayoutProps & {
  alpha?: number;
  resumeAlpha?: number;
  nBodyStrength?: number;
  nBodyDistanceMin?: number;
  nBodyDistanceMax?: number;
  getCollisionRadius?: number;
};

/**
 * @todo this layout should be updated with the organizational and logic improvements made in d3-force
 */
export class GPUForceLayout extends GraphLayout<GPUForceLayoutOptions> {
  static defaultProps: Required<GPUForceLayoutOptions> = {
    alpha: 0.3,
    resumeAlpha: 0.1,
    nBodyStrength: -900,
    nBodyDistanceMin: 100,
    nBodyDistanceMax: 400,
    getCollisionRadius: 0
  };

  protected readonly _name: string = 'GPU';
  private _d3Graph: any;
  private _nodeMap: any;
  private _edgeMap: any;
  private _graph: any;
  private _worker: Worker | null = null;
  private _callbacks: any;

  constructor(options: GPUForceLayoutOptions = {}) {
    super(options, GPUForceLayout.defaultProps);

    // store graph and prepare internal data
    this._d3Graph = {nodes: [], edges: []};
    this._nodeMap = {};
    this._edgeMap = {};
    this._callbacks = {
      onLayoutChange: this._onLayoutChange,
      onLayoutDone: this._onLayoutDone
    };
  }

  initializeGraph(graph) {
    this._syncGraph(graph);
  }

  start() {
    this._engageWorker();
  }

  update() {
    this._engageWorker();
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

  // for steaming new data on the same graph
  protected override updateGraph(graph) {
    const isInitialLoad = !this._graph;
    if (isInitialLoad || this._graph.getGraphName() !== graph.getGraphName()) {
      // reset the maps
      this._nodeMap = {};
      this._edgeMap = {};
    }
    this._graph = graph;
    // update internal layout data
    // nodes
    const newNodeMap = {};
    const newD3Nodes = graph.getNodes().map((node) => {
      const id = node.id;
      const locked = node.getPropertyValue('locked') || false;
      const x = node.getPropertyValue('x') || 0;
      const y = node.getPropertyValue('y') || 0;
      const fx = locked ? x : null;
      const fy = locked ? y : null;
      const collisionRadius = node.getPropertyValue('collisionRadius') || 0;

      const oldD3Node = this._nodeMap[node.id];
      const newD3Node = oldD3Node ? oldD3Node : {id, x, y, fx, fy, collisionRadius};
      newNodeMap[node.id] = newD3Node;
      return newD3Node;
    });
    this._nodeMap = newNodeMap;
    this._d3Graph.nodes = newD3Nodes;
    // edges
    const newEdgeMap = {};
    const newD3Edges = graph.getEdges().map((edge) => {
      const oldD3Edge = this._edgeMap[edge.id];
      const newD3Edge = oldD3Edge || {
        id: edge.id,
        source: newNodeMap[edge.getSourceNodeId()],
        target: newNodeMap[edge.getTargetNodeId()]
      };
      newEdgeMap[edge.id] = newD3Edge;
      return newD3Edge;
    });
    this._edgeMap = newEdgeMap;
    this._d3Graph.edges = newD3Edges;
  }

  protected _engageWorker() {
    // prevent multiple start
    if (this._worker) {
      this._worker.terminate();
    }

    this._worker = new Worker(new URL('./worker.js', import.meta.url).href);
    const {alpha, nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
      this.props;
    this._worker.postMessage({
      nodes: this._d3Graph.nodes,
      edges: this._d3Graph.edges,
      options: {
        alpha,
        nBodyStrength,
        nBodyDistanceMin,
        nBodyDistanceMax,
        getCollisionRadius
      }
    });
    this._worker.onmessage = (event) => {
      switch (event.data.type) {
        case 'tick':
          this.ticked(event.data);
          break;
        case 'end':
          this.ended(event.data);
          break;
        default:
          break;
      }
    };
  }

  protected ticked(data) {}

  protected ended(data) {
    const {nodes, edges} = data;
    this.updateD3Graph({nodes, edges});
    this._onLayoutChange();
    this._onLayoutDone();
  }

  protected updateD3Graph(graph) {
    const existingNodes = this._graph.getNodes();
    // update internal layout data
    // nodes
    const newNodeMap = {};
    const newD3Nodes = graph.nodes.map((node) => {
      // Update existing _graph with the new values
      const existingNode = existingNodes.find((n) => n.getId() === node.id);
      existingNode.setDataProperty('locked', node.locked);
      existingNode.setDataProperty('x', node.x);
      existingNode.setDataProperty('y', node.y);
      existingNode.setDataProperty('collisionRadius', node.collisionRadius);

      newNodeMap[node.id] = node;
      return node;
    });
    this._nodeMap = newNodeMap;
    this._d3Graph.nodes = newD3Nodes;
    // edges
    const newEdgeMap = {};
    const newD3Edges = graph.edges.map((edge) => {
      newEdgeMap[edge.id] = edge;
      return edge;
    });
    this._graph.triggerUpdate();
    this._edgeMap = newEdgeMap;
    this._d3Graph.edges = newD3Edges;
  }

  getNodePosition = (node): [number, number] => {
    const d3Node = this._nodeMap[node.id];
    if (d3Node) {
      return [d3Node.x, d3Node.y];
    }
    return [0, 0];
  };

  getEdgePosition = (edge) => {
    const d3Edge = this._edgeMap[edge.id];
    const sourcePosition = d3Edge && d3Edge.source;
    const targetPosition = d3Edge && d3Edge.target;
    if (d3Edge && sourcePosition && targetPosition) {
      return {
        type: 'line',
        sourcePosition: [sourcePosition.x, sourcePosition.y],
        targetPosition: [targetPosition.x, targetPosition.y],
        controlPoints: []
      };
    }
    return {
      type: 'line',
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: []
    };
  };

  lockNodePosition = (node, x, y) => {
    const d3Node = this._nodeMap[node.id];
    d3Node.x = x;
    d3Node.y = y;
    d3Node.fx = x;
    d3Node.fy = y;
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  };

  unlockNodePosition = (node) => {
    const d3Node = this._nodeMap[node.id];
    d3Node.fx = null;
    d3Node.fy = null;
  };

  protected override _updateBounds(): void {
    const positions = Object.values(this._nodeMap ?? {}).map((node) =>
      this._normalizePosition(node)
    );
    this._bounds = this._calculateBounds(positions);
  }
}
