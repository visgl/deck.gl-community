// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Node} from '../graph/node';
import {Edge} from '../graph/edge';
import {Graph} from '../graph/graph';
import {GraphLayout} from './graph-layout';
import {Cache} from './cache';
import {log} from '../utils/log';

export type GraphEngineProps = {
  graph: Graph;
  layout: GraphLayout;
  /**
   * Throttle layout change notifications (in milliseconds). When greater than zero the
   * engine will avoid emitting more than one `onLayoutChange` event within the configured
   * interval. This is useful to slow down very fast layout updates so that the
   * visualization can animate at a comfortable pace.
   */
  layoutUpdateThrottleMs?: number;
};

/** Graph engine controls the graph data and layout calculation */
export class GraphEngine extends EventTarget {
  props: Readonly<GraphEngineProps>;

  private readonly _graph: Graph;
  private readonly _layout: GraphLayout;
  private readonly _layoutUpdateThrottleMs: number;
  private readonly _cache = new Cache<'nodes' | 'edges', Node[] | Edge[]>();
  private _layoutDirty = false;
  private _transactionInProgress = false;
  private _layoutChangeTimeout: ReturnType<typeof setTimeout> | null = null;
  private _lastLayoutChangeTs = 0;
  private _pendingLayoutChange = false;

  constructor(props: GraphEngineProps);
  /** @deprecated Use props constructor: new GraphEngine(props) */
  constructor(graph: Graph, layout: GraphLayout);

  constructor(props: GraphEngineProps | Graph, layout?: GraphLayout) {
    super();
    if (props instanceof Graph) {
      props = {
        graph: props,
        layout
      };
    }

    this.props = props;
    this._graph = props.graph;
    this._layout = props.layout;
    this._layoutUpdateThrottleMs = props.layoutUpdateThrottleMs ?? 0;
  }

  /** Getters */

  getNodes = (): Node[] => {
    this._updateCache('nodes', () =>
      this._graph.getNodes().filter((node) => this.getNodePosition(node))
    );

    return this._cache.get('nodes') as Node[];
  };

  getEdges = () => {
    this._updateCache('edges', () =>
      this._graph.getEdges().filter((edge) => this.getEdgePosition(edge))
    );

    return this._cache.get('edges') as Edge[];
  };

  getNodePosition = (node: Node) => this._layout.getNodePosition(node);

  getEdgePosition = (edge: Edge) => this._layout.getEdgePosition(edge);

  getGraphVersion = () => this._graph.version;

  getLayoutLastUpdate = () => this._layout.version;

  getLayoutState = () => this._layout.state;

  /** Operations on the graph */

  lockNodePosition = (node, x, y) => this._layout.lockNodePosition(node, x, y);

  unlockNodePosition = (node) => this._layout.unlockNodePosition(node);

