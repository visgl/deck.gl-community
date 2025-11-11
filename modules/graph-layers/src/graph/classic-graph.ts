// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {warn} from '../utils/log';
import {Cache} from '../core/cache';
import {Edge} from './edge';
import {Node} from './node';
import {
  GraphLayout,
  type GraphLayoutProps,
  type GraphLayoutState,
  type GraphEdgeLayout
} from '../core/graph-layout';
import type {GraphRuntimeLayout} from '../core/graph-runtime-layout';
import type {EdgeInterface, NodeInterface, GraphProps} from './graph';
import {Graph} from './graph';

export type ClassicGraphProps = {
  name?: string;
  nodes?: Node[];
  edges?: Edge[];
};

/** Basic graph data structure */
export class ClassicGraph extends Graph {
  /** List object of nodes. */
  private _nodeMap: Record<string, Node> = {};
  /** List of object edges. */
  private _edgeMap: Record<string, Edge> = {};
  /**
   * Identifies whether performing dirty check when streaming new data. If
   * the name of the graph is not specified, will fall back to current time stamp.
   */
  private _name: string = Date.now().toString();
  /** Version the graph. A version is a number that is incremented every time the graph is updated. */
  public version = 0;
  /** Cached data: create array data from maps. */
  private _cache = new Cache<'nodes' | 'edges', Node[] | Edge[]>();

  constructor(props?: ClassicGraphProps, graphProps?: GraphProps);
  constructor(graph: ClassicGraph, graphProps?: GraphProps);

  /**
   * The constructor of the graph class.
   * @param graph - copy the graph if this exists.
   */
  constructor(propsOrGraph?: ClassicGraphProps | ClassicGraph, graphProps: GraphProps = {}) {
    super(graphProps);

    if (propsOrGraph instanceof ClassicGraph) {
      // if a Graph instance was supplied, copy the supplied graph into this graph
      const graph = propsOrGraph;
      this._name = graph?._name || this._name;
      this._nodeMap = graph._nodeMap;
      this._edgeMap = graph._edgeMap;
    } else {
      // If graphProps were supplied, initialize this graph from the supplied props
      const props = propsOrGraph;
      this._name = props?.name || this._name;
      this.batchAddNodes(props?.nodes || []);
      this.batchAddEdges(props?.edges || []);
    }
  }

  /**
   * Set graph name
   * @param name
   */
  setGraphName(name: string): void {
    this._name = name;
  }

  /** Get the name of the graph. Default value is the time stamp when creating this graph.
   * @return graph name.
   */
  getGraphName(): string {
    return this._name.toString();
  }

  /**
   * Perform a batch of operations defined by cb before indicating graph is updated
   * @param {function} cb - a callback function containing the operations to perform
   */
  transaction<T>(cb: (...args: unknown[]) => T): T {
    try {
      this.props.onTransactionStart?.();
      return cb();
    } finally {
      this.props.onTransactionEnd?.();
    }
  }

  /**
   * Add a new node to the graph.
   * @paramnode - expect a Node object to be added to the graph.
   */
  addNode(node: Node): void {
    // add it to the list and map
    this._nodeMap[node.getId()] = node;
    // update last update time stamp
    this._bumpVersion();
    this.props.onNodeAdded?.(node);
  }

  /**
   * Batch add nodes to the graph.
   * @param nodes - a list of nodes to be added.
   */
  batchAddNodes(nodes: Node[]): void {
    // convert an array of objects to an object
    this._nodeMap = nodes.reduce(
      (res, node) => {
        res[node.getId()] = node;
        this.props.onNodeAdded?.(node);
        return res;
      },
      {...this._nodeMap}
    );
    this._bumpVersion();
  }

  /**
   * Get all the nodes of the graph.
   * @return {Node[]} - get all the nodes in the graph.
   */
  getNodes(): NodeInterface[] {
    this._updateCache('nodes', () => Object.values(this._nodeMap));

    return (this._cache.get('nodes') as Node[]) ?? [];
  }

  /**
   * Get the node map of the graph. The key of the map is the ID of the nodes.
   * @return - a map of nodes keyed by node IDs.
   */
  getNodeMap(): Record<string | number, Node> {
    return this._nodeMap;
  }

