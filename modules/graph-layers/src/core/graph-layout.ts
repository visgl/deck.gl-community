// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds2D} from '@math.gl/types';

import type {LegacyGraph} from '../graph/legacy-graph';
import type {NodeInterface, EdgeInterface} from '../graph/graph';

import isEqual from 'lodash.isequal';
import {log} from '../utils/log';

// the status of the layout
export type GraphLayoutState = 'init' | 'start' | 'calculating' | 'done' | 'error';

export type GraphLayoutEventDetail = {
  bounds: Bounds2D | null;
};

export type GraphLayoutProps = {
  onLayoutStart?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutChange?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutDone?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutError?: (error?: unknown) => void;
};

export const GRAPH_LAYOUT_DEFAULT_PROPS: Readonly<Required<GraphLayoutProps>> = {
  onLayoutStart: undefined,
  onLayoutChange: undefined,
  onLayoutDone: undefined,
  onLayoutError: undefined
};

export abstract class GraphLayout<
  PropsT extends GraphLayoutProps = GraphLayoutProps
> {
  /** Name of the layout. */
  protected readonly _name: string = 'GraphLayout';
  /** Extra configuration props of the layout. */
  protected props: PropsT;

  /**
   * Last computed layout bounds in local layout coordinates.
   *
   * Subclasses should update this value by overriding {@link _updateBounds}
   * so it reflects the latest geometry before layout lifecycle events fire.
   */
  protected _bounds: Bounds2D | null = null;

  public version = 0;
  public state: GraphLayoutState = 'init';

  /**
   * Constructor of GraphLayout
   * @param props extra configuration props of the layout
   */
  constructor(props: PropsT = {} as PropsT, defaultProps?: Partial<PropsT>) {
    this.props = {
      ...(GRAPH_LAYOUT_DEFAULT_PROPS as PropsT),
      ...(defaultProps ?? ({} as PropsT)),
      ...props
    };
  }

  getProps(): PropsT {
    return {...this.props};
  }

  setProps(props: Partial<PropsT>): void {
    this.props = {...this.props, ...props};
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
    return this._name === layout._name && isEqual(this.props, layout.props);
  }

  // Accessors

  /** access the position of the node in the layout */
  getNodePosition(node: NodeInterface): [number, number] {
    return [0, 0];
  }

  /** access the layout information of the edge */
  getEdgePosition(edge: EdgeInterface) {
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
  lockNodePosition(node: NodeInterface, x: number, y: number) {}

  /**
   * Unlock the node, the node will be able to move freely.
   * @param  {Object} node Node to be unlocked
   */
  unlockNodePosition(node: NodeInterface) {}

  /** Returns the last computed layout bounds, if available. */
  getBounds(): Bounds2D | null {
    return this._bounds;
  }

    /** virtual functions: will be implemented in the child class */

  /** first time to pass the graph data into this layout */
  abstract initializeGraph(graph: LegacyGraph);
  /** update the existing graph */
  abstract updateGraph(graph: LegacyGraph);
  /** start the layout calculation */
  abstract start();
  /** update the layout calculation */
  abstract update();
  /** resume the layout calculation */
  abstract resume();
  /** stop the layout calculation */
  abstract stop();


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
  ): Bounds2D | null {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const position of positions) {
      if (!position) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const [x, y] = position;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        // eslint-disable-next-line no-continue
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

  /**
   * Attempt to coerce an arbitrary value into a finite 2D point.
   * @param value Candidate value that may represent a position.
   * @returns Finite [x, y] tuple or null if the value cannot be interpreted.
   */
  protected _normalizePosition(value: unknown): [number, number] | null {
    if (Array.isArray(value) && value.length >= 2) {
      const [x, y] = value as [unknown, unknown];
      if (this._isFiniteNumber(x) && this._isFiniteNumber(y)) {
        return [x, y];
      }
      return null;
    }

    if (value && typeof value === 'object') {
      const {x, y} = value as {x?: unknown; y?: unknown};
      if (this._isFiniteNumber(x) && this._isFiniteNumber(y)) {
        return [x, y];
      }
    }

    return null;
  }

  private _isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
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
    this.props.onLayoutStart?.(detail);
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
    this.props.onLayoutChange?.(detail);
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
    this.props.onLayoutDone?.(detail);
  };

  /** @fires GraphLayout#onLayoutError */
  protected _onLayoutError = (): void => {
    this._updateState('error');

    /**
     * Layout calculation went wrong.
     * @event GraphLayout#onLayoutError
     * @type {CustomEvent}
     */
    this.props.onLayoutError?.();
  };
}
