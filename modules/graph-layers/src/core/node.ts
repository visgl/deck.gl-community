// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {NODE_STATE, ValueOf} from './constants';
import {Edge} from './edge';

interface NodeOptions {
  id: number | string;
  selectable?: boolean;
  highlightConnectedEdges?: boolean;
  data: Record<string, unknown>;
}

// Basic data structure of a node
export class Node {
  public id: string | number;
  /** Keep a reference to origin data. */
  private _data: Record<string, unknown>;
  /** List edges. */
  private _connectedEdges: Record<string, Edge> = {};
  /** Interaction state of the node. */
  public state: ValueOf<typeof NODE_STATE> = NODE_STATE.DEFAULT;
  /** Can the node be selected? */
  private _selectable: boolean;
  /** Should the state of this node affect the state of the connected edges? */
  private _highlightConnectedEdges: boolean;
  /** Check the type of the object when picking engine gets it. */
  public readonly isNode = true;
  /**
   * The constructor of a node
   * @param  {String|Number} options.id   - the unique ID of the node
   * @param  {Record<string, unknown>} options.data - origin data reference
   */
  constructor({id, selectable = false, highlightConnectedEdges = false, data = {}}: NodeOptions) {
    this.id = id;
    this._data = data;
    this._selectable = selectable;
    this._highlightConnectedEdges = highlightConnectedEdges;
  }

  /**
   * Return the ID of the node
   * @return {String|Number} - the ID of the node.
   */
  getId(): string | number {
    return this.id;
  }

  /**
   * Return the degree of the node -- includes in-degree and out-degree
   * @return {Number} - the degree of the node.
   */
  getDegree(): number {
    return Object.keys(this._connectedEdges).length;
  }

  /**
   * Return the in-degree of the node.
   * @return {Number} - the in-degree of the node.
   */
  getInDegree(): number {
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
  getOutDegree(): number {
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
  getSiblingIds(): (string | number)[] {
    const nodeId = this.getId();
    return this.getConnectedEdges().reduce(
      (siblings, e) => {
        if (e.getTargetNodeId() === nodeId) {
          siblings.push(e.getSourceNodeId());
        } else {
          siblings.push(e.getTargetNodeId());
        }
        return siblings;
      },
      [] as (string | number)[]
    );
  }

  /**
   * Return all the connected edges.
   * @return {Object[]} - an array of the connected edges.
   */
  getConnectedEdges(): Edge[] {
    return Object.values(this._connectedEdges);
  }

  /**
   * Return of the value of the selected property key.
   * @param  {String} key - property key.
   * @return {Any} - the value of the property or undefined (not found).
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
   * Set the new node data.
   * @param {Record<string, unknown>} data - the new data of the node
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
   * Set node state
   * @param {String} state - one of NODE_STATE
   */
  setState(state: ValueOf<typeof NODE_STATE>): void {
    this.state = state;
  }

  /**
   * Get node state
   * @returns {string} state - one of NODE_STATE
   */
  getState(): ValueOf<typeof NODE_STATE> {
    return this.state;
  }

  /**
   * Add connected edges to the node
   * @param {Edge || Edge[]} edge an edge or an array of edges to be added to this._connectedEdges
   */
  addConnectedEdges(edge: Edge | Edge[]): void {
    const iterableEdges = Array.isArray(edge) ? edge : [edge];
    iterableEdges.forEach((e) => {
      this._connectedEdges[e.id] = e;
      e.addNode(this);
    });
  }

  /**
   * Remove edges from this._connectedEdges
   * @param {Edge | Edge[]} edge an edge or an array of edges to be removed from this._connectedEdges
   */
  removeConnectedEdges(edge: Edge | Edge[]): void {
    const iterableEdges = Array.isArray(edge) ? edge : [edge];
    iterableEdges.forEach((e) => {
      e.removeNode(this);
      delete this._connectedEdges[e.id];
    });
  }

  /**
   * Clear this._connectedEdges
   */
  clearConnectedEdges(): void {
    Object.values(this._connectedEdges).forEach((e) => e.removeNode(this));
    this._connectedEdges = {};
  }

  isSelectable(): boolean {
    return this._selectable;
  }

  shouldHighlightConnectedEdges(): boolean {
    return this._highlightConnectedEdges;
  }
}