  /**
   * Find a node by id
   * @param nodeId The id of the node
   * @return  Node
   */
  findNode(nodeId: string | number): Node | undefined {
    return this._nodeMap[nodeId];
  }

  findNodeById(nodeId: string | number): NodeInterface | undefined {
    return this.findNode(nodeId);
  }

  /**
   * Update the indicated node to the provided value
   * @param node
   */
  updateNode(node: Node): void {
    this._nodeMap[node.getId()] = node;
    this._bumpVersion();
    this.props.onNodeUpdated?.(node);
  }

  /**
   * Add a new edge to the graph.
   * @param edge - expect a Edge object to be added to the graph.
   */
  addEdge(edge: Edge): void {
    const sourceNode = this.findNode(edge.getSourceNodeId());
    const targetNode = this.findNode(edge.getTargetNodeId());

    if (!sourceNode || !targetNode) {
      warn(`Unable to add edge ${edge.id},  source or target node is missing.`);
      return;
    }

    this._edgeMap[edge.getId()] = edge;
    sourceNode.addConnectedEdges(edge);
    targetNode.addConnectedEdges(edge);
    this._bumpVersion();
    this.props.onEdgeAdded?.(edge);
  }

  /**
   * Batch add edges to the graph
   * @param edges - a list of edges to be added.
   */
  batchAddEdges(edges: Edge[]): void {
    edges.forEach((edge) => this.addEdge(edge));
    this._bumpVersion();
  }

  /**
   * Update the indicated edge to the provided value
   * @param edge
   */
  updateEdge(edge: Edge): void {
    this._edgeMap[edge.getId()] = edge;
    this._bumpVersion();
    this.props.onEdgeUpdated?.(edge);
  }

  /**
   * Remove a node from the graph by node ID
   * @param nodeId - the ID of the target node.
   */
  removeNode(nodeId: string | number): void {
    const node = this.findNode(nodeId);
    if (!node) {
      warn(`Unable to remove node ${nodeId} - doesn't exist`);
      return;
    }
    // remove all edges connect to this node from map
    node.getConnectedEdges().forEach((e) => {
      delete this._edgeMap[e.getId()];
    });
    // remove the node from map
    delete this._nodeMap[nodeId];
    this._bumpVersion();
    this.props.onNodeRemoved?.(node);
  }

  /**
   * Get all the edges of the graph.
   * @return get all the edges in the graph.
   */
  getEdges(): EdgeInterface[] {
    this._updateCache('edges', () => Object.values(this._edgeMap));

    return (this._cache.get('edges') as Edge[]) ?? [];
  }

  destroy(): void {
    // No additional teardown required for the legacy graph implementation.
  }

  /**
   * Get the edge map of the graph. The key of the map is the ID of the edges.
   * @return - a map of edges keyed by edge IDs.
   */
  getEdgeMap(): Record<string, Edge> {
    return this._edgeMap;
  }

  /**
   * Remove an edge from the graph by the edge ID
   * @param  {String|Number} edgeId - the target edge ID.
   */
  removeEdge(edgeId: string | number): void {
    const edge = this.findEdge(edgeId);
    if (!edge) {
      warn(`Unable to remove edge ${edgeId} - doesn't exist`);
      return;
    }
    const sourceNode = this.findNode(edge.getSourceNodeId());
    const targetNode = this.findNode(edge.getTargetNodeId());

    delete this._edgeMap[edgeId];
    sourceNode.removeConnectedEdges(edge);
    targetNode.removeConnectedEdges(edge);
    this._bumpVersion();
    this.props.onEdgeRemoved?.(edge);
  }

  /**
   * Find the edge by edge ID.
   * @param id - the target edge ID
   * @return - the target edge.
   */
  findEdge(edgeId: string | number): Edge {
    return this._edgeMap[edgeId];
  }

  /**
   * Return all the connected edges of a node by nodeID.
   * @param  nodeId - the target node ID
   * @return - an array of the connected edges.
   */
  getConnectedEdges(nodeId: string | number): EdgeInterface[] {
    const node = this.findNode(nodeId);
    if (!node) {
      warn(`Unable to find node ${nodeId} - doesn't exist`);
      return [];
    }
    return node.getConnectedEdges();
  }

