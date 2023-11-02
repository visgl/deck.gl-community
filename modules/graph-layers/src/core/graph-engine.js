import {Cache} from './cache.js';

// Graph engine controls the graph data and layout calculation
export default class GraphEngine extends EventTarget {
  constructor(graph, layout) {
    super();

    this._graph = graph;
    this._layout = layout;
    this._cache = new Cache();
  }

  /** Getters */

  getNodes = () => {
    this._updateCache('nodes', () =>
      this._graph.getNodes().filter((node) => this.getNodePosition(node))
    );

    return this._cache.get('nodes');
  };

  getEdges = () => {
    this._updateCache('edges', () =>
      this._graph.getEdges().filter((edge) => this.getEdgePosition(edge))
    );

    return this._cache.get('edges');
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

  /**
   * @fires GraphEngine#onNodeUpdated
   */
  _onNodeUpdated = (node) => {
    /**
     * @event GraphEngine#onNodeUpdated
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onNodeUpdated', {node}));
  };

  /** Layout calculations */

  run = () => {
    // TODO: throw if running on a cleared engine

    this._graph.addEventListener('onNodeAdded', this._updateLayout);
    this._graph.addEventListener('onNodeRemoved', this._updateLayout);
    this._graph.addEventListener('onNodeUpdated', this._onNodeUpdated);
    this._graph.addEventListener('onEdgeAdded', this._updateLayout);
    // TODO: Edge removed

    this._layout.addEventListener('onLayoutStart', this._onLayoutStart);
    this._layout.addEventListener('onLayoutChange', this._onLayoutChange);
    this._layout.addEventListener('onLayoutDone', this._onLayoutDone);
    this._layout.addEventListener('onLayoutError', this._onLayoutError);

    this._layout.initializeGraph(this._graph);
    this._layout.start();
  };

  clear = () => {
    this._graph.removeEventListener('onNodeAdded', this._updateLayout);
    this._graph.removeEventListener('onNodeRemoved', this._updateLayout);
    this._graph.removeEventListener('onNodeUpdated', this._onNodeUpdated);
    this._graph.removeEventListener('onEdgeAdded', this._updateLayout);

    this._layout.removeEventListener('onLayoutStart', this._onLayoutStart);
    this._layout.removeEventListener('onLayoutChange', this._onLayoutChange);
    this._layout.removeEventListener('onLayoutDone', this._onLayoutDone);
    this._layout.removeEventListener('onLayoutError', this._onLayoutError);
  };

  resume = () => this._layout.resume();

  stop = () => this._layout.stop();

  _updateLayout = () => {
    this._layout.updateGraph(this._graph);
    this._layout.update();
  };

  _updateCache(key, updateValue) {
    this._cache.set(key, updateValue(), this._graph.version + this._layout.version);
  }
}
