// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds2D} from '@math.gl/types';

import type {Graph} from '../graph/graph';
import type {Node} from '../graph/node';
import type {Edge} from '../graph/edge';

import isEqual from 'lodash.isequal';
import {log} from '../utils/log';

// the status of the layout
export type GraphLayoutState = 'init' | 'start' | 'calculating' | 'done' | 'error';

export type GraphLayoutBounds = Bounds2D;

export type GraphLayoutEventDetail = {
  bounds: GraphLayoutBounds | null;
};

export type GraphLayoutOptions = {};

/** All the layout classes are extended from this base layout class. */
export class GraphLayout<
  OptionsT extends GraphLayoutOptions = GraphLayoutOptions
> extends EventTarget {
  /** Name of the layout. */
  protected readonly _name: string = 'GraphLayout';
  /** Extra configuration options of the layout. */
  protected _options: OptionsT;

  /**
   * Last computed layout bounds in local layout coordinates.
   *
   * Subclasses should update this value by overriding {@link _updateBounds}
   * so it reflects the latest geometry before layout lifecycle events fire.
   */
  protected _bounds: GraphLayoutBounds | null = null;

  public version = 0;
  public state: GraphLayoutState = 'init';

  /**
   * Constructor of GraphLayout
   * @param options extra configuration options of the layout
   */
  constructor(options: OptionsT) {
    super();
    this._options = options;
  }

  /**
   * Check the equality of two layouts
   * @param layout - The layout to be compared.
   * @return - True if the layout is the same as itself.
   */
  equals(layout: GraphLayout): boolean {
    if (!layout || !(layout instanceof GraphLayout)) {
      return false;
    }
    return this._name === layout._name && isEqual(this._options, layout._options);
  }

  /** virtual functions: will be implemented in the child class */

  /** first time to pass the graph data into this layout */
  initializeGraph(graph: Graph) {}
  /** update the existing graph */
  updateGraph(graph: Graph) {}
  /** start the layout calculation */
  start() {}
  /** update the layout calculation */
  update() {}
  /** resume the layout calculation */
  resume() {}
  /** stop the layout calculation */
  stop() {}
  /** access the position of the node in the layout */
  getNodePosition(node: Node): [number, number] {
    return [0, 0];
  }
  /** access the layout information of the edge */
  getEdgePosition(edge: Edge) {
    return {
      type: 'line',
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

  /** Returns the last computed layout bounds, if available. */
  getBounds(): GraphLayoutBounds | null {
    return this._bounds;
  }

  // INTERNAL METHODS

  /** Hook for subclasses to update bounds prior to emitting events. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected _updateBounds(): void {}

  /**
   * Utility for subclasses to derive layout bounds from an iterable of [x, y] positions.
   * @param positions Iterable of node positions.
   * @returns Layout bounds for the supplied positions or `null` if none are finite.
   */
  protected _calculateBounds(
    positions: Iterable<Readonly<[number, number]> | null | undefined>
  ): GraphLayoutBounds | null {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const position of positions) {
      if (!position) {
        continue;
      }
      const [x, y] = position;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    if (minX === Number.POSITIVE_INFINITY) {
      return null;
    }

    return [
      [minX, minY],
      [maxX, maxY]
    ];
  }

  protected _updateState(state: GraphLayoutState) {
    this.state = state;
    this.version += 1;
  }

  /** @fires GraphLayout#onLayoutStart */
  protected _onLayoutStart = (): void => {
    log.log(0, `GraphLayout(${this._name}): start`)();
    this._updateBounds();
    this._updateState('calculating');

    /**
     * Layout calculation start.
     * @event GraphLayout#onLayoutChange
     * @type {CustomEvent}
     */
    const detail: GraphLayoutEventDetail = {bounds: this._bounds};
    this.dispatchEvent(new CustomEvent<GraphLayoutEventDetail>('onLayoutStart', {detail}));
  };

  /** @fires GraphLayout#onLayoutChange */
  protected _onLayoutChange = (): void => {
    log.log(0, `GraphLayout(${this._name}): update`)();
    this._updateBounds();
    this._updateState('calculating');

    /**
     * Layout calculation iteration.
     * @event GraphLayout#onLayoutChange
     * @type {CustomEvent}
     */
    const detail: GraphLayoutEventDetail = {bounds: this._bounds};
    this.dispatchEvent(new CustomEvent<GraphLayoutEventDetail>('onLayoutChange', {detail}));
  };

  /** @fires GraphLayout#onLayoutDone */
  protected _onLayoutDone = (): void => {
    log.log(0, `GraphLayout(${this._name}): end`)();
    this._updateBounds();
    this._updateState('done');

    /**
     * Layout calculation is done.
     * @event GraphLayout#onLayoutDone
     * @type {CustomEvent}
     */
    const detail: GraphLayoutEventDetail = {bounds: this._bounds};
    this.dispatchEvent(new CustomEvent<GraphLayoutEventDetail>('onLayoutDone', {detail}));
  };

  /** @fires GraphLayout#onLayoutError */
  protected _onLayoutError = (): void => {
    this._updateState('error');

    /**
     * Layout calculation went wrong.
     * @event GraphLayout#onLayoutError
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutError'));
  };
}