  /**
   * Return all the sibling nodes of a node by nodeID.
   * @param nodeId - the target node ID
   * @return - an array of the sibling nodes.
   */
  getNodeSiblings(nodeId: string | number): Node[] {
    const node = this.findNode(nodeId);
    if (!node) {
      warn(`Unable to find node ${nodeId} - doesn't exist`);
      return [];
    }
    return node.getSiblingIds().map((siblingNodeId) => this.findNode(siblingNodeId));
  }

  /**
   * Get the degree of a node.
   * @param nodeId - the target node ID.
   * @return - the degree of the node.
   */
  getDegree(nodeId: string | number): number {
    const node = this.findNode(nodeId);
    if (!node) {
      warn(`Unable to find node ${nodeId} - doesn't exist`);
      return 0;
    }
    return node.getDegree();
  }

  /**
   * Clean up all the nodes in the graph.
   */
  resetNodes(): void {
    this._nodeMap = {};
    this._bumpVersion();
  }

  /**
   * Clean up all the edges in the graph.
   */
  resetEdges(): void {
    this._edgeMap = {};
    this._bumpVersion();
  }

  /**
   * Clean up everything in the graph.
   */
  reset(): void {
    this.resetNodes();
    this.resetEdges();
    this._bumpVersion();
  }

  /**
   * @deprecated Prefer interacting with this instance directly.
   */
  getClassicGraph(): ClassicGraph {
    return this;
  }

  /**
   * Trigger an update to the graph.
   */
  triggerUpdate(): void {
    this._bumpVersion();
  }

  /**
   * Return true if the graph is empty.
   * @return {Boolean} Return true if the graph is empty.
   */
  isEmpty(): boolean {
    return Object.keys(this._nodeMap).length === 0;
  }

  /**
   * Check the equality of two graphs data by checking last update time stamp
   * @param graph Another graph to be compared against itself
   * @return true if the graph is the same as itself.
   */
  equals(graph: ClassicGraph): boolean {
    if (!graph || !(graph instanceof ClassicGraph)) {
      return false;
    }
    return this.version === graph.version;
  }

  _bumpVersion(): void {
    this.version += 1;
  }

  _updateCache(key: 'nodes' | 'edges', updateValue: unknown): void {
    this._cache.set(key, updateValue as any, this.version);
  }
}

export class ClassicGraphLayoutAdapter implements GraphRuntimeLayout {
  private readonly layout: GraphLayout;

  constructor(layout: GraphLayout) {
    this.layout = layout;
  }

  get version(): number {
    return this.layout.version;
  }

  get state(): GraphLayoutState {
    return this.layout.state;
  }

  getProps(): GraphLayoutProps {
    return this.layout.getProps();
  }

  setProps(props: Partial<GraphLayoutProps>): void {
    this.layout.setProps(props);
  }

  initializeGraph(graph: Graph): void {
    this.layout.initializeGraph(this._assertClassicGraph(graph));
  }

  updateGraph(graph: Graph): void {
    this.layout.updateGraph(this._assertClassicGraph(graph));
  }

  start(): void {
    this.layout.start();
  }

  update(): void {
    this.layout.update();
  }

  resume(): void {
    this.layout.resume();
  }

  stop(): void {
    this.layout.stop();
  }

  getBounds() {
    return this.layout.getBounds();
  }

  getNodePosition(node: NodeInterface): [number, number] | null {
    return this.layout.getNodePosition(node as Node);
  }

  getEdgePosition(edge: EdgeInterface): GraphEdgeLayout | null {
    return this.layout.getEdgePosition(edge as Edge);
  }

  lockNodePosition(node: NodeInterface, x: number, y: number): void {
    this.layout.lockNodePosition(node as Node, x, y);
  }

  unlockNodePosition(node: NodeInterface): void {
    this.layout.unlockNodePosition(node as Node);
  }

  destroy(): void {
    this.layout.setProps({
      onLayoutStart: undefined,
      onLayoutChange: undefined,
      onLayoutDone: undefined,
      onLayoutError: undefined
    });
  }

  private _assertClassicGraph(graph: Graph): ClassicGraph {
    if (graph instanceof ClassicGraph) {
      return graph;
    }
    throw new Error('ClassicGraphLayoutAdapter expects a ClassicGraph instance.');
  }

}
