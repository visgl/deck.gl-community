// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {MarkerList} from '../layers/common-layers/marker-layer/marker-list';

/** All the markers supported by node type marker */
export const MARKER_TYPE = MarkerList;

// the interaction state of a node.
export type NodeState = 'default' | 'hover' | 'dragging' | 'selected';

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
export type EdgeType = 'spline-curve' | 'line' | 'path';

// decorators on edges
export type EdgeDecoratorType = 'edge-label' | 'flow' | 'arrow';

// the status of the layout
export type LayoutState = 'init' | 'start' | 'calculating' | 'done' | 'error';
