import {log} from '../utils/log';

// Basic graph data structure
export default class Graph extends EventTarget {
  /**
   * The constructor of the Graph class.
   * @param  {Object} graph - copy the graph if this exists.
   */
  constructor(graph = null) {
    super();

    // list object of nodes/edges
    this._nodeMap = {};
    this._edgeMap = {};
    // for identifying whether performing dirty check when streaming new data.
    // If the name of the graph is not specified,
    // will fall back to current time stamp.
    this._name = Date.now();
    // the last updated timestamp of the graph.
    this._lastUpdate = 0;

    // cached data: create array data from maps.
    this._cache = {
      nodes: [],
      edges: []
    };
    this._lastCacheUpdate = -1;

    // copy the graph if it exists in the parameter
    if (graph) {
      // start copying the graph
      this._nodeMap = graph._nodeMap;
      this._edgeMap = graph._edgeMap;
      this._name = graph && graph.name;
    }
  }

  /**
   * update last update time stamp
   */
  _touchLastUpdate() {
    // update last update time stamp
    this._lastUpdate += 1;
  }

  /**
   * update local data cache and _lastCacheUpdate.
   */
  _updateCache() {
    // create array data from maps.
    this._cache = {
      nodes: Object.values(this._nodeMap),
      edges: Object.values(this._edgeMap)
    };
    this._lastCacheUpdate = this._lastUpdate;
  }

  /**
   * Set graph name
   * @param {string} name
   */
  setGraphName(name) {
    this._name = name;
  }

  /** Get the name of the graph. Default value is the time stamp when creating this graph.
   * @return {string} graph name.
   */
  getGraphName() {
    return this._name;
  }

  /**
   * Add a new node to the graph.
   * @param {Node} node - expect a Node object to be added to the graph.
   */
  addNode(node) {
    // add it to the list and map
    this._nodeMap[node.getId()] = node;
    // update last update time stamp
    this._touchLastUpdate();
    this.dispatchEvent(new CustomEvent('onNodeAdded', {node}));
  }

  /**
   * Batch add nodes to the graph.
   * @param  {Node[]} nodes - a list of nodes to be added.
   */
  batchAddNodes(nodes) {
    // convert an array of objects to an object
    this._nodeMap = nodes.reduce(
      (res, node) => {
        res[node.getId()] = node;
        this.dispatchEvent(new CustomEvent('onNodeAdded', {node}));
        return res;
      },
      {...this._nodeMap}
    );
    this._touchLastUpdate();
  }

  /**
   * Get all the nodes of the graph.
   * @return {Node[]} - get all the nodes in the graph.
   */
  getNodes() {
    if (this._lastCacheUpdate !== this._lastUpdate) {
      this._updateCache();
    }
    return this._cache.nodes;
  }

  /**
   * Get the node map of the graph. The key of the map is the ID of the nodes.
   * @return {Object} - a map of nodes keyed by node IDs.
   */
  getNodeMap() {
    return this._nodeMap;
  }

  /**
   * Find a node by id
   * @param  {String} nodeId The id of the node
   * @return {Object} Node
   */
  findNode(nodeId) {
    return this._nodeMap[nodeId];
  }

  updateNode(node) {
    this._nodeMap[node.getId()] = node;
    this._touchLastUpdate();
    this.dispatchEvent(new CustomEvent('onNodeUpdated', {node}));
  }

  /**
   * Add a new edge to the graph.
   * @param {Edge} edge - expect a Edge object to be added to the graph.
   */
  addEdge(edge) {
    const sourceNode = this.findNode(edge.getSourceNodeId());
    const targetNode = this.findNode(edge.getTargetNodeId());

    if (!sourceNode || !targetNode) {
      log.warn(`Unable to add edge ${edge.id},  source or target node is missing.`)();
      return;
    }

    this._edgeMap[edge.getId()] = edge;
    sourceNode.addConnectedEdges(edge);
    targetNode.addConnectedEdges(edge);
    this._touchLastUpdate();
    this.dispatchEvent(new CustomEvent('onEdgeAdded', {edge}));
  }

  /**
   * Batch add edges to the graph
   * @param  {Edge[]} edges - a list of edges to be added.
   */
  batchAddEdges(edges) {
    edges.forEach((edge) => this.addEdge(edge));
    this._touchLastUpdate();
  }

