// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphLayout, GraphLayoutProps, GRAPH_LAYOUT_DEFAULT_PROPS} from '../../core/graph-layout';
import {Node} from '../../graph/node';
import {Edge} from '../../graph/edge';
import {ClassicGraph} from '../../graph/classic-graph';
import * as d3 from 'd3-force';

export type ForceMultiGraphLayoutProps = GraphLayoutProps & {
  alpha?: number;
  nBodyStrength?: number;
  nBodyDistanceMin?: number;
  nBodyDistanceMax?: number;
};

export class ForceMultiGraphLayout extends GraphLayout<ForceMultiGraphLayoutProps> {
  static defaultProps = {
    ...GRAPH_LAYOUT_DEFAULT_PROPS,
    alpha: 3,
    nBodyStrength: -1200,
    nBodyDistanceMin: 100,
    nBodyDistanceMax: 1400
  } as const satisfies Readonly<Required<ForceMultiGraphLayoutProps>>;

  _name = 'ForceMultiGraphLayout';
  _graph: ClassicGraph;

  // d3 part
  // custom graph data
  _d3Graph = {nodes: [], edges: []};
  _nodeMap = {};
  _edgeMap = {};
  _simulator;

  constructor(props: ForceMultiGraphLayoutProps = {}) {
    super(props, ForceMultiGraphLayout.defaultProps);
  }

  initializeGraph(graph: ClassicGraph): void {
    this.updateGraph(graph);
  }

  _strength = (d3Edge) => {
    if (d3Edge.isVirtual) {
      return 1 / d3Edge.edgeCount;
    }
    const sourceDegree = this._graph.getDegree(d3Edge.source.id);
    const targetDegree = this._graph.getDegree(d3Edge.target.id);
    return 1 / Math.min(sourceDegree, targetDegree);
  };

  _generateSimulator() {
    if (this._simulator) {
      this._simulator.on('tick', null).on('end', null);
      this._simulator = null;
    }
    const {alpha, nBodyStrength, nBodyDistanceMin, nBodyDistanceMax} = this.props;

    const g = this._d3Graph;
    this._simulator = d3
      .forceSimulation(g.nodes)
      .force(
        'edge',
        d3
          .forceLink(g.edges)
          // @ts-ignore TODO id not defined?
          .id((n) => n.id)
          .strength(this._strength)
      )
      .force(
        'charge',
        d3
          .forceManyBody()
          .strength(nBodyStrength)
          .distanceMin(nBodyDistanceMin)
          .distanceMax(nBodyDistanceMax)
      )
      .force('center', d3.forceCenter())
      .alpha(alpha);
    // register event callbacks
    this._simulator.on('tick', this._onLayoutChange).on('end', this._onLayoutDone);
  }

  start() {
    this._generateSimulator();
    this._simulator.restart();
  }

  resume() {
    this._simulator.restart();
  }

  stop() {
    this._simulator.stop();
  }

  update(): void {}

  updateGraph(graph: ClassicGraph) {
    this._graph = graph;

    // nodes
    const newNodeMap = {};
    const nodes = Array.isArray(graph.getNodes())
      ? (graph.getNodes() as Node[])
      : (Array.from(graph.getNodes()) as Node[]);
    const newD3Nodes = nodes.map((node) => {
      const oldD3Node = this._nodeMap[node.id];
      const newD3Node = oldD3Node ? oldD3Node : {id: node.id};
      newNodeMap[node.id] = newD3Node;
      return newD3Node;
    });

    // edges
    // bucket edges between the same source/target node pairs.
    const edges = Array.isArray(graph.getEdges())
      ? (graph.getEdges() as Edge[])
      : (Array.from(graph.getEdges()) as Edge[]);
    const nodePairs = edges.reduce((res, edge) => {
      const endpoints = [edge.getSourceNodeId(), edge.getTargetNodeId()];
      // sort the node ids to count the edges with the same pair
      // but different direction (a -> b or b -> a)
      const pairId = endpoints.sort().toString();
      // push this edge into the bucket
      if (!res[pairId]) {
        res[pairId] = [edge];
      } else {
        res[pairId].push(edge);
      }
      return res;
    }, {});

    // go through each pair of edges,
    // if only one edge between two nodes, create a straight line
    // otherwise, create one virtual node and two edges for each edge
    const newD3Edges = [];
    const newEdgeMap = {};

    Object.keys(nodePairs).forEach((pairId) => {
      const betweenEdges = nodePairs[pairId];
      const firstEdge = betweenEdges[0];
      if (betweenEdges.length === 1) {
        // do nothing, this is a real edge
        const newD3Edge = {
          type: 'line',
          id: firstEdge.getId(),
          source: newNodeMap[firstEdge.getSourceNodeId()],
          target: newNodeMap[firstEdge.getTargetNodeId()],
          isVirtual: false
        };
        newEdgeMap[firstEdge.getId()] = newD3Edge;
        newD3Edges.push(newD3Edge);
        return;
      }

      // else reduce to one virtual edge
      const newD3Edge = {
        type: 'line',
        id: pairId,
        source: newNodeMap[firstEdge.getSourceNodeId()],
        target: newNodeMap[firstEdge.getTargetNodeId()],
        isVirtual: true,
        edgeCount: betweenEdges.length
      };
      newEdgeMap[pairId] = newD3Edge;
      newD3Edges.push(newD3Edge);

      betweenEdges.forEach((e, idx) => {
        newEdgeMap[e.id] = {
          type: 'spline-curve',
          id: e.id,
          source: newNodeMap[e.getSourceNodeId()],
          target: newNodeMap[e.getTargetNodeId()],
          virtualEdgeId: pairId,
          isVirtual: true,
          index: idx
        };
      });
    });

    this._nodeMap = newNodeMap;
    this._d3Graph.nodes = newD3Nodes;
    this._edgeMap = newEdgeMap;
    this._d3Graph.edges = newD3Edges;
  }

