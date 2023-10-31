import {SimpleLayout, LAYOUT_STATE} from '../index';

// Graph engine controls the graph data and layout calculation
export default class GraphEngine extends EventTarget {
  constructor() {
    super();

    // graph data
    this._graph = null;
    // layout algorithm
    this._layout = null;
    // layout state
    this._layoutState = LAYOUT_STATE.INIT;
    // last layout update time stamp
    this._lastUpdate = 0;
  }

  /** Getters */

  getGraph = () => this._graph;

  getLayout = () => this._layout;

  getNodePosition = (node) => this._layout.getNodePosition(node);

  getEdgePosition = (edge) => this._layout.getEdgePosition(edge);

  getLayoutLastUpdate = () => this._lastUpdate;

  getLayoutState = () => this._layoutState;

  /** Operations on the graph */

  lockNodePosition = (node, x, y) => {
    this._layout.lockNodePosition(node, x, y);
  };

  unlockNodePosition = (node) => {
    this._layout.unlockNodePosition(node);
  };

  clear = () => {
    if (this._graph) {
      this._graph.removeEventListener('onNodeAdded', this._updateLayout);
      this._graph.removeEventListener('onNodeRemoved', this._updateLayout);
      this._graph.removeEventListener('onNodeUpdated', this._onNodeUpdated);
    }
    this._graph = null;

    if (this._layout) {
      this._layout.removeEventListener('onLayoutStart', this._onLayoutStart);
      this._layout.removeEventListener('onLayoutChange', this._onLayoutChange);
      this._layout.removeEventListener('onLayoutDone', this._onLayoutDone);
      this._layout.removeEventListener('onLayoutError', this._onLayoutError);
    }
    this._layout = null;

    this._layoutState = LAYOUT_STATE.INIT;
  };

  /**
   * @fires GraphEngine#onLayoutStart
   */
  _onLayoutStart = () => {
    this._layoutState = LAYOUT_STATE.START;

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
    this._lastUpdate = Date.now();
    this._layoutState = LAYOUT_STATE.CALCULATING;

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
    this._layoutState = LAYOUT_STATE.DONE;

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
    this._layoutState = LAYOUT_STATE.ERROR;

    /**
     * @event GraphEngine#onLayoutError
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutError'));
  };

  _onNodeUpdated = (node) => {
    this.dispatchEvent(new CustomEvent('onNodeUpdated', {node}));
  };

  /** Layout calculations */

  run = (graph, layout = new SimpleLayout(), options) => {
    this.clear();

    this._graph = graph;
    this._layout = layout;

    // Nodes
    this._graph.addEventListener('onNodeAdded', () => this._layout.start());
    this._graph.addEventListener('onNodeRemoved', () => this._layout.start());
    this._graph.addEventListener('onNodeUpdated', this._onNodeUpdated);

    // TODO: Edges
    this._graph.addEventListener('onEdgeAdded', () => this._layout.start());

    this._layout.initializeGraph(graph);
    this._layout.addEventListener('onLayoutStart', this._onLayoutStart);
    this._layout.addEventListener('onLayoutChange', this._onLayoutChange);
    this._layout.addEventListener('onLayoutDone', this._onLayoutDone);
    this._layout.addEventListener('onLayoutError', this._onLayoutError);
    this._layout.start();
  };

  resume = () => {
    if (this._layout) {
      this._layout.resume();
    }
  };

  stop = () => {
    if (this._layout) {
      this._layout.stop();
    }
  };

  _updateLayout = () => {
    this._layout?.start();
  };
}
