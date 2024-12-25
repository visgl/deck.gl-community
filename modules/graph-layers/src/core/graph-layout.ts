// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Graph} from './graph';
import type {Node} from './node';
import type {Edge} from './edge';

import isEqual from 'lodash.isequal';
import {EDGE_TYPE} from './constants';

// the status of the layout
export type GraphLayoutState = 'INIT' | 'START' | 'CALCULATING' | 'DONE' | 'ERROR';

export type GraphLayoutOptions = {};

/** All the layout classes are extended from this base layout class. */
export class GraphLayout extends EventTarget {
  /** Name of the layout. */
  protected readonly _name: string = 'GraphLayout';
  /** Extra configuration options of the layout. */
  protected _options: GraphLayoutOptions;

  public version = 0;
  public state: GraphLayoutState = 'INIT';

  /**
   * Constructor of GraphLayout
   * @param  {Object} options extra configuration options of the layout
   */
  constructor(options: GraphLayoutOptions) {
    super();
    this._options = options;
  }

  /**
   * @fires GraphLayout#onLayoutStart
   * @protected
   */
  _onLayoutStart(): void {
    this._updateState('CALCULATING');

    /**
     * Layout calculation start.
     *
     * @event GraphLayout#onLayoutChange
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutStart'));
  }

  /**
   * @fires GraphLayout#onLayoutChange
   * @protected
   */
  _onLayoutChange(): void {
    this._updateState('CALCULATING');

    /**
     * Layout calculation iteration.
     *
     * @event GraphLayout#onLayoutChange
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutChange'));
  }

  /**
   * @fires GraphLayout#onLayoutDone
   * @protected
   */
  _onLayoutDone(): void {
    this._updateState('DONE');

    /**
     * Layout calculation is done.
     *
     * @event GraphLayout#onLayoutDone
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutDone'));
  }

  /**
   * @fires GraphLayout#onLayoutError
   * @protected
   */
  _onLayoutError(): void {
    this._updateState('ERROR');

    /**
     * Layout calculation went wrong.
     *
     * @event GraphLayout#onLayoutError
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutError'));
  }

  /**
   * Check the equality of two layouts
   * @param  {Object} layout The layout to be compared.
   * @return {Bool}   True if the layout is the same as itself.
   */
  equals(layout: GraphLayout): boolean {
    if (!layout || !(layout instanceof GraphLayout)) {
      return false;
    }
    return this._name === layout._name && isEqual(this._options, layout._options);
  }

  /** virtual functions: will be implemented in the child class */

  // first time to pass the graph data into this layout
  initializeGraph(graph: Graph) {}
  // update the existing graph
  updateGraph(graph: Graph) {}
  // start the layout calculation
  start() {}
  // update the layout calculation
  update() {}
  // resume the layout calculation
  resume() {}
  // stop the layout calculation
  stop() {}
  // access the position of the node in the layout
  getNodePosition(node: Node): [number, number] {
    return [0, 0];
  }
  // access the layout information of the edge
  getEdgePosition(edge: Edge) {
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: []
    };
  }

  /**
   * Pin the node to a designated position, and the node won't move anymore
   * @param  node Node to be locked
   * @param  x    x coordinate
   * @param  y    y coordinate
   */
  lockNodePosition(node: Node, x: number, y: number) {}

  /**
   * Unlock the node, the node will be able to move freely.
   * @param  {Object} node Node to be unlocked
   */
  unlockNodePosition(node: Node) {}

  _updateState(state) {
    this.state = state;
    this.version += 1;
  }
}