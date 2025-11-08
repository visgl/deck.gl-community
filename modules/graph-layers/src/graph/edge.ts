// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Basic data structure of an edge
import type {EdgeState} from '../core/constants';
import type {EdgeInterface, NodeInterface} from './graph';

export interface EdgeOptions {
  /** the unique ID of the edge */
  id: string | number;
  /** the ID of the source node */
  sourceId: string | number;
  /** the ID of the target node */
  targetId: string | number;
  /** whether the edge is directed or not */
  directed?: boolean;
  /** origin data reference */
  data?: Record<string, unknown>;
}

/** Basic edge data structure */
export class Edge implements EdgeInterface {
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
  private readonly _connectedNodes: Record<string, NodeInterface> = {};
  /** Edge state. */
  public state: EdgeState = 'default';

  /**
   * The constructor
   * @param options.id - information about the edge
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
   * @return the ID of the source node.
   */
  getSourceNodeId(): string | number {
    return this._sourceId;
  }

  /**
   * Get the ID of the target node.
   * @return the ID of the target node.
   */
  getTargetNodeId(): string | number {
    return this._targetId;
  }

  /**
   * Return of the value of the selected property key.
   * @param  key - property key.
   * @return - the value of the property.
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
   * @param data - the origin data.
   */
  setData(data: Record<string, unknown>): void {
    this._data = data;
  }

  /**
   * Update a data property.
   * @param key - the key of the property
   * @param value - the value of the property.
   */
  setDataProperty(key: string, value: unknown): void {
    this._data[key] = value;
  }

  /**
   * Set edge state
   * @param state - the new interaction state for the edge
   */
  setState(state: EdgeState): void {
    this.state = state;
  }

  /**
   * Get edge state
   * @returns state - the current interaction state for the edge
   */
  getState(): EdgeState {
    return this.state;
  }

  addNode(node: NodeInterface): void {
    this._connectedNodes[node.getId()] = node;
  }

  removeNode(node: NodeInterface): void {
    delete this._connectedNodes[node.getId()];
  }

  getConnectedNodes(): NodeInterface[] {
    return Object.values(this._connectedNodes);
  }
}
