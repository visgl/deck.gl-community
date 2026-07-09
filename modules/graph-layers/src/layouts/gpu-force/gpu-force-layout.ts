// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps} from '../../core/graph-layout';
import type {Graph, NodeInterface, EdgeInterface} from '../../graph/graph';

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
    ...GraphLayout.defaultProps,
    alpha: 0.3,
    resumeAlpha: 0.1,
    nBodyStrength: -900,
    nBodyDistanceMin: 100,
    nBodyDistanceMax: 400,
    getCollisionRadius: 0
  };

  protected readonly _name: string = 'GPU';
  private _d3Graph: {nodes: any[]; edges: any[]};
  private _nodeMap: Map<string | number, any>;
  private _edgeMap: Map<string | number, any>;
  private _graph: Graph | null;
  private _worker: Worker | null = null;

  constructor(options: GPUForceLayoutOptions = {}) {
    super(options, GPUForceLayout.defaultProps);

    this._name = 'GPU';
    // store graph and prepare internal data
    this._d3Graph = {nodes: [], edges: []};
    this._nodeMap = new Map();
    this._edgeMap = new Map();
    this._graph = null;
  }

  initializeGraph(graph: Graph) {
    this._graph = graph;
    this._nodeMap = new Map();
    this._edgeMap = new Map();
    // nodes
    const d3Nodes = Array.from(graph.getNodes(), node => {
      const id = node.getId();
      const locked = node.getPropertyValue('locked') || false;
      const x = node.getPropertyValue('x') || 0;
      const y = node.getPropertyValue('y') || 0;
      const collisionRadius = node.getPropertyValue('collisionRadius') || 0;
      const d3Node = {
        id,
        x,
        y,
        fx: locked ? x : null,
        fy: locked ? y : null,
        collisionRadius,
        locked
      };
      this._nodeMap.set(id, d3Node);
      return d3Node;
    });
    // edges
    const d3Edges = Array.from(graph.getEdges(), edge => {
      const id = edge.getId();
      const d3Edge = {
        id,
        source: this._nodeMap.get(edge.getSourceNodeId()),
        target: this._nodeMap.get(edge.getTargetNodeId())
      };
      this._edgeMap.set(id, d3Edge);
      return d3Edge;
    });
    this._d3Graph = {
      nodes: d3Nodes,
      edges: d3Edges
    };
  }

  start() {
    this._onLayoutStart();
    this._engageWorker();
  }

  update() {
    this._engageWorker();
  }

  _engageWorker() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
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
    this._worker.onmessage = event => {
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
  ticked(data) {
    const nodesUpdated = this._applyWorkerNodes(data?.nodes);
    if (!nodesUpdated) {
      return;
    }

    if (Array.isArray(data?.edges) && data.edges.length > 0) {
      this._applyWorkerEdges(data.edges);
    }

    this._graph?.triggerUpdate?.();
    this._onLayoutChange();
  }
  ended(data) {
    const {nodes, edges} = data;
    this.updateD3Graph({nodes, edges});
    this._onLayoutChange();
    this._onLayoutDone();
    this._disengageWorker();
  }
  resume() {
    throw new Error('Resume unavailable');
  }
  stop() {
    this._disengageWorker();
  }

  private _disengageWorker() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }

  // for steaming new data on the same graph
  updateGraph(graph: Graph) {
    const previousName = this._graph?.getGraphName?.();
    const nextName = graph.getGraphName?.();
    const isSameGraph =
      (previousName && nextName && previousName === nextName) || this._graph === graph;
    if (!isSameGraph) {
      // reset the maps
      this._nodeMap = new Map();
      this._edgeMap = new Map();
    }
    this._graph = graph;
    // update internal layout data
    // nodes
    const newNodeMap = new Map<string | number, any>();
    const newD3Nodes = Array.from(graph.getNodes(), node => {
      const id = node.getId();
      const locked = node.getPropertyValue('locked') || false;
      const x = node.getPropertyValue('x') || 0;
      const y = node.getPropertyValue('y') || 0;
      const fx = locked ? x : null;
      const fy = locked ? y : null;
      const collisionRadius = node.getPropertyValue('collisionRadius') || 0;

      const oldD3Node = this._nodeMap.get(id);
      const newD3Node = oldD3Node ? oldD3Node : {id, x, y, fx, fy, collisionRadius};
      newNodeMap.set(id, newD3Node);
      return newD3Node;
    });
    this._nodeMap = newNodeMap;
    this._d3Graph.nodes = newD3Nodes;
    // edges
    const newEdgeMap = new Map<string | number, any>();
    const newD3Edges = Array.from(graph.getEdges(), edge => {
      const id = edge.getId();
      const oldD3Edge = this._edgeMap.get(id);
      const newD3Edge = oldD3Edge || {
        id,
        source: newNodeMap.get(edge.getSourceNodeId()),
        target: newNodeMap.get(edge.getTargetNodeId())
      };
      newEdgeMap.set(id, newD3Edge);
      return newD3Edge;
    });
    this._edgeMap = newEdgeMap;
    this._d3Graph.edges = newD3Edges;
  }

  updateD3Graph(graph: {nodes: any[]; edges: any[]}): void {
    const existingNodes = this._graph ? Array.from(this._graph.getNodes()) : [];
    // update internal layout data
    // nodes
    const newNodeMap = new Map<string | number, any>();
    const newD3Nodes = graph.nodes.map(node => {
      // Update existing _graph with the new values
      const existingNode = existingNodes.find(n => n.getId() === node.id);
      existingNode?.setDataProperty('locked', node.locked);
      existingNode?.setDataProperty('x', node.x);
      existingNode?.setDataProperty('y', node.y);
      existingNode?.setDataProperty('collisionRadius', node.collisionRadius);

      newNodeMap.set(node.id, node);
      return node;
    });
    this._nodeMap = newNodeMap;
    this._d3Graph.nodes = newD3Nodes;
    // edges
    const newEdgeMap = new Map<string | number, any>();
    const newD3Edges = graph.edges.map(edge => {
      newEdgeMap.set(edge.id, edge);
      return edge;
    });
    this._graph?.triggerUpdate?.();
    this._edgeMap = newEdgeMap;
    this._d3Graph.edges = newD3Edges;
  }

  private _applyWorkerNodes(nodes: any[] | undefined): boolean {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return false;
    }

    for (const node of nodes) {
      const existingNode = this._nodeMap.get(node.id);
      if (existingNode) {
        existingNode.x = node.x;
        existingNode.y = node.y;
        if ('fx' in node) {
          existingNode.fx = node.fx;
        }
        if ('fy' in node) {
          existingNode.fy = node.fy;
        }
        if ('locked' in node) {
          existingNode.locked = node.locked;
        }
        if ('collisionRadius' in node) {
          existingNode.collisionRadius = node.collisionRadius;
        }
      } else {
        const newNode = {...node};
        this._nodeMap.set(node.id, newNode);
        this._d3Graph.nodes.push(newNode);
      }
    }

    return true;
  }

  private _applyWorkerEdges(edges: any[]): void {
    for (const edge of edges) {
      const sourceId = this._resolveNodeId(edge.source);
      const targetId = this._resolveNodeId(edge.target);
      const source = sourceId === undefined ? undefined : this._nodeMap.get(sourceId);
      const target = targetId === undefined ? undefined : this._nodeMap.get(targetId);

      if (!source || !target) {
        continue;
      }

      const existingEdge = this._edgeMap.get(edge.id);
      if (existingEdge) {
        existingEdge.source = source;
        existingEdge.target = target;
      } else {
        const newEdge = {
          ...edge,
          source,
          target
        };
        this._edgeMap.set(edge.id, newEdge);
        this._d3Graph.edges.push(newEdge);
      }
    }
  }

  private _resolveNodeId(node: any): string | number | undefined {
    if (node && typeof node === 'object') {
      return node.id;
    }

    return node;
  }

  getNodePosition = (node: NodeInterface): [number, number] => {
    const d3Node = this._nodeMap.get(node.getId());
    if (d3Node) {
      return [d3Node.x, d3Node.y];
    }
    return [0, 0];
  };

  getEdgePosition = (edge: EdgeInterface) => {
    const d3Edge = this._edgeMap.get(edge.getId());
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

  lockNodePosition = (node: NodeInterface, x: number, y: number) => {
    const d3Node = this._nodeMap.get(node.getId());
    if (!d3Node) {
      return;
    }
    d3Node.x = x;
    d3Node.y = y;
    d3Node.fx = x;
    d3Node.fy = y;
    this._onLayoutChange();
    this._onLayoutDone();
  };

  unlockNodePosition = (node: NodeInterface) => {
    const d3Node = this._nodeMap.get(node.getId());
    if (!d3Node) {
      return;
    }
    d3Node.fx = null;
    d3Node.fy = null;
  };

  protected override _updateBounds(): void {
    const positions = Array.from(this._nodeMap.values(), node => this._normalizePosition(node));
    this._bounds = this._calculateBounds(positions);
  }
}