  /**
   * Remove a node from the graph by node ID
   * @param  {String|Number} nodeId - the ID of the target node.
   */
  removeNode(nodeId) {
    const node = this.findNode(nodeId);
    if (!node) {
      log.warn(`Unable to remove node ${nodeId} - doesn't exist`)();
      return;
    }
    // remove all edges connect to this node from map
    node.getConnectedEdges().forEach((e) => {
      delete this._edgeMap[e.getId()];
    });
    // remove the node from map
    delete this._nodeMap[nodeId];
    this._touchLastUpdate();
    this.dispatchEvent(new CustomEvent('onNodeRemoved', {node}));
  }

  /**
   * Get all the edges of the graph.
   * @return {Edge[]} get all the edges in the graph.
   */
  getEdges() {
    if (this._lastCacheUpdate !== this._lastUpdate) {
      this._updateCache();
    }
    return this._cache.edges;
  }

  /**
   * Get the edge map of the graph. The key of the map is the ID of the edges.
   * @return {Object} - a map of edges keyed by edge IDs.
   */
  getEdgeMap() {
    return this._edgeMap;
  }

  /**
   * Remove an edge from the graph by the edge ID
   * @param  {String|Number} edgeId - the target edge ID.
   */
  removeEdge(edgeId) {
    const edge = this.findEdge(edgeId);
    if (!edge) {
      log.warn(`Unable to remove edge ${edgeId} - doesn't exist`)();
      return;
    }
    const sourceNode = this.findNode(edge.getSourceNodeId());
    const targetNode = this.findNode(edge.getTargetNodeId());

    delete this._edgeMap[edgeId];
    sourceNode.removeConnectedEdges(edge);
    targetNode.removeConnectedEdges(edge);
    this._touchLastUpdate();
  }

  /**
   * Find the edge by edge ID.
   * @param  {String|Number} id - the target edge ID
   * @return {Edge} - the target edge.
   */
  findEdge(edgeId) {
    return this._edgeMap[edgeId];
  }

  /**
   * Return all the connected edges of a node by nodeID.
   * @param  {String|Number} nodeId - the target node ID
   * @return {Edge[]} - an array of the connected edges.
   */
  getConnectedEdges(nodeId) {
    const node = this.findNode(nodeId);
    if (!node) {
      log.warn(`Unable to find node ${nodeId} - doesn't exist`)();
      return [];
    }
    return node.getConnectedEdges();
  }

  /**
   * Return all the sibling nodes of a node by nodeID.
   * @param  {String|Number} nodeId - the target node ID
   * @return {Node[]} - an array of the sibling nodes.
   */
  getNodeSiblings(nodeId) {
    const node = this.findNode(nodeId);
    if (!node) {
      log.warn(`Unable to find node ${nodeId} - doesn't exist`)();
      return [];
    }
    return node.getSiblingIds().map((siblingNodeId) => this.findNode(siblingNodeId));
  }

  /**
   * Get the degree of a node.
   * @param  {String|Number} nodeId - the target node ID.
   * @return {Number} - the degree of the node.
   */
  getDegree(nodeId) {
    const node = this.findNode(nodeId);
    if (!node) {
      log.warn(`Unable to find node ${nodeId} - doesn't exist`)();
      return 0;
    }
    return node.getDegree();
  }

  /**
   * Clean up all the nodes in the graph.
   */
  resetNodes() {
    this._nodeMap = {};
    this._touchLastUpdate();
  }

  /**
   * Clean up all the edges in the graph.
   */
  resetEdges() {
    this._edgeMap = {};
    this._touchLastUpdate();
  }

  /**
   * Clean up everything in the graph.
   */
  reset() {
    this.resetNodes();
    this.resetEdges();
    this._touchLastUpdate();
  }

  /**
   * Trigger an update to the graph.
   */
  triggerUpdate() {
    this._touchLastUpdate();
  }

  /**
   * Return true if the graph is empty.
   * @return {Boolean} Return true if the graph is empty.
   */
  isEmpty() {
    return Object.keys(this._nodeMap).length === 0;
  }

  /**
   * Check the equality of two graphs data by checking last update time stamp
   * @param  {Object} g Another graph to be compared against itself
   * @return {Bool}   True if the graph is the same as itself.
   */
  equals(g) {
    if (!g || !(g instanceof Graph)) {
      return false;
    }
    return this._lastUpdate === g._lastUpdate;
  }
}
