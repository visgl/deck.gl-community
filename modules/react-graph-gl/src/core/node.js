import {NODE_STATE} from './constants';

// Basic data structure of a node
export default class Node {
  /**
   * The constructor of a node
   * @param  {String|Number} options.id   - the unique ID of the node
   * @param  {Any} options.data - origin data reference
   */
  constructor({id, selectable = false, highlightConnectedEdges = false, data = {}}) {
    this.id = id;
    // keep a reference to origin data
    this._data = data;
    // derived properties
    // list objects
    this._connectedEdges = {};
    // the interaction state of the node
    this.state = NODE_STATE.DEFAULT;
    // check the type of the object when picking engine gets it.
    this.isNode = true;
    // Can the node be selected?
    this._selectable = selectable;
    // Should the state of this node affect the state of the connected edges?
    this._highlightConnectedEdges = highlightConnectedEdges;
  }

  /**
   * Return the ID of the node
   * @return {String|Number} - the ID of the node.
   */
  getId() {
    return this.id;
  }

  /**
   * Return the degree of the node -- includes in-degree and out-degree
   * @return {Number} - the degree of the node.
   */
  getDegree() {
    return Object.keys(this._connectedEdges).length;
  }

  /**
   * Return the in-degree of the node.
   * @return {Number} - the in-degree of the node.
   */
  getInDegree() {
    const nodeId = this.getId();
    return this.getConnectedEdges().reduce((count, e) => {
      const isDirected = e.isDirected();
      if (isDirected && e.getTargetNodeId() === nodeId) {
        count += 1;
      }
      return count;
    }, 0);
  }

  /**
   * Return the out-degree of the node.
   * @return {Number} - the out-degree of the node.
   */
  getOutDegree() {
    const nodeId = this.getId();
    return this.getConnectedEdges().reduce((count, e) => {
      const isDirected = e.isDirected();
      if (isDirected && e.getSourceNodeId() === nodeId) {
        count += 1;
      }
      return count;
    }, 0);
  }

  /**
   * Return all the IDs of the sibling nodes.
   * @return {String[]} [description]
   */
  getSiblingIds() {
    const nodeId = this.getId();
    return this.getConnectedEdges().reduce((siblings, e) => {
      if (e.getTargetNodeId() === nodeId) {
        siblings.push(e.getSourceNodeId());
      } else {
        siblings.push(e.getTargetNodeId());
      }
      return siblings;
    }, []);
  }

  /**
   * Return all the connected edges.
   * @return {Object[]} - an array of the connected edges.
   */
  getConnectedEdges() {
    return Object.values(this._connectedEdges);
  }

  /**
   * Return of the value of the selected property key.
   * @param  {String} key - property key.
   * @return {Any} - the value of the property or undefined (not found).
   */
  getPropertyValue(key) {
    // try to search the key within this object
    if (this.hasOwnProperty(key)) {
      return this[key];
    }
    // try to search the key in the original data reference
    else if (this._data.hasOwnProperty(key)) {
      return this._data[key];
    }
    // otherwise, not found
    return undefined;
  }

  /**
   * Set the new node data.
   * @param {Any} data - the new data of the node
   */
  setData(data) {
    this._data = data;
  }

  /**
   * Update a data property.
   * @param {String} key - the key of the property
   * @param {Any} value - the value of the property.
   */
  setDataProperty(key, value) {
    this._data[key] = value;
  }

  /**
   * Set node state
   * @param {String} state - one of NODE_STATE
   */
  setState(state) {
    this.state = state;
  }

  /**
   * Get node state
   * @returns {string} state - one of NODE_STATE
   */
  getState() {
    return this.state;
  }

  /**
   * Add connected edges to the node
   * @param {Edge || Edge[]} edge an edge or an array of edges to be added to this._connectedEdges
   */
  addConnectedEdges(edge) {
    const iterableEdges = Array.isArray(edge) ? edge : [edge];
    this._connectedEdges = iterableEdges.reduce(
      (res, e) => {
        res[e.id] = e;
        e.addNode(this);
        return res;
      },
      {...this._connectedEdges}
    );
  }

  /**
   * Remove edges from this._connectedEdges
   * @param {Edge | Edge[]} edge an edge or an array of edges to be removed from this._connectedEdges
   */
  removeConnectedEdges(edge) {
    const iterableEdges = Array.isArray(edge) ? edge : [edge];
    iterableEdges.forEach((e) => {
      e.removeNode(this);
      delete this._connectedEdges[e.id];
    });
  }

  /**
   * Clear this._connectedEdges
   */
  clearConnectedEdges() {
    Object.values(this._connectedEdges).forEach((e) => e.removeNode(this));
    this._connectedEdges = {};
  }

  isSelectable() {
    return this._selectable;
  }

  shouldHighlightConnectedEdges() {
    return this._highlightConnectedEdges;
  }
}