  getNodePosition = (node: Node): [number, number] => {
    const d3Node = this._nodeMap[node.id];
    if (d3Node) {
      return [d3Node.x, d3Node.y];
    }
    // default value
    return [0, 0];
  };

  getEdgePosition = (edge) => {
    const d3Edge = this._edgeMap[edge.id];
    if (d3Edge) {
      if (!d3Edge.isVirtual) {
        return {
          type: 'line',
          sourcePosition: [d3Edge.source.x, d3Edge.source.y],
          targetPosition: [d3Edge.target.x, d3Edge.target.y],
          controlPoints: []
        };
      }
      // else, check the referenced virtual edge
      const virtualEdge = this._edgeMap[d3Edge.virtualEdgeId];
      const edgeCount = virtualEdge.edgeCount;
      // get the position of source and target nodes
      const sourcePosition = [virtualEdge.source.x, virtualEdge.source.y];
      const targetPosition = [virtualEdge.target.x, virtualEdge.target.y];
      // calculate a symmetric curve
      const distance = Math.hypot(
        sourcePosition[0] - targetPosition[0],
        sourcePosition[1] - targetPosition[1]
      );
      const index = d3Edge.index;
      // curve direction: inward vs. outward
      const direction = index % 2 ? 1 : -1;
      // if the number of the parallel edges is an even number => symmetric shape
      // otherwise, the 0th node will be a staight line, and rest of them are symmetrical.
      const symmetricShape = edgeCount % 2 === 0;
      const offset =
        Math.max(distance / 10, 5) *
        (symmetricShape ? Math.floor(index / 2 + 1) : Math.ceil(index / 2));
      const controlPoint = computeControlPoint(sourcePosition, targetPosition, direction, offset);
      return {
        type: 'spline-curve',
        sourcePosition,
        targetPosition,
        controlPoints: [controlPoint]
      };
    }
    // default value
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
    this._onLayoutChange();
    this._onLayoutDone();
  };

  protected override _updateBounds(): void {
    const positions = Object.values(this._nodeMap ?? {}).map((node) =>
      this._normalizePosition(node)
    );
    this._bounds = this._calculateBounds(positions);
  }
}

/**
 * A helper function to compute the control point of a curve
 * @param  {number[]} source  - the coordinates of source point, ex: [x, y, z]
 * @param  {number[]} target  - the coordinates of target point, ex: [x, y, z]
 * @param  {number} direction - the direction of the curve, 1 or -1
 * @param  {number} offset    - offset from the midpoint
 * @return {number[]}         - the coordinates of the control point
 */
function computeControlPoint(source, target, direction, offset) {
  const midPoint = [(source[0] + target[0]) / 2, (source[1] + target[1]) / 2];
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const normal = [dy, -dx];
  const length = Math.sqrt(Math.pow(normal[0], 2.0) + Math.pow(normal[1], 2.0));
  const normalized = [normal[0] / length, normal[1] / length];
  return [
    midPoint[0] + normalized[0] * offset * direction,
    midPoint[1] + normalized[1] * offset * direction
  ];
}
