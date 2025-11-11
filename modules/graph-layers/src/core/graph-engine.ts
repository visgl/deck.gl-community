// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds2D} from '@math.gl/types';

import type {Graph, EdgeInterface, NodeInterface} from '../graph/graph';
import {ClassicGraph, ClassicGraphLayoutAdapter} from '../graph/classic-graph';
import type {GraphRuntimeLayout} from './graph-runtime-layout';
import {GraphLayout, type GraphLayoutEventDetail, type GraphEdgeLayout} from './graph-layout';
import {Cache} from './cache';
import {log} from '../utils/log';
import {GraphStylesheetEngine, type GraphStylesheet} from '../style/graph-style-engine';

type ClassicGraphEngineProps = {
  graph: ClassicGraph;
  layout: GraphLayout;
  onLayoutStart?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutChange?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutDone?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutError?: (error?: unknown) => void;
  onTransactionStart?: () => void;
  onTransactionEnd?: () => void;
  onNodeAdded?: (node: NodeInterface) => void;
  onNodeRemoved?: (node: NodeInterface) => void;
  onNodeUpdated?: (node: NodeInterface) => void;
  onEdgeAdded?: (edge: EdgeInterface) => void;
  onEdgeRemoved?: (edge: EdgeInterface) => void;
  onEdgeUpdated?: (edge: EdgeInterface) => void;
};

type InterfaceGraphEngineProps = {
  graph: Graph;
  layout: GraphRuntimeLayout;
  onLayoutStart?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutChange?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutDone?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutError?: (error?: unknown) => void;
  onTransactionStart?: () => void;
  onTransactionEnd?: () => void;
  onNodeAdded?: (node: NodeInterface) => void;
  onNodeRemoved?: (node: NodeInterface) => void;
  onNodeUpdated?: (node: NodeInterface) => void;
  onEdgeAdded?: (edge: EdgeInterface) => void;
  onEdgeRemoved?: (edge: EdgeInterface) => void;
  onEdgeUpdated?: (edge: EdgeInterface) => void;
};

export type GraphEngineProps = ClassicGraphEngineProps | InterfaceGraphEngineProps;

function isClassicProps(props: GraphEngineProps): props is ClassicGraphEngineProps {
  return props.graph instanceof ClassicGraph;
}

/** Graph engine controls the graph data and layout calculation */
export class GraphEngine {
  private _props: GraphEngineProps;
  private readonly _graph: Graph;
  private readonly _layout: GraphRuntimeLayout;
  private readonly _cache = new Cache<'nodes' | 'edges', NodeInterface[] | EdgeInterface[]>();
  private _layoutDirty = false;
  private _transactionInProgress = false;
  private _graphCallbacksAttached = false;
  private _layoutCallbacksAttached = false;

  constructor(props: GraphEngineProps);
  /** @deprecated Use props constructor: new GraphEngine(props) */
  constructor(graph: ClassicGraph, layout: GraphLayout);

  constructor(props: GraphEngineProps | ClassicGraph, layout?: GraphLayout) {
    let normalizedProps: GraphEngineProps;
    if (props instanceof ClassicGraph) {
      if (!(layout instanceof GraphLayout)) {
        throw new Error('GraphEngine: legacy graphs require a GraphLayout instance.');
      }
      normalizedProps = {graph: props, layout};
    } else {
      normalizedProps = props;
    }

    this._props = {...normalizedProps};

    if (isClassicProps(normalizedProps)) {
      const layoutAdapter = new ClassicGraphLayoutAdapter(normalizedProps.layout);
      this._graph = normalizedProps.graph;
      this._layout = layoutAdapter;
    } else {
      this._graph = normalizedProps.graph;
      this._layout = normalizedProps.layout;
    }
  }

  get props(): GraphEngineProps {
    return {...this._props};
  }

