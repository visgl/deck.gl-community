import BaseLayout from '../../core/base-layout';

import {EDGE_TYPE} from '../../index';

const defaultOptions = {
  alpha: 0.3,
  resumeAlpha: 0.1,
  nBodyStrength: -900,
  nBodyDistanceMin: 100,
  nBodyDistanceMax: 400,
  getCollisionRadius: 0
};

export default class D3ForceLayout extends BaseLayout {
  constructor(options) {
    super(options);
    this._name = 'D3';
    this._options = {
      ...defaultOptions,
      ...options
    };
    // store graph and prepare internal data
    this._d3Graph = {nodes: [], edges: []};
    this._nodeMap = {};
    this._edgeMap = {};
  }

  initializeGraph(graph) {
    this._graph = graph;
    this._nodeMap = {};
    this._edgeMap = {};
    // nodes
    const d3Nodes = graph.getNodes().map((node) => {
      const id = node.id;
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
      this._nodeMap[node.id] = d3Node;
      return d3Node;
    });
    // edges
    const d3Edges = graph.getEdges().map((edge) => {
      const d3Edge = {
        id: edge.id,
        source: this._nodeMap[edge.getSourceNodeId()],
        target: this._nodeMap[edge.getTargetNodeId()]
      };
      this._edgeMap[edge.id] = d3Edge;
      return d3Edge;
    });
    this._d3Graph = {
      nodes: d3Nodes,
      edges: d3Edges
    };
  }

  start() {
    this._worker = new Worker(new URL('./worker.js', import.meta.url).href);
    const {alpha, nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
      this._options;
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
  ticked(data) {}
  ended(data) {
    const {nodes, edges} = data;
    this.updateD3Graph({nodes, edges});
    this._onLayoutChange();
    this._onLayoutDone();
  }
  resume() {
    this._worker.resume();
  }
  stop() {
    this._worker.stop();
  }

  // for steaming new data on the same graph
  updateGraph(graph) {
    if (this._graph.getGraphName() !== graph.getGraphName()) {
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
      const newD3Edge = oldD3Edge
        ? oldD3Edge
        : {
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

  updateD3Graph(graph) {
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

  getNodePosition = (node) => {
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
        type: EDGE_TYPE.LINE,
        sourcePosition: [sourcePosition.x, sourcePosition.y],
        targetPosition: [targetPosition.x, targetPosition.y],
        controlPoints: []
      };
    }
    return {
      type: EDGE_TYPE.LINE,
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
    this._onLayoutChange();
    this._onLayoutDone();
  };

  unlockNodePosition = (node) => {
    const d3Node = this._nodeMap[node.id];
    d3Node.fx = null;
    d3Node.fy = null;
  };
}
