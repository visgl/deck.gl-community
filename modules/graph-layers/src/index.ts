// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// core - Graph representation and layout
export {ClassicGraph, ClassicGraphLayoutAdapter} from './graph/classic-graph';
export type {Graph, NodeInterface, EdgeInterface} from './graph/graph';
export {Node} from './graph/node';
export {Edge} from './graph/edge';
export {
  TabularGraph,
  TabularNode,
  TabularEdge,
  type NodeIndex,
  type EdgeIndex,
  type TabularGraphSource,
  type TabularGraphAccessors,
  type TabularNodeAccessors,
  type TabularEdgeAccessors
} from './graph/tabular-graph';
export {ArrowGraph} from './graph/arrow-graph';
export {
  convertTabularGraphToArrowGraph,
  type ConvertTabularGraphToArrowGraphOptions
} from './graph/convert-tabular-graph-to-arrow-graph';
export {createTabularGraphFromData} from './graph/create-tabular-graph-from-data';
export {createGraphFromData} from './graph/create-graph-from-data';
export {GraphDataBuilder, type GraphDataBuilderOptions} from './graph-data/graph-data-builder';
export {
  ArrowGraphDataBuilder,
  type ArrowGraphDataBuilderOptions
} from './graph-data/arrow-graph-data-builder';
export type {GraphData, GraphNodeData, GraphEdgeData} from './graph-data/graph-data';
export type {ArrowGraphData} from './graph-data/arrow-graph-data';

export {GraphEngine} from './core/graph-engine';

// graph-layers layouts
export type {
  GraphLayoutProps,
  GraphLayoutState,
  GraphLayoutEventDetail
} from './core/graph-layout';
export {GraphLayout} from './core/graph-layout';

export {SimpleLayout} from './layouts/simple-layout';
export {D3ForceLayout} from './layouts/d3-force/d3-force-layout';
export {D3DagLayout} from './layouts/d3-dag/d3-dag-layout';
export {CollapsableD3DagLayout} from './layouts/d3-dag/collapsable-d3-dag-layout';
export {GPUForceLayout} from './layouts/gpu-force/gpu-force-layout';
export {RadialLayout} from './layouts/experimental/radial-layout';
export {ForceMultiGraphLayout} from './layouts/experimental/force-multi-graph-layout';
export {HivePlotLayout} from './layouts/experimental/hive-plot-layout';

export type {Marker, NodeState, NodeType, EdgeType, EdgeDecoratorType, LayoutState} from './core/constants';

// deck.gl components
export {GraphLayer} from './layers/graph-layer';
export type {RankGridConfig} from './layers/graph-layer';
export {EdgeLayer} from './layers/edge-layer';
export {GridLayer, type GridLayerProps, type GridLineDatum} from './layers/common-layers/grid-layer/grid-layer';
export {StylesheetEngine} from './style/stylesheet-engine';
export {GraphStylesheetEngine, GraphStyleEngine} from './style/graph-style-engine';
export type {
  GraphStylesheet,
  GraphStylesheetInput,
  GraphStylesheetParsed,
  GraphStyleAttributeReference,
  GraphStyleScale,
  GraphStyleScaleType,
  GraphStyleValue
} from './style/graph-style-engine';
export {GraphStylesheetSchema} from './style/graph-style-engine';
export {
  DEFAULT_GRAPH_LAYER_STYLESHEET,
  type GraphLayerStylesheet,
  type GraphLayerEdgeStyle,
  type GraphLayerNodeStyle
} from './style/graph-layer-stylesheet';

// Widgets

export {ViewControlWidget} from './widgets/view-control-widget';

// graph format loaders
export {JSONTabularGraphLoader, JSONClassicGraphLoader} from './loaders/json-loader';
export {loadSimpleJSONGraph} from './loaders/simple-json-graph-loader';
export {
  DOTGraphLoader,
  loadDotGraph,
  parseDotToArrowGraphData,
  type DotGraphLoaderOptions,
  type DotGraphLoaderContextOptions,
  type DotGraphLoaderMetadata,
  type DotGraphLoaderResult
} from './loaders/dot-graph-loader';

// utils
export {mixedGetPosition} from './utils/layer-utils';
export {log} from './utils/log';
export {
  mapRanksToYPositions,
  selectRankLines,
  type RankAccessor,
  type LabelAccessor,
  type RankPosition,
  type MapRanksToYPositionsOptions,
  type SelectRankLinesOptions
} from './utils/rank-grid';

// DEPRECATED
export {createGraph} from './loaders/create-graph';
export {JSONLoader} from './loaders/json-loader';

export {MARKER_TYPE, NODE_STATE,EDGE_STATE,NODE_TYPE,EDGE_TYPE,EDGE_DECORATOR_TYPE,LAYOUT_STATE} from './_deprecated/old-constants';
