export type ValueOf<T> = T[keyof T];

// the interaction state of a node.
export const NODE_STATE = {
  DEFAULT: 'default',
  HOVER: 'hover',
  DRAGGING: 'dragging',
  SELECTED: 'selected'
};

export const EDGE_STATE = {
  DEFAULT: 'default',
  HOVER: 'hover',
  DRAGGING: 'dragging',
  SELECTED: 'selected'
};

// node visual marker type
export const NODE_TYPE = {
  CIRCLE: 'CIRCLE',
  RECTANGLE: 'RECTANGLE',
  ROUNDED_RECTANGLE: 'ROUNDED_RECTANGLE',
  PATH_ROUNDED_RECTANGLE: 'PATH_ROUNDED_RECTANGLE',
  ICON: 'ICON',
  LABEL: 'LABEL',
  MARKER: 'MARKER'
};

// edge shape
export const EDGE_TYPE = {
  SPLINE_CURVE: 'SPLINE_CURVE',
  LINE: 'LINE',
  PATH: 'PATH'
};

// decorators on edges
export const EDGE_DECORATOR_TYPE = {
  LABEL: 'EDGE_LABEL',
  FLOW: 'FLOW'
};

// the status of the layout
export const LAYOUT_STATE = {
  INIT: 'INIT',
  START: 'START',
  CALCULATING: 'CALCULATING',
  DONE: 'DONE',
  ERROR: 'ERROR'
};

// All the markers supported by node type MARKER
import Markers from '../deckgl-layers/marker-layer/marker-list';
export const MARKER_TYPE = Markers;
