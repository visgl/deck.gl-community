// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphStylesheet, GraphStyleValue, GraphStyleType} from './graph-style-engine';

export type GraphNodeStyleType = Exclude<
  GraphStyleType,
  'Edge' | 'edge' | 'edge-label' | 'flow' | 'arrow'
>;

export type GraphEdgeDecoratorType = Extract<GraphStyleType, 'edge-label' | 'flow' | 'arrow'>;

export type GraphLayerNodeStyle = GraphStylesheet<GraphNodeStyleType> & {
  pickable?: boolean;
  visible?: boolean;
  data?: (nodes: any[]) => any;
};

export type GraphLayerEdgeDecoratorStyle = GraphStylesheet<GraphEdgeDecoratorType>;

type EdgeStyleType = Extract<GraphStyleType, 'Edge' | 'edge'>;

export type GraphLayerEdgeStyle = (
  | GraphStylesheet<EdgeStyleType>
  | (Omit<GraphStylesheet<EdgeStyleType>, 'type'> & {type?: EdgeStyleType})
) & {
  decorators?: GraphLayerEdgeDecoratorStyle[];
  data?: (edges: any[]) => any;
  visible?: boolean;
};

export type GraphLayerStylesheet = {
  nodes?: GraphLayerNodeStyle[];
  edges?: GraphLayerEdgeStyle | GraphLayerEdgeStyle[];
};

export type GraphLayerStylesheetInput = GraphLayerStylesheet | null | undefined;

const DEFAULT_EDGE_STYLE: GraphLayerEdgeStyle = {
  type: 'edge',
  stroke: 'black',
  strokeWidth: 1,
  decorators: []
};

export const DEFAULT_GRAPH_LAYER_STYLESHEET: Required<Pick<GraphLayerStylesheet, 'nodes' | 'edges'>> = {
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
}: GraphLayerStylesheetSources): Required<Pick<GraphLayerStylesheet, 'nodes' | 'edges'>> {
  const resolvedStylesheet = stylesheet ?? {};
  const resolvedNodeStyles = Array.isArray(resolvedStylesheet.nodes)
    ? resolvedStylesheet.nodes
    : nodeStyle;

  const resolvedEdgeStyles = resolvedStylesheet.edges ?? edgeStyle;

  const nodes = Array.isArray(resolvedNodeStyles)
    ? resolvedNodeStyles.filter(Boolean)
    : [...DEFAULT_GRAPH_LAYER_STYLESHEET.nodes];

  const edgesArray = Array.isArray(resolvedEdgeStyles)
    ? resolvedEdgeStyles
    : resolvedEdgeStyles
    ? [resolvedEdgeStyles]
    : DEFAULT_GRAPH_LAYER_STYLESHEET.edges;

  const edges = edgesArray
    .filter(Boolean)
    .map((edgeStyleEntry) => ({
      type: 'edge',
      decorators: [],
      ...edgeStyleEntry
    }));

  return {
    nodes,
    edges
  };
}

export type {
  GraphStyleValue,
  GraphStylesheet,
  GraphStyleType
} from './graph-style-engine';
