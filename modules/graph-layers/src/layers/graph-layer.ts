// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-continue */

import type {CompositeLayerProps} from '@deck.gl/core';
import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';

import type {Graph, NodeInterface} from '../graph/graph';
import {ClassicGraph} from '../graph/classic-graph';
import {createGraphFromData} from '../graph/create-graph-from-data';
import {GraphLayout, type GraphLayoutEventDetail} from '../core/graph-layout';
import type {GraphRuntimeLayout} from '../core/graph-runtime-layout';
import {GraphEngine} from '../core/graph-engine';
import {isGraphData, type GraphData} from '../graph-data/graph-data';
import {isArrowGraphData, type ArrowGraphData} from '../graph-data/arrow-graph-data';

import {
  GraphStylesheetEngine,
  type GraphStylesheet
} from '../style/graph-style-engine';
import {mixedGetPosition} from '../utils/layer-utils';
import {InteractionManager} from '../core/interaction-manager';
import {buildCollapsedChainLayers} from '../utils/collapsed-chains';
import {
  mapRanksToYPositions,
  selectRankLines,
  type LabelAccessor,
  type RankAccessor
} from '../utils/rank-grid';

import {log, warn} from '../utils/log';

import {
  DEFAULT_GRAPH_LAYER_STYLESHEET,
  normalizeGraphLayerStylesheet,
  type GraphLayerEdgeStyle,
  type GraphLayerNodeStyle,
  type GraphLayerStylesheet,
  type NormalizedGraphLayerStylesheet
} from '../style/graph-layer-stylesheet';

// node layers
import {CircleLayer} from './node-layers/circle-layer';
import {ImageLayer} from './node-layers/image-layer';
import {LabelLayer} from './node-layers/label-layer';
import {RectangleLayer} from './node-layers/rectangle-layer';
import {RoundedRectangleLayer} from './node-layers/rounded-rectangle-layer';
import {PathBasedRoundedRectangleLayer} from './node-layers/path-rounded-rectangle-layer';
import {ZoomableMarkerLayer} from './node-layers/zoomable-marker-layer';

// edge layers
import {EdgeLayer} from './edge-layer';
import {EdgeLabelLayer} from './edge-layers/edge-label-layer';
import {FlowLayer} from './edge-layers/flow-layer';
import {EdgeArrowLayer} from './edge-layers/edge-arrow-layer';
import {EdgeAttachmentHelper} from './edge-attachment-helper';
import {GridLayer, type GridLayerProps} from './common-layers/grid-layer/grid-layer';

import {JSONTabularGraphLoader} from '../loaders/json-loader';
import {isGraphRuntimeLayout} from '../core/graph-runtime-layout';

const NODE_LAYER_MAP = {
  'rectangle': RectangleLayer,
  'rounded-rectangle': RoundedRectangleLayer,
  'path-rounded-rectangle': PathBasedRoundedRectangleLayer,
  'icon': ImageLayer,
  'circle': CircleLayer,
  'label': LabelLayer,
  'marker': ZoomableMarkerLayer
};

const EDGE_DECORATOR_LAYER_MAP = {
  'edge-label': EdgeLabelLayer,
  'flow': FlowLayer,
  'arrow': EdgeArrowLayer
};

type GridLayerOverrides = Partial<Omit<GridLayerProps, 'id' | 'data' | 'direction'>>;

export type RankGridConfig = {
  enabled?: boolean;
  direction?: 'horizontal' | 'vertical';
  maxLines?: number;
  rankAccessor?: RankAccessor;
  labelAccessor?: LabelAccessor;
  gridProps?: GridLayerOverrides;
};

const SHARED_LAYER_PROPS = {
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  parameters: {
    depthTest: false
  }
};

const NODE_STYLE_DEPRECATION_MESSAGE =
  'GraphLayer: `nodeStyle` has been replaced by `stylesheet.nodes` and will be removed in a future release.';
const EDGE_STYLE_DEPRECATION_MESSAGE =
  'GraphLayer: `edgeStyle` has been replaced by `stylesheet.edges` and will be removed in a future release.';

const GRAPH_PROP_DEPRECATION_MESSAGE =
  'GraphLayer: `graph` prop is deprecated. Pass graphs via the `data` prop instead.';
const LAYOUT_REQUIRED_MESSAGE =
  'GraphLayer: `layout` must be provided when supplying raw graph data.';