  setProps(props: Partial<Omit<GraphEngineProps, 'graph' | 'layout'>>): void {
    this._props = {
      ...this._props,
      ...props,
      graph: this._props.graph,
      layout: this._props.layout
    } as GraphEngineProps;
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

  getNodePosition = (node: NodeInterface): [number, number] | null => {
    return this._layout.getNodePosition(node) ?? null;
  };

  getEdgePosition = (edge: EdgeInterface): GraphEdgeLayout | null => {
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
  ): GraphStylesheetEngine {
    return new GraphStylesheetEngine(style, options);
  }

  /**
   * @fires GraphEngine#onLayoutStart
   */
  _onLayoutStart = (detail?: GraphLayoutEventDetail) => {
    log.log(0, 'GraphEngine: layout start')();
    this._props.onLayoutStart?.(detail);
  };

  /**
   * @fires GraphEngine#onLayoutChange
   */
  _onLayoutChange = (detail?: GraphLayoutEventDetail) => {
    log.log(0, 'GraphEngine: layout update event')();
    this._props.onLayoutChange?.(detail);
  };

  /**
   * @fires GraphEngine#onLayoutDone
   */
  _onLayoutDone = (detail?: GraphLayoutEventDetail) => {
    log.log(0, 'GraphEngine: layout end')();
    this._props.onLayoutDone?.(detail);
  };

  /**
   * @fires GraphEngine#onLayoutError
   */
  _onLayoutError = (error?: unknown) => {
    this._props.onLayoutError?.(error);
  };

  _onGraphStructureChanged = () => {
    this._layoutDirty = true;
    this._graphChanged();
  };

  _onTransactionStart = () => {
    this._transactionInProgress = true;
    this._props.onTransactionStart?.();
  };

  _onTransactionEnd = () => {
    this._transactionInProgress = false;
    this._graphChanged();
    this._props.onTransactionEnd?.();
  };

  /** Layout calculations */

  run = () => {
    log.log(1, 'GraphEngine: run');
    // TODO: throw if running on a cleared engine

    this._attachGraphCallbacks();
    this._attachLayoutCallbacks();

    this._layout.initializeGraph(this._graph);
    this._layout.start();
  };

  clear = () => {
    log.log(1, 'GraphEngine: end');
    this._detachGraphCallbacks();
    this._detachLayoutCallbacks();
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

  private _attachGraphCallbacks() {
    if (this._graphCallbacksAttached) {
      return;
    }
    this._graph.updateProps({
      onTransactionStart: this._onTransactionStart,
      onTransactionEnd: this._onTransactionEnd,
      onNodeAdded: (node) => {
        this._onGraphStructureChanged();
        this._props.onNodeAdded?.(node);
      },
      onNodeRemoved: (node) => {
        this._onGraphStructureChanged();
        this._props.onNodeRemoved?.(node);
      },
      onNodeUpdated: (node) => {
        this._props.onNodeUpdated?.(node);
      },
      onEdgeAdded: (edge) => {
        this._onGraphStructureChanged();
        this._props.onEdgeAdded?.(edge);
      },
      onEdgeRemoved: (edge) => {
        this._onGraphStructureChanged();
        this._props.onEdgeRemoved?.(edge);
      },
      onEdgeUpdated: (edge) => {
        this._props.onEdgeUpdated?.(edge);
      }
    });
    this._graphCallbacksAttached = true;
  }

  private _detachGraphCallbacks() {
    if (!this._graphCallbacksAttached) {
      return;
    }
    this._graph.updateProps({
      onTransactionStart: undefined,
      onTransactionEnd: undefined,
      onNodeAdded: undefined,
      onNodeRemoved: undefined,
      onNodeUpdated: undefined,
      onEdgeAdded: undefined,
      onEdgeRemoved: undefined,
      onEdgeUpdated: undefined
    });
    this._graphCallbacksAttached = false;
  }

  private _attachLayoutCallbacks() {
    if (this._layoutCallbacksAttached) {
      return;
    }
    this._layout.setProps({
      onLayoutStart: this._onLayoutStart,
      onLayoutChange: this._onLayoutChange,
      onLayoutDone: this._onLayoutDone,
      onLayoutError: this._onLayoutError
    });
    this._layoutCallbacksAttached = true;
  }

  private _detachLayoutCallbacks() {
    if (!this._layoutCallbacksAttached) {
      return;
    }
    this._layout.setProps({
      onLayoutStart: undefined,
      onLayoutChange: undefined,
      onLayoutDone: undefined,
      onLayoutError: undefined
    });
    this._layoutCallbacksAttached = false;
  }
}
