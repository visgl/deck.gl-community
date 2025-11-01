// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {EdgeDecoratorType, EdgeState, EdgeType, LayoutState, NodeState, NodeType} from '../core/constants';
import {Marker} from '../layers/common-layers/marker-layer/marker-list';

/** Markers supported by graph-layers @deprecated v9.2: Use string literals */
export const MARKER_TYPE = {
  'bell-filled': 'bell-filled',
  bell: 'bell',
  'bookmark-filled': 'bookmark-filled',
  bookmark: 'bookmark',
  'cd-filled': 'cd-filled',
  cd: 'cd',
  checkmark: 'checkmark',
  'circle-check-filled': 'circle-check-filled',
  'circle-check': 'circle-check',
  'circle-filled': 'circle-filled',
  'circle-i-filled': 'circle-i-filled',
  'circle-i': 'circle-i',
  'circle-minus-filled': 'circle-minus-filled',
  'circle-minus': 'circle-minus',
  'circle-plus-filled': 'circle-plus-filled',
  'circle-plus': 'circle-plus',
  'circle-questionmark-filled': 'circle-questionmark-filled',
  'circle-questionmark': 'circle-questionmark',
  'circle-slash-filled': 'circle-slash-filled',
  'circle-slash': 'circle-slash',
  'circle-x-filled': 'circle-x-filled',
  'circle-x': 'circle-x',
  circle: 'circle',
  'diamond-filled': 'diamond-filled',
  diamond: 'diamond',
  'flag-filled': 'flag-filled',
  flag: 'flag',
  gear: 'gear',
  'heart-filled': 'heart-filled',
  heart: 'heart',
  'location-marker-filled': 'location-marker-filled',
  'location-marker': 'location-marker',
  'octagonal-star-filled': 'octagonal-star-filled',
  'octagonal-star': 'octagonal-star',
  'person-filled': 'person-filled',
  person: 'person',
  'pin-filled': 'pin-filled',
  pin: 'pin',
  'plus-small': 'plus-small',
  plus: 'plus',
  'rectangle-filled': 'rectangle-filled',
  rectangle: 'rectangle',
  'star-filled': 'star-filled',
  star: 'star',
  'tag-filled': 'tag-filled',
  tag: 'tag',
  'thumb-down-filled': 'thumb-down-filled',
  'thumb-down': 'thumb-down',
  'thumb-up': 'thumb-up',
  'thumb_up-filled': 'thumb_up-filled',
  'triangle-down-filled': 'triangle-down-filled',
  'triangle-down': 'triangle-down',
  'triangle-left-filled': 'triangle-left-filled',
  'triangle-left': 'triangle-left',
  'triangle-right-filled': 'triangle-right-filled',
  'triangle-right': 'triangle-right',
  'triangle-up-filled': 'triangle-up-filled',
  'triangle-up': 'triangle-up',
  'x-small': 'x-small',
  x: 'x'
} as const satisfies Record<Marker, Marker>;
/* eslint-enable */


/** The interaction state of a node. @deprecated v9.2: Use string literals */
export const NODE_STATE = {
  DEFAULT: 'default',
  HOVER: 'hover',
  DRAGGING: 'dragging',
  SELECTED: 'selected'
} as const satisfies Record<string, NodeState>;

/** The interaction state of an edge. @deprecated v9.2: Use string literals */
export const EDGE_STATE = {
  DEFAULT: 'default',
  HOVER: 'hover',
  DRAGGING: 'dragging',
  SELECTED: 'selected'
} as const satisfies Record<string, EdgeState>;

/** The visual type of a node. @deprecated v9.2: Use string literals */
export const NODE_TYPE = {
  CIRCLE: 'circle',
  RECTANGLE: 'rectangle',
  ROUNDED_RECTANGLE: 'rounded-rectangle',
  PATH_ROUNDED_RECTANGLE: 'path-rounded-rectangle',
  ICON: 'icon',
  LABEL: 'label',
  MARKER: 'marker'
} as const satisfies Record<string, NodeType> ;

/** The visual type of an edge. @deprecated v9.2: Use string literals */
export const EDGE_TYPE = {
  SPLINE_CURVE: 'spline',
  LINE: 'line',
  PATH: 'path'
} as const satisfies Record<string, EdgeType> ;

/** Decorators on an edge. @deprecated v9.2: Use string literals */
export const EDGE_DECORATOR_TYPE = {
  LABEL: 'label',
  FLOW: 'flow',
  ARROW: 'arrow'
} as const satisfies Record<string, EdgeDecoratorType> ;

/** the status of the layout. @deprecated v9.2: Use string literals */
export const LAYOUT_STATE = {
  INIT: 'init',
  START: 'start',
  CALCULATING: 'calculating',
  DONE: 'done',
  ERROR: 'error'
} as const satisfies Record<string, LayoutState> ;
