// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {StyleEngine, type DeckGLAccessorMap, type DeckGLUpdateTriggers} from './style-engine';

const COMMON_DECKGL_PROPS = {
  getOffset: 'offset',
  opacity: 'opacity'
} as const;

const GRAPH_DECKGL_ACCESSOR_MAP = {
  circle: {
    ...COMMON_DECKGL_PROPS,
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth',
    getRadius: 'radius'
  },

  rectangle: {
    ...COMMON_DECKGL_PROPS,
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth'
  },

  'rounded-rectangle': {
    ...COMMON_DECKGL_PROPS,
    getCornerRadius: 'cornerRadius',
    getRadius: 'radius',
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth'
  },

  'path-rounded-rectangle': {
    ...COMMON_DECKGL_PROPS,
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth',
    getCornerRadius: 'cornerRadius'
  },

  label: {
    ...COMMON_DECKGL_PROPS,
    getColor: 'color',
    getText: 'text',
    getSize: 'fontSize',
    getTextAnchor: 'textAnchor',
    getAlignmentBaseline: 'alignmentBaseline',
    getAngle: 'angle',
    scaleWithZoom: 'scaleWithZoom',
    textMaxWidth: 'textMaxWidth',
    textWordBreak: 'textWordBreak',
    textSizeMinPixels: 'textSizeMinPixels'
  },

  marker: {
    ...COMMON_DECKGL_PROPS,
    getColor: 'fill',
    getSize: 'size',
    getMarker: 'marker',
    scaleWithZoom: 'scaleWithZoom'
  },

  Edge: {
    getColor: 'stroke',
    getWidth: 'strokeWidth'
  },
  'edge-label': {
    getColor: 'color',
    getText: 'text',
    getSize: 'fontSize',
    getTextAnchor: 'textAnchor',
    getAlignmentBaseline: 'alignmentBaseline',
    scaleWithZoom: 'scaleWithZoom',
    textMaxWidth: 'textMaxWidth',
    textWordBreak: 'textWordBreak',
    textSizeMinPixels: 'textSizeMinPixels'
  },
  flow: {
    getColor: 'color',
    getWidth: 'width',
    getSpeed: 'speed',
    getTailLength: 'tailLength'
  },
  arrow: {
    getColor: 'color',
    getSize: 'size',
    getOffset: 'offset'
  }
} as const satisfies DeckGLAccessorMap;

type GraphStyleType = keyof typeof GRAPH_DECKGL_ACCESSOR_MAP;
type GraphStyleSelector = `:${string}`;

type GraphStylePropertyKey<TType extends GraphStyleType> =
  (typeof GRAPH_DECKGL_ACCESSOR_MAP)[TType][keyof (typeof GRAPH_DECKGL_ACCESSOR_MAP)[TType]];

type GraphStyleStatefulValue<T> = T | {[state: string]: T};

type GraphStylePropertyMap<TType extends GraphStyleType, TValue> = Partial<
  Record<GraphStylePropertyKey<TType>, GraphStyleStatefulValue<TValue>>
>;

export type GraphStylesheet<
  TType extends GraphStyleType = GraphStyleType,
  TValue = unknown
> = {type: TType} &
  GraphStylePropertyMap<TType, TValue> &
  Partial<Record<GraphStyleSelector, GraphStylePropertyMap<TType, TValue>>>;

const GRAPH_DECKGL_UPDATE_TRIGGERS: DeckGLUpdateTriggers = {
  circle: ['getFillColor', 'getRadius', 'getLineColor', 'getLineWidth'],
  rectangle: ['getFillColor', 'getLineColor', 'getLineWidth'],
  'rounded-rectangle': ['getFillColor', 'getLineColor', 'getLineWidth', 'getCornerRadius'],
  'path-rounded-rectangle': ['getFillColor', 'getLineColor', 'getLineWidth', 'getCornerRadius'],
  label: ['getColor', 'getText', 'getSize', 'getTextAnchor', 'getAlignmentBaseline', 'getAngle'],
  marker: ['getColor', 'getSize', 'getMarker'],
  Edge: ['getColor', 'getWidth'],
  'edge-label': ['getColor', 'getText', 'getSize', 'getTextAnchor', 'getAlignmentBaseline'],
  flow: ['getColor', 'getWidth', 'getSpeed', 'getTailLength'],
  arrow: ['getColor', 'getSize', 'getOffset']
};

export class GraphStyleEngine extends StyleEngine {
  constructor(style: GraphStylesheet, {stateUpdateTrigger}: {stateUpdateTrigger?: unknown} = {}) {
    super(style, {
      deckglAccessorMap: GRAPH_DECKGL_ACCESSOR_MAP,
      deckglUpdateTriggers: GRAPH_DECKGL_UPDATE_TRIGGERS,
      stateUpdateTrigger
    });
  }
}
