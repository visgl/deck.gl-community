// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Basic data structure of an edge
import {EDGE_STATE} from '../core/constants';
import {Node} from './node';

export interface EdgeOptions {
  id: string | number;
  sourceId: string | number;
  targetId: string | number;
  directed?: boolean;
  data: Record<string, unknown>;
}

export class Edge {
  /** Unique uuid of the edge. */
  public id: string | number;
  /** ID of the source node. */
  private _sourceId: string | number;
  /** ID of the target node. */
  private _targetId: string | number;
  /** Whether the edge is directed or not. */
  private _directed: boolean;
  /** Origin data reference of the edge. */
  private _data: Record<string, unknown>;
  /** Check the type of the object when picking engine gets it. */
  public readonly isEdge = true;
  /** Nodes at either end of this edge. */
  private readonly _connectedNodes: Record<string, Node> = {};
  /** Edge state. */
  public state = EDGE_STATE.DEFAULT;

  /**
   * The constructor
   * @param  {String|Number} options.id - the unique ID of the edge
   * @param  {String|Number} options.sourceId - the ID of the source node
   * @param  {String|Number} options.targetId - the ID of the target node
   * @param  {Boolean} options.directed - whether the edge is directed or not
   * @param  {Record<string, unknown>} options.data - origin data reference
   */
  constructor({id, sourceId, targetId, data, directed = false}: EdgeOptions) {
    this.id = id;
    this._sourceId = sourceId;
    this._targetId = targetId;
    this._directed = directed;
    this._data = data;
  }

  /**
   * Return the ID of the edge
   * @return {String|Number} - the ID of the edge.
   */
  getId(): string | number {
    return this.id;
  }

  /**
   * Return whether the edge is directed or not.
   * @return {Boolean} true if the edge is directed.
   */
  isDirected(): boolean {
    return this._directed;
  }

  /**
   * Get the ID of the source node.
   * @return {String|Number} the ID of the source node.
   */
  getSourceNodeId(): string | number {
    return this._sourceId;
  }

  /**
   * Get the ID of the target node.
   * @return {String|Number} the ID of the target node.
   */
  getTargetNodeId(): string | number {
    return this._targetId;
  }

  /**
   * Return of the value of the selected property key.
   * @param  {String} key - property key.
   * @return {Any} - the value of the property.
   */
  getPropertyValue(key: string): unknown {
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
   * Set the origin data as a reference.
   * @param {Object} data - the origin data.
   */
  setData(data: Record<string, unknown>): void {
    this._data = data;
  }

  /**
   * Update a data property.
   * @param {String} key - the key of the property
   * @param {Any} value - the value of the property.
   */
  setDataProperty(key: string, value: unknown): void {
    this._data[key] = value;
  }

  /**
   * Set edge state
   * @param {String} state - one of EDGE_STATE
   */
  setState(state: string): void {
    this.state = state;
  }

  /**
   * Get edge state
   * @returns {string} state - one of EDGE_STATE
   */
  getState(): string {
    return this.state;
  }

  addNode(node: Node): void {
    this._connectedNodes[node.getId()] = node;
  }

  removeNode(node: Node): void {
    delete this._connectedNodes[node.getId()];
  }

  getConnectedNodes(): Node[] {
    return Object.values(this._connectedNodes);
  }
}
