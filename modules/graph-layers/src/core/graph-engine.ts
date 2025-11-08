// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds2D} from '@math.gl/types';

import type {Graph, EdgeInterface, NodeInterface} from '../graph/graph';
import {LegacyGraph, LegacyGraphLayoutAdapter} from '../graph/legacy-graph';
import type {GraphRuntimeLayout} from './graph-runtime-layout';
import {GraphLayout, type GraphLayoutEventDetail} from './graph-layout';
import {Cache} from './cache';
import {log} from '../utils/log';
import type {GraphStyleEngine, GraphStylesheet} from '../style/graph-style-engine';

type LegacyGraphEngineProps = {
  graph: LegacyGraph;
  layout: GraphLayout;
};

type InterfaceGraphEngineProps = {
  graph: Graph;
  layout: GraphRuntimeLayout;
};

export type GraphEngineProps = LegacyGraphEngineProps | InterfaceGraphEngineProps;

function isLegacyProps(props: GraphEngineProps): props is LegacyGraphEngineProps {
  return props.graph instanceof LegacyGraph;
}

/** Graph engine controls the graph data and layout calculation */
export class GraphEngine extends EventTarget {
  props: Readonly<GraphEngineProps>;

  private readonly _graph: Graph;
  private readonly _layout: GraphRuntimeLayout;
  private readonly _cache = new Cache<'nodes' | 'edges', NodeInterface[] | EdgeInterface[]>();
  private _layoutDirty = false;
  private _transactionInProgress = false;

  constructor(props: GraphEngineProps);
  /** @deprecated Use props constructor: new GraphEngine(props) */
  constructor(graph: LegacyGraph, layout: GraphLayout);

  constructor(props: GraphEngineProps | LegacyGraph, layout?: GraphLayout) {
    super();
    let normalizedProps: GraphEngineProps;
    if (props instanceof LegacyGraph) {
      if (!(layout instanceof GraphLayout)) {
        throw new Error('GraphEngine: legacy graphs require a GraphLayout instance.');
      }
      normalizedProps = {graph: props, layout};
    } else {
      normalizedProps = props;
    }

    this.props = normalizedProps;

    if (isLegacyProps(normalizedProps)) {
      const layoutAdapter = new LegacyGraphLayoutAdapter(normalizedProps.layout);
      this._graph = normalizedProps.graph;
      this._layout = layoutAdapter;
    } else {
      this._graph = normalizedProps.graph;
      this._layout = normalizedProps.layout;
    }
  }

  /** Getters */

  getNodes = (): NodeInterface[] => {
    this._updateCache('nodes', () =>
      Array.from(this._graph.getNodes()).filter((node) => {
        const position = this.getNodePosition(node);
        return position !== null && position !== undefined;
      })
    );

    return (this._cache.get('nodes') as NodeInterface[]) ?? [];
  };

  getEdges = () => {
    this._updateCache('edges', () =>
      Array.from(this._graph.getEdges()).filter((edge) => {
        const layout = this.getEdgePosition(edge);
        return layout !== null && layout !== undefined;
      })
    );

    return (this._cache.get('edges') as EdgeInterface[]) ?? [];
  };

  getNodePosition = (node: NodeInterface) => {
    return this._layout.getNodePosition(node) ?? null;
  };

  getEdgePosition = (edge: EdgeInterface) => {
    return this._layout.getEdgePosition(edge) ?? null;
  };

  getGraphVersion = () => this._graph.version;

  getLayoutLastUpdate = () => this._layout.version;

  getLayoutState = () => this._layout.state;

  getLayoutBounds = (): Bounds2D | null => this._layout.getBounds() ?? null;

  /** Operations on the graph */

  lockNodePosition = (node: NodeInterface, x: number, y: number) => {
    this._layout.lockNodePosition(node, x, y);
  };

  unlockNodePosition = (node: NodeInterface) => {
    this._layout.unlockNodePosition(node);
  };

  findNode(nodeId: string | number): NodeInterface | undefined {
    return this._graph.findNodeById?.(nodeId);
  }

  createStylesheetEngine(
    style: GraphStylesheet,
    options: {stateUpdateTrigger?: unknown} = {}
  ): GraphStyleEngine {
    return this._graph.createStylesheetEngine(style, options);
  }

  /**
   * @fires GraphEngine#onLayoutStart
   */
  _onLayoutStart = (event: Event) => {
    log.log(0, 'GraphEngine: layout start')();
    const detail = event instanceof CustomEvent ? (event.detail as GraphLayoutEventDetail) : undefined;
    /**
     * @event GraphEngine#onLayoutStart
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutStart', {detail}));
  };

  /**
   * @fires GraphEngine#onLayoutChange
   */
  _onLayoutChange = (event: Event) => {
    log.log(0, 'GraphEngine: layout update event')();
    const detail = event instanceof CustomEvent ? (event.detail as GraphLayoutEventDetail) : undefined;
    /**
     * @event GraphEngine#onLayoutChange
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutChange', {detail}));
  };

  /**
   * @fires GraphEngine#onLayoutDone
   */
  _onLayoutDone = (event: Event) => {
    log.log(0, 'GraphEngine: layout end')();
    const detail = event instanceof CustomEvent ? (event.detail as GraphLayoutEventDetail) : undefined;
    /**
     * @event GraphEngine#onLayoutDone
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutDone', {detail}));
  };

  /**
   * @fires GraphEngine#onLayoutError
   */
  _onLayoutError = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    /**
     * @event GraphEngine#onLayoutError
     * @type {CustomEvent}
     */
    this.dispatchEvent(new CustomEvent('onLayoutError', {detail}));
  };

  _onGraphStructureChanged = () => {
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
    log.log(1, 'GraphEngine: run');
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
    log.log(1, 'GraphEngine: end');
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

  resume = () => {
    this._layout.resume();
  };

  stop = () => {
    this._layout.stop();
  };

  _graphChanged = () => {
    if (this._layoutDirty && !this._transactionInProgress) {
      this._updateLayout();
    }
  };

  _updateLayout = () => {
    log.log(0, 'GraphEngine: layout update');
    this._layout.updateGraph(this._graph);
    this._layout.update();
    this._layoutDirty = false;
  };

  _updateCache(key, updateValue) {
    this._cache.set(key, updateValue, this.getGraphVersion() + this.getLayoutLastUpdate());
  }
}