  /**
   * @fires GraphEngine#onLayoutStart
   */
  _onLayoutStart = () => {
    log.log(0, 'GraphEngine: layout start')();
    /**
     * @event GraphEngine#onLayoutStart
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutStart'));
  };

  /**
   * @fires GraphEngine#onLayoutChange
   */
  private _emitLayoutChangeEvent = () => {
    log.log(0, 'GraphEngine: layout update event')();
    /**
     * @event GraphEngine#onLayoutChange
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutChange'));
  };

  private _clearPendingLayoutChange() {
    if (this._layoutChangeTimeout) {
      clearTimeout(this._layoutChangeTimeout);
      this._layoutChangeTimeout = null;
    }
    this._pendingLayoutChange = false;
  }

  private _handleLayoutChange = () => {
    if (!this._layoutUpdateThrottleMs) {
      this._clearPendingLayoutChange();
      this._lastLayoutChangeTs = Date.now();
      this._emitLayoutChangeEvent();
      return;
    }

    const now = Date.now();
    const elapsed = now - this._lastLayoutChangeTs;
    if (!this._layoutChangeTimeout) {
      if (elapsed >= this._layoutUpdateThrottleMs) {
        this._lastLayoutChangeTs = now;
        this._emitLayoutChangeEvent();
        return;
      }

      const delay = Math.max(this._layoutUpdateThrottleMs - elapsed, 0);
      this._scheduleThrottledLayoutChange(delay);
      return;
    }

    this._pendingLayoutChange = true;
  };

  private _scheduleThrottledLayoutChange(delay: number) {
    this._layoutChangeTimeout = setTimeout(() => {
      this._layoutChangeTimeout = null;
      this._lastLayoutChangeTs = Date.now();
      this._emitLayoutChangeEvent();
      if (this._pendingLayoutChange) {
        this._pendingLayoutChange = false;
        if (this._layoutUpdateThrottleMs > 0) {
          this._scheduleThrottledLayoutChange(this._layoutUpdateThrottleMs);
        }
      }
    }, delay);
  }

  _onLayoutChange = () => {
    this._handleLayoutChange();
  };

  /**
   * @fires GraphEngine#onLayoutDone
   */
  _onLayoutDone = () => {
    if (this._layoutUpdateThrottleMs && this._layoutChangeTimeout) {
      this._clearPendingLayoutChange();
      this._lastLayoutChangeTs = Date.now();
      this._emitLayoutChangeEvent();
    }
    log.log(0, 'GraphEngine: layout end')();
    /**
     * @event GraphEngine#onLayoutDone
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutDone'));
  };

  /**
   * @fires GraphEngine#onLayoutError
   */
  _onLayoutError = () => {
    /**
     * @event GraphEngine#onLayoutError
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutError'));
  };

  _onGraphStructureChanged = (entity) => {
    this._layoutDirty = true;
    this._graphChanged();
  };

  _onTransactionStart = () => {
    this._transactionInProgress = true;
  };

  _onTransactionEnd = () => {
    this._transactionInProgress = false;
    this._graphChanged();
  };

  /** Layout calculations */

  run = () => {
    log.log(1, 'GraphEngine: run')();
    // TODO: throw if running on a cleared engine
    this._clearPendingLayoutChange();
    this._lastLayoutChangeTs = 0;

    this._graph.addEventListener('transactionStart', this._onTransactionStart);
    this._graph.addEventListener('transactionEnd', this._onTransactionEnd);
    this._graph.addEventListener('onNodeAdded', this._onGraphStructureChanged);
    this._graph.addEventListener('onNodeRemoved', this._onGraphStructureChanged);
    this._graph.addEventListener('onEdgeAdded', this._onGraphStructureChanged);
    this._graph.addEventListener('onEdgeRemoved', this._onGraphStructureChanged);

    this._layout.addEventListener('onLayoutStart', this._onLayoutStart);
    this._layout.addEventListener('onLayoutChange', this._onLayoutChange);
    this._layout.addEventListener('onLayoutDone', this._onLayoutDone);
    this._layout.addEventListener('onLayoutError', this._onLayoutError);

    this._layout.initializeGraph(this._graph);
    this._layout.start();
  };

  clear = () => {
    log.log(1, 'GraphEngine: end')();
    this._graph.removeEventListener('transactionStart', this._onTransactionStart);
    this._graph.removeEventListener('transactionEnd', this._onTransactionEnd);
    this._graph.removeEventListener('onNodeAdded', this._onGraphStructureChanged);
    this._graph.removeEventListener('onNodeRemoved', this._onGraphStructureChanged);
    this._graph.removeEventListener('onEdgeAdded', this._onGraphStructureChanged);
    this._graph.removeEventListener('onEdgeRemoved', this._onGraphStructureChanged);

    this._layout.removeEventListener('onLayoutStart', this._onLayoutStart);
    this._layout.removeEventListener('onLayoutChange', this._onLayoutChange);
    this._layout.removeEventListener('onLayoutDone', this._onLayoutDone);
    this._layout.removeEventListener('onLayoutError', this._onLayoutError);

    this._clearPendingLayoutChange();
  };

  resume = () => this._layout.resume();

  stop = () => this._layout.stop();

  _graphChanged = () => {
    if (this._layoutDirty && !this._transactionInProgress) {
      this._updateLayout();
    }
  };

  _updateLayout = () => {
    log.log(0, 'GraphEngine: layout update')();
    this._lastLayoutChangeTs = 0;
    this._layout.updateGraph(this._graph);
    this._layout.update();
    this._layoutDirty = false;
  };

  _updateCache(key, updateValue) {
    this._cache.set(key, updateValue, this._graph.version + this._layout.version);
  }
}