let NODE_STYLE_DEPRECATION_WARNED = false;
let EDGE_STYLE_DEPRECATION_WARNED = false;

export type GraphLayerRawData = {
  name?: string;
  nodes?: unknown[] | null;
  edges?: unknown[] | null;
};

export type GraphLayerDataInput =
  | GraphEngine
  | Graph
  | GraphData
  | ArrowGraphData
  | GraphLayerRawData
  | unknown[]
  | string
  | null;

type GraphLayerLoaderResult = Graph | GraphData | ArrowGraphData | null;

export type GraphLayerProps = CompositeLayerProps &
  _GraphLayerProps & {
    data?: GraphLayerDataInput | Promise<GraphLayerDataInput>;
  };

type EngineResolutionFlags = {
  force: boolean;
  dataChanged: boolean;
  layoutChanged: boolean;
  graphChanged: boolean;
  engineChanged: boolean;
  loaderChanged: boolean;
};

export type _GraphLayerProps = {
  graph?: Graph;
  layout?: GraphLayout | GraphRuntimeLayout;
  graphLoader?: (opts: {json: unknown}) => GraphLayerLoaderResult;
  engine?: GraphEngine;

  onLayoutStart?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutChange?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutDone?: (detail?: GraphLayoutEventDetail) => void;
  onLayoutError?: (error?: unknown) => void;

  stylesheet?: GraphLayerStylesheet;
  /** @deprecated Use `stylesheet.nodes`. */
  nodeStyle?: GraphLayerNodeStyle[];
  /** @deprecated Use `stylesheet.edges`. */
  edgeStyle?: GraphLayerEdgeStyle | GraphLayerEdgeStyle[];
  nodeEvents?: {
    onMouseLeave?: () => void;
    onHover?: () => void;
    onMouseEnter?: () => void;
    onClick?: () => void;
    onDrag?: () => void;
  };
  edgeEvents?: {
    onClick: () => void;
    onHover: () => void;
  };
  enableDragging?: boolean;
  rankGrid?: boolean | RankGridConfig;
  resumeLayoutAfterDragging?: boolean;
};

/** Composite layer that renders graph nodes, edges, and decorators. */
export class GraphLayer extends CompositeLayer<GraphLayerProps> {
  static layerName = 'GraphLayer';

  static defaultProps: Required<_GraphLayerProps> & {
    data: {type: string; value: null; async: true};
  } = {
    // Composite layer props
    // @ts-expect-error composite layer props
    pickable: true,
    data: {type: 'object', value: null, async: true},

    // Graph props
    graphLoader: JSONTabularGraphLoader,

    stylesheet: DEFAULT_GRAPH_LAYER_STYLESHEET,
    nodeStyle: undefined as unknown as GraphLayerNodeStyle[],
    nodeEvents: {
      onMouseLeave: () => {},
      onHover: () => {},
      onMouseEnter: () => {},
      onClick: () => {},
      onDrag: () => {}
    },
    edgeStyle: undefined as unknown as GraphLayerEdgeStyle | GraphLayerEdgeStyle[],
    edgeEvents: {
      onClick: () => {},
      onHover: () => {}
    },
    enableDragging: false,
    rankGrid: false,
    resumeLayoutAfterDragging: true
  };

  // @ts-expect-error Some typescript confusion due to override of base class state
  state!: CompositeLayer<GraphLayerProps>['state'] & {
    interactionManager: InteractionManager;
    graphEngine?: GraphEngine | null;
    layoutVersion: number;
    layoutState?: string;
    interactionVersion: number;
  };

  private readonly _edgeAttachmentHelper = new EdgeAttachmentHelper();
  private _suppressNextDeckDataChange = false;

  forceUpdate = () => {
    if (!this.state) {
      return;
    }

    this.setNeedsRedraw();
    this.setState({interactionVersion: this.state.interactionVersion + 1});
  };

  constructor(props: GraphLayerProps & CompositeLayerProps) {
    super(props);
  }

