// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {BaseLayout} from './base-layout';
import {Cache} from './cache';
import {Edge} from './edge';
import {Graph} from './graph';

// Graph engine controls the graph data and layout calculation
export class GraphEngine extends EventTarget {
  private readonly _graph: Graph;
  private readonly _layout: BaseLayout;
  private readonly _cache = new Cache<'nodes' | 'edges', Node[] | Edge[]>();
  private _layoutDirty = false;
  private _transactionInProgress = false;

  constructor(graph: Graph, layout: BaseLayout) {
    super();
    this._graph = graph;
    this._layout = layout;
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

  getNodePosition = (node) => this._layout.getNodePosition(node);

  getEdgePosition = (edge) => this._layout.getEdgePosition(edge);

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
    /**
     * @event GraphEngine#onLayoutStart
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutStart'));
  };

  /**
   * @fires GraphEngine#onLayoutChange
   */
  _onLayoutChange = () => {
    /**
     * @event GraphEngine#onLayoutChange
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutChange'));
  };

  /**
   * @fires GraphEngine#onLayoutDone
   */
  _onLayoutDone = () => {
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
    // TODO: throw if running on a cleared engine

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
  };

  resume = () => this._layout.resume();

  stop = () => this._layout.stop();

  _graphChanged = () => {
    if (this._layoutDirty && !this._transactionInProgress) {
      this._updateLayout();
    }
  };

  _updateLayout = () => {
    this._layout.updateGraph(this._graph);
    this._layout.update();
    this._layoutDirty = false;
  };

  _updateCache(key, updateValue) {
    this._cache.set(key, updateValue, this._graph.version + this._layout.version);
  }
}
