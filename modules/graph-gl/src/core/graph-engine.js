import {SimpleLayout, LAYOUT_STATE} from '../index';

// Graph engine controls the graph data and layout calculation
export default class GraphEngine {
  constructor() {
    // graph data
    this._graph = null;
    // layout algorithm
    this._layout = null;
    // layout state
    this._layoutState = LAYOUT_STATE.INIT;
    // last layout update time stamp
    this._lastUpdate = 0;
    // event callbacks
    this._callbacks = {
      onLayoutChange: () => {},
      onLayoutDone: () => {},
      onLayoutError: () => {}
    };
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
    if (this._layout) {
      this._layout.unregisterCallbacks();
    }
    this._graph = null;
    this._layout = null;
    this._layoutState = LAYOUT_STATE.INIT;
  };

  /** Event callbacks */

  registerCallbacks = (callbacks) => {
    this._callbacks = callbacks;
  };

  unregisterCallbacks = () => {
    this._callbacks = {};
  };

  _onLayoutChange = () => {
    this._lastUpdate = Date.now();
    this._layoutState = LAYOUT_STATE.CALCULATING;
    if (this._callbacks.onLayoutChange) {
      this._callbacks.onLayoutChange();
    }
  };

  _onLayoutDone = () => {
    this._layoutState = LAYOUT_STATE.DONE;
    if (this._callbacks.onLayoutDone) {
      this._callbacks.onLayoutDone();
    }
  };

  _onLayoutError = () => {
    this._layoutState = LAYOUT_STATE.ERROR;
    if (this._callbacks.onLayoutError) {
      this._callbacks.onLayoutError();
    }
  };

  /** Layout calculations */

  run = (graph, layout = new SimpleLayout(), options) => {
    this.clear();
    this._graph = graph;
    this._layout = layout;
    this._layout.initializeGraph(graph);
    this._layout.registerCallbacks({
      onLayoutChange: this._onLayoutChange,
      onLayoutDone: this._onLayoutDone,
      onLayoutError: this._onLayoutError
    });
    this._layout.start();
    this._layoutState = LAYOUT_STATE.START;
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
}
