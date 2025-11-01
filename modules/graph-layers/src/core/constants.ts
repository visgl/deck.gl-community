// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export {Marker} from '../layers/common-layers/marker-layer/marker-list';

/** The interaction state of a node. */
export type NodeState = 'default' | 'hover' | 'dragging' | 'selected';

/** The interaction state of an edge. */
export type EdgeState = 'default' | 'hover' | 'dragging' | 'selected';

// node visual marker type
export type NodeType =
  | 'circle'
  | 'rectangle'
  | 'rounded-rectangle'
  | 'path-rounded-rectangle'
  | 'icon'
  | 'label'
  | 'marker';

// edge shape
export type EdgeType = 'spline' | 'line' | 'path';

export const EDGE_TYPE = {
  SPLINE: 'spline',
  LINE: 'line',
  PATH: 'path'
} as const satisfies Record<string, EdgeType>;

// decorators on edges
export type EdgeDecoratorType = 'label' | 'flow' | 'arrow';

// the status of the layout
export type LayoutState = 'init' | 'start' | 'calculating' | 'done' | 'error';
