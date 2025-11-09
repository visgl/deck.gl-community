// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds2D} from '@math.gl/types';

import type {Graph, EdgeInterface, NodeInterface, GraphProps} from '../graph/graph';
import {LegacyGraph, LegacyGraphLayoutAdapter} from '../graph/legacy-graph';
import type {GraphRuntimeLayout} from './graph-runtime-layout';
import {GraphLayout, type GraphLayoutCallbacks, type GraphLayoutEventDetail} from './graph-layout';
import {Cache} from './cache';
import {log} from '../utils/log';
import type {GraphStyleEngine, GraphStylesheet} from '../style/graph-style-engine';

type LegacyGraphEngineProps = {
  graph: LegacyGraph;
  layout: GraphLayout;
  callbacks?: GraphProps;
};

type InterfaceGraphEngineProps = {
  graph: Graph;
  layout: GraphRuntimeLayout;
  callbacks?: GraphProps;
};

export type GraphEngineProps = LegacyGraphEngineProps | InterfaceGraphEngineProps;

function isLegacyProps(props: GraphEngineProps): props is LegacyGraphEngineProps {
  return props.graph instanceof LegacyGraph;
}

/** Graph engine controls the graph data and layout calculation */
export class GraphEngine {
  private _props: GraphEngineProps;
  private readonly _graph: Graph;
  private readonly _layout: GraphRuntimeLayout;
  private readonly _cache = new Cache<'nodes' | 'edges', NodeInterface[] | EdgeInterface[]>();
  private _layoutDirty = false;
  private _transactionInProgress = false;
  private _graphPreviousProps: GraphProps | null = null;
  private _layoutPreviousCallbacks: GraphLayoutCallbacks | null = null;
  private _callbacks: GraphProps;

  constructor(props: GraphEngineProps);
  /** @deprecated Use props constructor: new GraphEngine(props) */
  constructor(graph: LegacyGraph, layout: GraphLayout);

  constructor(props: GraphEngineProps | LegacyGraph, layout?: GraphLayout) {
    let normalizedProps: GraphEngineProps;
    if (props instanceof LegacyGraph) {
      if (!(layout instanceof GraphLayout)) {
        throw new Error('GraphEngine: legacy graphs require a GraphLayout instance.');
      }
      normalizedProps = {graph: props, layout};
    } else {
      normalizedProps = props;
    }

    this._callbacks = {...(normalizedProps.callbacks ?? {})};
    this._props = {...normalizedProps, callbacks: {...this._callbacks}};

    if (isLegacyProps(normalizedProps)) {
      const layoutAdapter = new LegacyGraphLayoutAdapter(normalizedProps.layout);
      this._graph = normalizedProps.graph;
      this._layout = layoutAdapter;
    } else {
      this._graph = normalizedProps.graph;
      this._layout = normalizedProps.layout;
    }
  }

  get props(): GraphEngineProps {
    return {...this._props, callbacks: {...this._callbacks}} as GraphEngineProps;
  }

