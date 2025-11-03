// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {
  GraphStylesheet as GraphPrimitiveStylesheet,
  GraphStyleType
} from './graph-style-engine';
import type {GraphStyleValue} from '../style-engine/style-types';

export type GraphNodeStyleType = Exclude<
  GraphStyleType,
  'Edge' | 'edge' | 'edge-label' | 'flow' | 'arrow'
>;

export type GraphEdgeDecoratorType = Extract<GraphStyleType, 'edge-label' | 'flow' | 'arrow'>;

export type GraphNodeStyle = GraphPrimitiveStylesheet<GraphNodeStyleType> & {
  pickable?: boolean;
  visible?: boolean;
  data?: (nodes: any[]) => any;
};

export type GraphEdgeDecoratorStyle = GraphPrimitiveStylesheet<GraphEdgeDecoratorType>;

type EdgeStyleType = Extract<GraphStyleType, 'Edge' | 'edge'>;

export type GraphEdgeStyle = (
  | GraphPrimitiveStylesheet<EdgeStyleType>
  | (Omit<GraphPrimitiveStylesheet<EdgeStyleType>, 'type'> & {type?: EdgeStyleType})
) & {
  decorators?: GraphEdgeDecoratorStyle[];
  data?: (edges: any[]) => any;
  visible?: boolean;
};

export type GraphStylesheet = {
  nodes?: GraphNodeStyle[];
  edges?: GraphEdgeStyle | GraphEdgeStyle[];
};

export type GraphStylesheetInput = GraphStylesheet | null | undefined;

export type NormalizedGraphStylesheet = {
  nodes: GraphNodeStyle[];
  edges: GraphEdgeStyle[];
};

const DEFAULT_EDGE_STYLE: GraphEdgeStyle = {
  type: 'edge',
  stroke: 'black',
  strokeWidth: 1,
  decorators: []
};

export const DEFAULT_GRAPH_LAYER_STYLESHEET: NormalizedGraphStylesheet = {
  nodes: [],
  edges: [DEFAULT_EDGE_STYLE]
};

export type GraphStylesheetSources = {
  stylesheet?: GraphStylesheetInput;
  nodeStyle?: GraphNodeStyle[];
  edgeStyle?: GraphEdgeStyle | GraphEdgeStyle[];
};

export function normalizeGraphStylesheet({
  stylesheet,
  nodeStyle,
  edgeStyle
}: GraphStylesheetSources): NormalizedGraphStylesheet {
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

  const edges: GraphEdgeStyle[] = (edgeEntries)
    .filter(Boolean)
    .map((edgeStyleEntry) => ({
      ...edgeStyleEntry,
      type: ((edgeStyleEntry).type ?? 'edge'),
      decorators: (edgeStyleEntry).decorators ?? []
    })) as GraphEdgeStyle[];

  return {
    nodes,
    edges
  };
}

export type {GraphStyleValue} from '../style-engine/style-types';
export type {GraphStyleType} from './graph-style-engine';