  initializeState() {
    const interactionManager = new InteractionManager(
      {
        nodeEvents: this.props.nodeEvents,
        edgeEvents: this.props.edgeEvents,
        engine: undefined as any,
        enableDragging: Boolean(this.props.enableDragging),
        resumeLayoutAfterDragging: Boolean(
          this.props.resumeLayoutAfterDragging ?? GraphLayer.defaultProps.resumeLayoutAfterDragging
        )
      },
      () => this.forceUpdate()
    );

    this.state = {
      interactionManager,
      graphEngine: null,
      layoutVersion: 0,
      layoutState: undefined,
      interactionVersion: 0
    } as typeof this.state;

    this._syncInteractionManager(this.props, null);
    this._refreshEngineFromProps(this.props, {force: true});
  }

  shouldUpdateState({changeFlags}) {
    return changeFlags.dataChanged || changeFlags.propsChanged || changeFlags.stateChanged;
  }

  updateState({props, oldProps, changeFlags}) {
    const propsDataChanged = props.data !== oldProps.data;
    const deckDataChanged =
      changeFlags.dataChanged && !(this._suppressNextDeckDataChange && !propsDataChanged);
    const dataChanged = deckDataChanged || propsDataChanged;
    const layoutChanged = props.layout !== oldProps.layout;
    const graphChanged = props.graph !== oldProps.graph;
    const engineChanged = props.engine !== oldProps.engine;
    const loaderChanged = props.graphLoader !== oldProps.graphLoader;

    const engineRefreshed = this._refreshEngineFromProps(props, {
      dataChanged,
      layoutChanged,
      graphChanged,
      engineChanged,
      loaderChanged
    });

    if (!engineRefreshed && changeFlags.propsChanged) {
      const engine = this.state.graphEngine;
      if (engine) {
        this._applyGraphEngineCallbacks(engine);
      }
    }

    if (!engineRefreshed && (changeFlags.propsChanged || changeFlags.stateChanged)) {
      this._syncInteractionManager(props, this.state.graphEngine ?? null);
    }

    this._suppressNextDeckDataChange = false;
  }

  finalize() {
    this._removeGraphEngine();
    this._syncInteractionManager(this.props, null);
  }

  private _getResolvedStylesheet(): NormalizedGraphLayerStylesheet {
    const {stylesheet, nodeStyle, edgeStyle} = this.props;

    const usingNodeStyle = typeof nodeStyle !== 'undefined';
    if (usingNodeStyle && !NODE_STYLE_DEPRECATION_WARNED) {
      warn(NODE_STYLE_DEPRECATION_MESSAGE);
      NODE_STYLE_DEPRECATION_WARNED = true;
    }

    const usingEdgeStyle = typeof edgeStyle !== 'undefined';
    if (usingEdgeStyle && !EDGE_STYLE_DEPRECATION_WARNED) {
      warn(EDGE_STYLE_DEPRECATION_MESSAGE);
      EDGE_STYLE_DEPRECATION_WARNED = true;
    }

    return normalizeGraphLayerStylesheet({
      stylesheet,
      nodeStyle: usingNodeStyle ? nodeStyle : undefined,
      edgeStyle: usingEdgeStyle ? edgeStyle : undefined
    });
  }