  setProps(props: Partial<Pick<GraphEngineProps, 'callbacks'>>): void {
    if ('callbacks' in props) {
      this._callbacks = {...(props.callbacks ?? {})};
    }

    this._props = {
      ...this._props,
      ...props,
      callbacks: {...this._callbacks}
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
  _onLayoutStart = (detail?: GraphLayoutEventDetail) => {
    log.log(0, 'GraphEngine: layout start')();
    const {onLayoutStart} = this._callbacks;
    onLayoutStart?.(detail);

    const graphCallback = this._graph.props.onLayoutStart;
    graphCallback?.(detail);
  };

  /**
   * @fires GraphEngine#onLayoutChange
   */
  _onLayoutChange = (detail?: GraphLayoutEventDetail) => {
    log.log(0, 'GraphEngine: layout update event')();
    const {onLayoutChange} = this._callbacks;
    onLayoutChange?.(detail);

    const graphCallback = this._graph.props.onLayoutChange;
    graphCallback?.(detail);
  };

  /**
   * @fires GraphEngine#onLayoutDone
   */
  _onLayoutDone = (detail?: GraphLayoutEventDetail) => {
    log.log(0, 'GraphEngine: layout end')();
    const {onLayoutDone} = this._callbacks;
    onLayoutDone?.(detail);

    const graphCallback = this._graph.props.onLayoutDone;
    graphCallback?.(detail);
  };

  /**
   * @fires GraphEngine#onLayoutError
   */
  _onLayoutError = (error?: unknown) => {
    const {onLayoutError} = this._callbacks;
    onLayoutError?.(error);

    const graphCallback = this._graph.props.onLayoutError;
    graphCallback?.(error);
  };

  _onGraphStructureChanged = () => {
    this._layoutDirty = true;
    this._graphChanged();
  };

  _onTransactionStart = () => {
    this._transactionInProgress = true;
    const {onTransactionStart} = this._callbacks;
    onTransactionStart?.();
  };

  _onTransactionEnd = () => {
    this._transactionInProgress = false;
    this._graphChanged();
    const {onTransactionEnd} = this._callbacks;
    onTransactionEnd?.();
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
    if (this._graphPreviousProps) {
      return;
    }
    const previous = this._graph.props;
    const wrap = <K extends keyof GraphProps>(
      key: K,
      handler?: GraphProps[K]
    ): GraphProps[K] | undefined => {
      const prior = previous[key];
      if (!handler) {
        return prior;
      }
      if (!prior) {
        return handler;
      }
      return ((...args: Parameters<NonNullable<GraphProps[K]>>) => {
        (handler as (...handlerArgs: unknown[]) => void)(...args);
        (prior as (...priorArgs: unknown[]) => void)(...args);
      }) as GraphProps[K];
    };

    const nextProps: GraphProps = {
      ...previous,
      onTransactionStart: wrap('onTransactionStart', () => this._onTransactionStart()),
      onTransactionEnd: wrap('onTransactionEnd', () => this._onTransactionEnd()),
      onNodeAdded: wrap('onNodeAdded', (node) => {
        this._onGraphStructureChanged();
        const {onNodeAdded} = this._callbacks;
        onNodeAdded?.(node);
      }),
      onNodeRemoved: wrap('onNodeRemoved', (node) => {
        this._onGraphStructureChanged();
        const {onNodeRemoved} = this._callbacks;
        onNodeRemoved?.(node);
      }),
      onNodeUpdated: wrap('onNodeUpdated', (node) => {
        const {onNodeUpdated} = this._callbacks;
        onNodeUpdated?.(node);
      }),
      onEdgeAdded: wrap('onEdgeAdded', (edge) => {
        this._onGraphStructureChanged();
        const {onEdgeAdded} = this._callbacks;
        onEdgeAdded?.(edge);
      }),
      onEdgeRemoved: wrap('onEdgeRemoved', (edge) => {
        this._onGraphStructureChanged();
        const {onEdgeRemoved} = this._callbacks;
        onEdgeRemoved?.(edge);
      }),
      onEdgeUpdated: wrap('onEdgeUpdated', (edge) => {
        const {onEdgeUpdated} = this._callbacks;
        onEdgeUpdated?.(edge);
      })
    };

    this._graph.setProps(nextProps);
    this._graphPreviousProps = previous;
  }

  private _detachGraphCallbacks() {
    if (!this._graphPreviousProps) {
      return;
    }
    this._graph.setProps(this._graphPreviousProps);
    this._graphPreviousProps = null;
  }

  private _attachLayoutCallbacks() {
    if (this._layoutPreviousCallbacks) {
      return;
    }
    const previous = this._layout.getCallbacks();
    this._layout.setCallbacks({
      onLayoutStart: (detail) => {
        this._onLayoutStart(detail);
        previous.onLayoutStart?.(detail);
      },
      onLayoutChange: (detail) => {
        this._onLayoutChange(detail);
        previous.onLayoutChange?.(detail);
      },
      onLayoutDone: (detail) => {
        this._onLayoutDone(detail);
        previous.onLayoutDone?.(detail);
      },
      onLayoutError: (error) => {
        this._onLayoutError(error);
        previous.onLayoutError?.(error);
      }
    });
    this._layoutPreviousCallbacks = previous;
  }

  private _detachLayoutCallbacks() {
    if (!this._layoutPreviousCallbacks) {
      this._layout.setCallbacks({});
      return;
    }
    this._layout.setCallbacks(this._layoutPreviousCallbacks);
    this._layoutPreviousCallbacks = null;
  }
}
