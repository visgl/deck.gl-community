import {BaseLayout, EDGE_TYPE} from '../../src';
import * as d3 from 'd3';
import {d3adaptor} from 'webcola';

const defaultOptions = {
  width: 900,
  height: 800,
  iteration: 30,
};

export default class ColaLayout extends BaseLayout {
  constructor(options) {
    super(options);
    this._name = 'Cola';
    this._options = {
      ...defaultOptions,
      ...options,
    };
    // custom layout data structure
    this._colaGraph = {nodes: [], edges: []};
    this._nodeMap = {};
    this._edgeMap = {};
  }

  initializeGraph(graph) {
    this._graph = graph;
    this._colaGraph = {nodes: [], edges: []};
    this._nodeMap = {};
    this._edgeMap = {};

    if (this._simulator) {
      this.stop();
    }

    // nodes
    const colaNodes = graph.getNodes().map(node => {
      const colaNode = {
        id: node.getId(),
        x: 0,
        y: 0,
      };
      this._nodeMap[node.getId()] = colaNode;
      return colaNode;
    });
    // edges
    const colaEdges = graph.getEdges().map(edge => {
      const colaEdge = {
        id: edge.getId(),
        source: colaNodes.findIndex(n => n.id === edge.getSourceNodeId()),
        target: colaNodes.findIndex(n => n.id === edge.getTargetNodeId()),
      };
      this._edgeMap[edge.getId()] = colaEdge;
      return colaEdge;
    });
    this._colaGraph = {
      nodes: colaNodes,
      edges: colaEdges,
    };
  }

  _generateSimulator() {
    if (this._simulator) {
      this._simulator.on('tick', null).on('end', null);
      this._simulator = null;
    }

    const {width, height, constraints} = this._options;
    this._simulator = d3adaptor(d3).size([width / 2, height / 2]);
    this._simulator
      .jaccardLinkLengths(100, 0.7)
      .symmetricDiffLinkLengths(24)
      .handleDisconnected(false)
      .on('tick', this._callbacks.onLayoutChange)
      .on('end', this._callbacks.onLayoutDone);

    if (constraints && constraints.length > 0) {
      this._simulator.constraints(constraints);
    }
  }

  start() {
    if (this._colaGraph.nodes.length === 0) {
      this._callbacks.onLayoutDone();
      return;
    }
    const {iteration} = this._options;
    this._generateSimulator();
    this._simulator
      .nodes(this._colaGraph.nodes)
      .links(this._colaGraph.edges)
      .start(iteration);
  }

  resume() {
    this._simulator.resume();
  }

  stop() {
    this._simulator.stop();
  }

  // for steaming new data on the same graph
  updateGraph(graph) {
    this._graph = graph;
    // nodes
    const newNodeMap = {};
    const newColaNodes = graph.getNodes().map(node => {
      const oldColaNode = this._nodeMap[node.getId()];
      const newColaNode = oldColaNode
        ? oldColaNode
        : {
            id: node.getId(),
            x: 0,
            y: 0,
          };

      newNodeMap[node.getId()] = newColaNode;
      return newColaNode;
    });
    this._nodeMap = newNodeMap;
    this._colaGraph.nodes = newColaNodes;
    // edges
    const newEdgeMap = {};
    const newColaEdges = graph.getEdges().map(edge => {
      const newColaEdge = {
        id: edge.getId(),
        source: this._colaGraph.nodes.findIndex(
          n => n.id === edge.getSourceNodeId()
        ),
        target: this._colaGraph.nodes.findIndex(
          n => n.id === edge.getTargetNodeId()
        ),
      };
      newEdgeMap[edge.getId()] = newColaEdge;
      return newColaEdge;
    });
    this._edgeMap = newEdgeMap;
    this._colaGraph.edges = newColaEdges;
  }

  getNodePosition = node => {
    const colaNode = this._nodeMap[node.getId()];
    if (colaNode) {
      return [colaNode.x, colaNode.y];
    }
    return [0, 0];
  };

  getEdgePosition = edge => {
    const colaEdge = this._edgeMap[edge.getId()];
    const edgeSource = colaEdge.source;
    const edgeTarget = colaEdge.target;

    if (colaEdge && edgeSource && edgeTarget) {
      return {
        type: EDGE_TYPE.LINE,
        sourcePosition: [colaEdge.source.x, colaEdge.source.y],
        targetPosition: [colaEdge.target.x, colaEdge.target.y],
        controlPoints: [],
      };
    }
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: [],
    };
  };

  lockNodePosition = (node, x, y) => {
    const colaNode = this._nodeMap[node.id];
    colaNode.x = x;
    colaNode.y = y;
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  };
}