  private _createStylesheetEngine(
    style: GraphStylesheet,
    context: string
  ): GraphStylesheetEngine | null {
    try {
      return new GraphStylesheetEngine(style, {
        stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`GraphLayer: Failed to apply ${context}: ${message}`);
      return null;
    }
  }

  private _refreshEngineFromProps(
    props: GraphLayerProps,
    {
      force = false,
      dataChanged = false,
      layoutChanged = false,
      graphChanged = false,
      engineChanged = false,
      loaderChanged = false
    }: {
      force?: boolean;
      dataChanged?: boolean;
      layoutChanged?: boolean;
      graphChanged?: boolean;
      engineChanged?: boolean;
      loaderChanged?: boolean;
    }
  ): boolean {
    const {engine: nextEngine, shouldReplace} = this._resolveEngineCandidate(props, {
      force,
      dataChanged,
      layoutChanged,
      graphChanged,
      engineChanged,
      loaderChanged
    });

    if (nextEngine === undefined) {
      return false;
    }

    const currentEngine = this.state.graphEngine ?? null;
    if (!shouldReplace && nextEngine === currentEngine) {
      return false;
    }

    this._setGraphEngine(nextEngine);
    this._syncInteractionManager(props, nextEngine);
    return true;
  }

  private _resolveEngineCandidate(
    props: GraphLayerProps,
    flags: EngineResolutionFlags
  ): {engine: GraphEngine | null | undefined; shouldReplace: boolean} {
    const dataResult = this._getEngineFromData(props, flags);
    if (dataResult) {
      return dataResult;
    }

    const engineResult = this._getEngineFromEngineProp(props, flags);
    if (engineResult) {
      return engineResult;
    }

    const graphResult = this._getEngineFromGraphProp(props, flags);
    if (graphResult) {
      return graphResult;
    }

    if (props.data === null || props.graph === null || props.engine === null || flags.force) {
      return {engine: null, shouldReplace: true};
    }

    return {engine: undefined, shouldReplace: flags.force};
  }

  private _getEngineFromData(
    props: GraphLayerProps,
    {force, dataChanged, layoutChanged, loaderChanged}: EngineResolutionFlags
  ): {engine: GraphEngine | null | undefined; shouldReplace: boolean} | null {
    const dataValue = props.data as GraphLayerDataInput | null | undefined;
    if (dataValue === null || typeof dataValue === 'undefined') {
      return null;
    }

    const shouldRebuild = force || dataChanged || layoutChanged || loaderChanged;
    if (!shouldRebuild) {
      return {engine: undefined, shouldReplace: false};
    }

    const engine = this._deriveEngineFromData(dataValue, props);
    if (typeof engine === 'undefined') {
      return {engine: undefined, shouldReplace: false};
    }

    return {
      engine,
      shouldReplace: true
    };
  }

  private _getEngineFromEngineProp(
    props: GraphLayerProps,
    {force, engineChanged}: EngineResolutionFlags
  ): {engine: GraphEngine | null | undefined; shouldReplace: boolean} | null {
    if (typeof props.engine === 'undefined') {
      return null;
    }

    if (props.engine === null) {
      return {engine: null, shouldReplace: true};
    }

    return {
      engine: props.engine,
      shouldReplace: force || engineChanged
    };
  }

  private _getEngineFromGraphProp(
    props: GraphLayerProps,
    {force, graphChanged, layoutChanged}: EngineResolutionFlags
  ): {engine: GraphEngine | null | undefined; shouldReplace: boolean} | null {
    if (typeof props.graph === 'undefined') {
      return null;
    }

    if (props.graph === null) {
      return {engine: null, shouldReplace: true};
    }

    log.warn(GRAPH_PROP_DEPRECATION_MESSAGE)();
    return {
      engine: this._buildEngineFromGraph(props.graph, props.layout),
      shouldReplace: force || graphChanged || layoutChanged
    };
  }

  private _deriveEngineFromData(
    data: GraphLayerDataInput,
    props: GraphLayerProps
  ): GraphEngine | null | undefined {
    const immediate = this._getImmediateEngineResult(data, props);
    if (typeof immediate !== 'undefined') {
      return immediate;
    }

    if (typeof data === 'string') {
      return undefined;
    }

    if (Array.isArray(data) || this._isPlainObject(data)) {
      return this._loadEngineFromJsonLike(data as unknown[] | GraphLayerRawData, props);
    }

    return null;
  }

  private _getImmediateEngineResult(
    data: GraphLayerDataInput,
    props: GraphLayerProps
  ): GraphEngine | null | undefined {
    if (data === null || typeof data === 'undefined') {
      return null;
    }

    if (data instanceof GraphEngine) {
      return data;
    }

    const graph = this._coerceGraph(data);
    if (graph) {
      return this._buildEngineFromGraph(graph, props.layout);
    }

    if (isGraphData(data) || isArrowGraphData(data)) {
      return this._buildEngineFromGraph(createGraphFromData(data), props.layout);
    }

    return undefined;
  }

  private _loadEngineFromJsonLike(
    data: GraphLayerRawData | unknown[],
    props: GraphLayerProps
  ): GraphEngine | null {
    const loader = props.graphLoader ?? GraphLayer.defaultProps.graphLoader;
    const loaded = loader({json: data});
    if (!loaded) {
      return null;
    }

    const graph =
      this._coerceGraph(loaded) ||
      (isGraphData(loaded) || isArrowGraphData(loaded) ? createGraphFromData(loaded) : null);
    if (!graph) {
      return null;
    }

    return this._buildEngineFromGraph(graph, props.layout);
  }

  private _buildEngineFromGraph(
    graph: Graph | null,
    layout?: (GraphLayout | GraphRuntimeLayout) | null
  ): GraphEngine | null {
    if (!graph) {
      return null;
    }

    if (!layout) {
      log.warn(LAYOUT_REQUIRED_MESSAGE)();
      return null;
    }

    if (graph instanceof ClassicGraph && layout instanceof GraphLayout) {
      return new GraphEngine({graph, layout});
    }

    if (layout instanceof GraphLayout && !(graph instanceof ClassicGraph)) {
      const legacyGraph = this._convertToClassicGraph(graph);
      if (legacyGraph) {
        return new GraphEngine({graph: legacyGraph, layout});
      }
      log.warn(LAYOUT_REQUIRED_MESSAGE)();
      return null;
    }

    if (isGraphRuntimeLayout(layout)) {
      return new GraphEngine({graph, layout});
    }

    log.warn(LAYOUT_REQUIRED_MESSAGE)();
    return null;
  }

  private _syncInteractionManager(props: GraphLayerProps, engine: GraphEngine | null) {
    const resumeLayoutAfterDragging =
      props.resumeLayoutAfterDragging ?? GraphLayer.defaultProps.resumeLayoutAfterDragging;

    this.state.interactionManager.updateProps({
      nodeEvents: props.nodeEvents ?? GraphLayer.defaultProps.nodeEvents,
      edgeEvents: props.edgeEvents ?? GraphLayer.defaultProps.edgeEvents,
      engine: (engine ?? props.engine ?? null) as any,
      enableDragging: Boolean(props.enableDragging),
      resumeLayoutAfterDragging: Boolean(resumeLayoutAfterDragging)
    });
  }

  private _isGraph(value: unknown): value is Graph {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Graph;
    return (
      typeof candidate.getNodes === 'function' && typeof candidate.getEdges === 'function'
    );
  }

  private _coerceGraph(value: unknown): Graph | null {
    if (value instanceof ClassicGraph) {
      return value;
    }

    if (this._isGraph(value)) {
      return value;
    }

    return null;
  }

  private _convertToClassicGraph(graph: Graph): ClassicGraph | null {
    if (graph instanceof ClassicGraph) {
      return graph;
    }

    const candidate = graph as Graph & {toClassicGraph?: () => ClassicGraph | null};
    if (typeof candidate.toClassicGraph === 'function') {
      try {
        return candidate.toClassicGraph() ?? null;
      } catch (error) {
        warn('GraphLayer: failed to convert graph to ClassicGraph for layout compatibility.', error);
      }
    }

    return null;
  }

  private _isPlainObject(value: unknown): value is Record<string | number | symbol, unknown> {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private _updateLayoutSnapshot(engine?: GraphEngine | null) {
    const activeEngine = engine ?? this.state.graphEngine ?? null;

    if (!activeEngine) {
      if (this.state.layoutVersion !== 0 || typeof this.state.layoutState !== 'undefined') {
        this._suppressNextDeckDataChange = true;
        this.setState({layoutVersion: 0, layoutState: undefined});
      }
      this.setNeedsRedraw();
      return;
    }

    const nextVersion = activeEngine.getLayoutLastUpdate();
    const nextState = activeEngine.getLayoutState();

    if (this.state.layoutVersion !== nextVersion || this.state.layoutState !== nextState) {
      this._suppressNextDeckDataChange = true;
      this.setState({layoutVersion: nextVersion, layoutState: nextState});
    }

    this.setNeedsRedraw();
  }

  private _handleLayoutEvent = () => {
    this._updateLayoutSnapshot();
  };

  _setGraphEngine(graphEngine: GraphEngine | null) {
    if (graphEngine === this.state.graphEngine) {
      if (graphEngine) {
        this._applyGraphEngineCallbacks(graphEngine);
      }
      this._updateLayoutSnapshot(graphEngine);
      return;
    }

    this._removeGraphEngine();

    if (graphEngine) {
      this.state.graphEngine = graphEngine;
      this._applyGraphEngineCallbacks(graphEngine);
      graphEngine.run();
      this._updateLayoutSnapshot(graphEngine);
    } else {
      this.state.graphEngine = null;
      this._updateLayoutSnapshot(null);
    }
  }

  _removeGraphEngine() {
    const engine = this.state.graphEngine;
    if (engine) {
      engine.setProps({
        onLayoutStart: undefined,
        onLayoutChange: undefined,
        onLayoutDone: undefined,
        onLayoutError: undefined
      });
      engine.clear();
      this.state.graphEngine = null;
      this._updateLayoutSnapshot(null);
    }
  }

  private _applyGraphEngineCallbacks(engine: GraphEngine) {
    engine.setProps({
      onLayoutStart: (detail) => {
        this._handleLayoutEvent();
        this.props.onLayoutStart?.(detail);
      },
      onLayoutChange: (detail) => {
        this._handleLayoutEvent();
        this.props.onLayoutChange?.(detail);
      },
      onLayoutDone: (detail) => {
        this._handleLayoutEvent();
        this.props.onLayoutDone?.(detail);
      },
      onLayoutError: (error) => {
        this._handleLayoutEvent();
        this.props.onLayoutError?.(error);
      }
    });
  }

  private _createRankGridLayer(): GridLayer | null {
    const engine = this.state.graphEngine;
    if (!engine) {
      return null;
    }

    const {enabled, config} = this._normalizeRankGridConfig(this.props.rankGrid);
    if (!enabled) {
      return null;
    }

    const bounds = this._resolveRankGridBounds(engine);
    if (!bounds) {
      return null;
    }

    const data = this._buildRankGridData(engine, config, bounds);
    if (!data) {
      return null;
    }

    const direction = config?.direction ?? 'horizontal';
    const gridProps = config?.gridProps ?? {};

    return new GridLayer({
      id: `${this.props.id}-rank-grid`,
      data,
      direction,
      xMin: bounds.xMin,
      xMax: bounds.xMax,
      yMin: bounds.yMin,
      yMax: bounds.yMax,
      pickable: false,
      ...gridProps
    });
  }

  private _normalizeRankGridConfig(
    value: GraphLayerProps['rankGrid']
  ): {enabled: boolean; config?: RankGridConfig} {
    if (typeof value === 'boolean') {
      return {enabled: value};
    }

    if (value && typeof value === 'object') {
      return {enabled: value.enabled ?? true, config: value};
    }

    return {enabled: false};
  }

  private _resolveRankGridBounds(engine: GraphEngine):
    | {xMin: number; xMax: number; yMin: number; yMax: number}
    | null {
    const bounds = engine.getLayoutBounds();
    if (!bounds) {
      return null;
    }

    const [[minXRaw, minYRaw], [maxXRaw, maxYRaw]] = bounds;
    const values = [minXRaw, minYRaw, maxXRaw, maxYRaw];
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return null;
    }

    return {
      xMin: Math.min(minXRaw, maxXRaw),
      xMax: Math.max(minXRaw, maxXRaw),
      yMin: Math.min(minYRaw, maxYRaw),
      yMax: Math.max(minYRaw, maxYRaw)
    };
  }

  private _buildRankGridData(
    engine: GraphEngine,
    config: RankGridConfig | undefined,
    bounds: {yMin: number; yMax: number}
  ): Array<{label: string; rank: number; originalLabel?: string | number; yPosition: number}> | null {
    const rankLabelPrefix = this._resolveRankFieldLabel(config?.rankAccessor);
    // @ts-ignore iterator type
    const rankPositions = mapRanksToYPositions(engine.getNodes(), engine.getNodePosition, {
      rankAccessor: config?.rankAccessor,
      labelAccessor: config?.labelAccessor,
      yRange: {min: bounds.yMin, max: bounds.yMax}
    });

    if (rankPositions.length === 0) {
      return null;
    }

    const selectedRanks = selectRankLines(rankPositions, {
      yMin: bounds.yMin,
      yMax: bounds.yMax,
      maxCount: config?.maxLines ?? 8
    });

    if (selectedRanks.length === 0) {
      return null;
    }

    return selectedRanks.map(({rank, label, yPosition}) => ({
      label: `${rankLabelPrefix} ${rank}`,
      rank,
      originalLabel: label === undefined ? undefined : label,
      yPosition
    }));
  }

  private _resolveRankFieldLabel(rankAccessor: RankAccessor | undefined): string {
    if (!rankAccessor) {
      return 'srank';
    }
    if (typeof rankAccessor === 'string' && rankAccessor.length > 0) {
      return rankAccessor;
    }
    if (typeof rankAccessor === 'function' && rankAccessor.name) {
      return rankAccessor.name;
    }
    return 'rank';
  }

  createNodeLayers() {
    const engine = this.state.graphEngine;
    const {nodes: nodeStyles} = this._getResolvedStylesheet();

    if (!engine || !Array.isArray(nodeStyles) || nodeStyles.length === 0) {
      return [];
    }

    const baseLayers = nodeStyles
      .filter(Boolean)
      .map((style, idx) => {
        const {pickable = true, visible = true, data = (nodes) => nodes, ...restStyle} = style;
        const LayerType = NODE_LAYER_MAP[style.type];
        if (!LayerType) {
          warn(`GraphLayer: Invalid node type "${style.type}".`);
          return null;
        }
        const stylesheet = this._createStylesheetEngine(
          restStyle as unknown as GraphStylesheet,
          `node stylesheet "${style.type}"`
        );
        if (!stylesheet) {
          return null;
        }
        const getOffset = stylesheet.getDeckGLAccessor('getOffset');
        return new LayerType({
          ...SHARED_LAYER_PROPS,
          id: `node-rule-${idx}`,
          data: data(engine.getNodes()),
          getPosition: mixedGetPosition(engine.getNodePosition, getOffset),
          pickable,
          positionUpdateTrigger: [
            engine.getLayoutLastUpdate(),
            engine.getLayoutState(),
            stylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
          ].join(),
          stylesheet,
          visible
        } as any);
      })
      .filter(Boolean) as any[];

    const chainLayers = this._createChainOverlayLayers(engine);

    return [...baseLayers, ...chainLayers];
  }

  createEdgeLayers() {
    const engine = this.state.graphEngine;
    const {edges: edgeStyles, nodes: nodeStyles} = this._getResolvedStylesheet();

    if (!engine || !edgeStyles) {
      return [];
    }

    const edgeStyleArray = Array.isArray(edgeStyles) ? edgeStyles : [edgeStyles];

    if (edgeStyleArray.length === 0) {
      return [];
    }

    const getLayoutInfo = this._edgeAttachmentHelper.getLayoutAccessor({
      engine,
      interactionManager: this.state.interactionManager,
      nodeStyle: nodeStyles
    });

    return edgeStyleArray
      .filter(Boolean)
      .flatMap((style, idx) => {
        const {decorators, data = (edges) => edges, visible = true, ...restEdgeStyle} = style;
        const stylesheet = this._createStylesheetEngine(
          {
            type: 'edge',
            ...restEdgeStyle
          } as GraphStylesheet,
          'edge stylesheet'
        );
        if (!stylesheet) {
          return [];
        }

        const edgeLayer = new EdgeLayer({
          ...SHARED_LAYER_PROPS,
          id: `edge-layer-${idx}`,
          data: data(engine.getEdges()),
          getLayoutInfo,
          pickable: true,
          positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
          stylesheet,
          visible
        } as any);

        if (!decorators || !Array.isArray(decorators) || decorators.length === 0) {
          return [edgeLayer];
        }

        const decoratorLayers = decorators
          .filter(Boolean)
          // @ts-ignore eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map((decoratorStyle, idx2) => {
            const DecoratorLayer = EDGE_DECORATOR_LAYER_MAP[decoratorStyle.type];
            if (!DecoratorLayer) {
              warn(`GraphLayer: Invalid edge decorator type "${decoratorStyle.type}".`);
              return null;
            }
            const decoratorStylesheet = this._createStylesheetEngine(
              decoratorStyle as unknown as GraphStylesheet,
              `edge decorator stylesheet "${decoratorStyle.type}"`
            );
            if (!decoratorStylesheet) {
              return null;
            }
            return new DecoratorLayer({
              ...SHARED_LAYER_PROPS,
              id: `edge-decorator-${idx2}`,
              data: data(engine.getEdges()),
              getLayoutInfo,
              pickable: true,
              positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
              stylesheet: decoratorStylesheet
            } as any);
          })
          .filter(Boolean);

        return [edgeLayer, ...decoratorLayers];
      });
  }

  onClick(info, event): boolean {
    return (this.state.interactionManager.onClick(info, event) as unknown as boolean) || false;
  }

  onHover(info, event): boolean {
    return (this.state.interactionManager.onHover(info, event) as unknown as boolean) || false;
  }

  onDragStart(info, event) {
    this.state.interactionManager.onDragStart(info, event);
  }

  onDrag(info, event) {
    this.state.interactionManager.onDrag(info, event);
  }

  onDragEnd(info, event) {
    this.state.interactionManager.onDragEnd(info, event);
  }

  renderLayers() {
    const layers: any[] = [];
    const gridLayer = this._createRankGridLayer();
    if (gridLayer) {
      layers.push(gridLayer);
    }

    const edgeLayers = this.createEdgeLayers();
    if (Array.isArray(edgeLayers) && edgeLayers.length > 0) {
      layers.push(...edgeLayers);
    }

    const nodeLayers = this.createNodeLayers();
    if (Array.isArray(nodeLayers) && nodeLayers.length > 0) {
      layers.push(...nodeLayers);
    }

    return layers;
  }

  private _createChainOverlayLayers(engine: GraphEngine) {
    const chainData = buildCollapsedChainLayers(engine);
    if (!chainData) {
      return [];
    }

    const {
      collapsedNodes,
      collapsedOutlineNodes,
      expandedNodes,
      expandedOutlineNodes,
      getChainOutlinePolygon,
      outlineUpdateTrigger
    } = chainData;

    const layers: any[] = [];

    if (collapsedOutlineNodes.length > 0) {
      layers.push(
        new PolygonLayer({
          ...SHARED_LAYER_PROPS,
          id: 'collapsed-chain-outlines',
          data: collapsedOutlineNodes,
          getPolygon: (node: NodeInterface) => getChainOutlinePolygon(node),
          stroked: true,
          filled: false,
          getLineColor: [220, 64, 64, 220],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 2,
          pickable: true,
          updateTriggers: {
            getPolygon: [outlineUpdateTrigger]
          }
        })
      );
    }

    const collapsedMarkerStylesheet = this._createStylesheetEngine(
      {
        type: 'marker',
        fill: [64, 96, 192, 255],
        size: 32,
        marker: 'circle-plus-filled',
        offset: [24, -24],
        scaleWithZoom: false
      } as GraphStylesheet<'marker'>,
      'collapsed chain marker stylesheet'
    );

    if (collapsedMarkerStylesheet && collapsedNodes.length > 0) {
      const getOffset = collapsedMarkerStylesheet.getDeckGLAccessor('getOffset');
      layers.push(
        new ZoomableMarkerLayer({
          ...SHARED_LAYER_PROPS,
          id: 'collapsed-chain-markers',
          data: collapsedNodes,
          getPosition: mixedGetPosition(engine.getNodePosition, getOffset),
          pickable: true,
          positionUpdateTrigger: [
            engine.getLayoutLastUpdate(),
            engine.getLayoutState(),
            collapsedMarkerStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
          ].join(),
          stylesheet: collapsedMarkerStylesheet,
          visible: true
        } as any)
      );
    }

    if (expandedOutlineNodes.length > 0) {
      layers.push(
        new PolygonLayer({
          ...SHARED_LAYER_PROPS,
          id: 'expanded-chain-outlines',
          data: expandedOutlineNodes,
          getPolygon: (node: NodeInterface) => getChainOutlinePolygon(node),
          stroked: true,
          filled: false,
          getLineColor: [64, 96, 192, 200],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 2,
          pickable: true,
          updateTriggers: {
            getPolygon: [outlineUpdateTrigger]
          }
        })
      );
    }

    const expandedMarkerStylesheet = this._createStylesheetEngine(
      {
        type: 'marker',
        fill: [64, 96, 192, 255],
        size: 32,
        marker: 'circle-minus-filled',
        offset: [24, -24],
        scaleWithZoom: false
      } as GraphStylesheet<'marker'>,
      'expanded chain marker stylesheet'
    );

    if (expandedMarkerStylesheet && expandedNodes.length > 0) {
      const getOffset = expandedMarkerStylesheet.getDeckGLAccessor('getOffset');
      layers.push(
        new ZoomableMarkerLayer({
          ...SHARED_LAYER_PROPS,
          id: 'expanded-chain-markers',
          data: expandedNodes,
          getPosition: mixedGetPosition(engine.getNodePosition, getOffset),
          pickable: true,
          positionUpdateTrigger: [
            engine.getLayoutLastUpdate(),
            engine.getLayoutState(),
            expandedMarkerStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
          ].join(),
          stylesheet: expandedMarkerStylesheet,
          visible: true
        } as any)
      );
    }

    return layers;
  }
}
