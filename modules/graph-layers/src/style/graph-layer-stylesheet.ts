// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphStylesheet, GraphStyleRule, GraphStyleType} from './graph-style-engine';

export type GraphNodeStyleType = Exclude<
  GraphStyleType,
  'Edge' | 'edge' | 'edge-label' | 'flow' | 'arrow'
>;

export type GraphEdgeDecoratorType = Extract<GraphStyleType, 'edge-label' | 'flow' | 'arrow'>;

export type GraphLayerNodeStyle = Extract<GraphStyleRule, {type: GraphNodeStyleType}> & {
  pickable?: boolean;
  visible?: boolean;
  data?: (nodes: any[]) => any;
};

export type GraphLayerEdgeDecoratorStyle = Extract<GraphStyleRule, {type: GraphEdgeDecoratorType}>;

type EdgeStyleType = Extract<GraphStyleType, 'Edge' | 'edge'>;

export type GraphLayerEdgeStyle = (
  | Extract<GraphStyleRule, {type: EdgeStyleType}>
  | (Omit<Extract<GraphStyleRule, {type: EdgeStyleType}>, 'type'> & {type?: EdgeStyleType})
) & {
  decorators?: GraphLayerEdgeDecoratorStyle[];
  data?: (edges: any[]) => any;
  visible?: boolean;
};

export type GraphLayerStylesheet = GraphStylesheet & {
  nodes?: GraphLayerNodeStyle[];
  edges?: GraphLayerEdgeStyle | GraphLayerEdgeStyle[];
};

export type GraphLayerStylesheetInput = GraphLayerStylesheet | null | undefined;

export type NormalizedGraphLayerStylesheet = {
  nodes: GraphLayerNodeStyle[];
  edges: GraphLayerEdgeStyle[];
};

export const DEFAULT_GRAPH_LAYER_STYLESHEET_INPUT: GraphLayerStylesheet = {
  nodes: [],
  edges: [
    {
      type: 'edge',
      stroke: 'black',
      strokeWidth: 1
    }
  ]
};

const DEFAULT_EDGE_STYLE: GraphLayerEdgeStyle = {
  ...DEFAULT_GRAPH_LAYER_STYLESHEET_INPUT.edges[0],
  decorators: []
};

export const DEFAULT_GRAPH_LAYER_STYLESHEET: NormalizedGraphLayerStylesheet = {
  nodes: [],
  edges: [DEFAULT_EDGE_STYLE]
};

export type GraphLayerStylesheetSources = {
  stylesheet?: GraphLayerStylesheetInput;
  nodeStyle?: GraphLayerNodeStyle[];
  edgeStyle?: GraphLayerEdgeStyle | GraphLayerEdgeStyle[];
};

export function normalizeGraphLayerStylesheet({
  stylesheet,
  nodeStyle,
  edgeStyle
}: GraphLayerStylesheetSources): NormalizedGraphLayerStylesheet {
  const resolvedStylesheet = stylesheet ?? {};
  const resolvedNodeStyles = Array.isArray(resolvedStylesheet.nodes)
    ? resolvedStylesheet.nodes
    : nodeStyle;

  const resolvedEdgeStyles = resolvedStylesheet.edges ?? edgeStyle;

  const nodes = Array.isArray(resolvedNodeStyles)
    ? resolvedNodeStyles.filter(Boolean)
    : [...DEFAULT_GRAPH_LAYER_STYLESHEET.nodes];

  const edgeEntries = Array.isArray(resolvedEdgeStyles)
    ? resolvedEdgeStyles
    : resolvedEdgeStyles
      ? [resolvedEdgeStyles]
      : DEFAULT_GRAPH_LAYER_STYLESHEET.edges;

  const edges: GraphLayerEdgeStyle[] = edgeEntries.filter(Boolean).map((edgeStyleEntry) => ({
    ...edgeStyleEntry,
    type: edgeStyleEntry.type ?? 'edge',
    decorators: edgeStyleEntry.decorators ?? []
  })) as GraphLayerEdgeStyle[];

  return {
    nodes,
    edges
  };
}

export type {GraphStyleValue, GraphStylesheet, GraphStyleType} from './graph-style-engine';
