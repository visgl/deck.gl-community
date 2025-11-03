// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors


/** Supported scale families for attribute references. *
export type GraphStyleScaleType 

  | 'log'
  | 'pow'
  | 'sqrt'
  | 'quantize'
  | 'quantile'
  | 'ordinal';
/** Configuration for attribute scale mapping. *
export type GraphStyleScale = 

  domain?: (number | string)[];
  range?: any[];
  clamp?: boolean;
  nice?: boolean | number;
  base?: number;
  exponent?: number;
};

/** Declares that a style property should derive its value from a graph attribute. *
export type GraphStyleAttributeReference<TValue = unknown> 

  | {
      attribute: string;
      fallback?: TValue;
      scale?: GraphStyleScale | ((value: unknown) => unknown);
    };

export type GraphStyleLeafValue<TValue = unknown> 

  | GraphStyleAttributeReference<TValue>
  | ((datum: unknown) => TValue);

/** Acceptable value for a style property, including optional interaction states. *
export type GraphStyleValue<TValue = unknown> 


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
  edge: {
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

export type GraphStyleType = keyof typeof GRAPH_DECKGL_ACCESSOR_MAP;
export type GraphStyleSelector = `:${string}`;

type GraphStylePropertyKey<TType extends GraphStyleType> = Extract<
  (typeof GRAPH_DECKGL_ACCESSOR_MAP)[TType][keyof (typeof GRAPH_DECKGL_ACCESSOR_MAP)[TType]],
  PropertyKey
>;

type GraphStyleStatefulValue<TValue> = TValue | {[state: string]: TValue};

type GraphStylePropertyMap<TType extends GraphStyleType, TValue> = Partial<
  Record<GraphStylePropertyKey<TType>, GraphStyleStatefulValue<TValue>>
>;

export type GraphStylesheet<
  TType extends GraphStyleType = GraphStyleType,
  TValue = GraphStyleLeafValue
> = {type: TType} &
  GraphStylePropertyMap<TType, TValue> &
  Partial<Record<GraphStyleSelector, GraphStylePropertyMap<TType, TValue>>>;
*/

import type {ZodError} from 'zod';

import {StyleEngine, type DeckGLUpdateTriggers} from './style-engine';
import {log} from '../utils/log';
import {
  GraphStylesheetSchema,
  GRAPH_DECKGL_ACCESSOR_MAP,
  type GraphStylesheet,
  type GraphStylesheetParsed,
  type GraphStyleType
} from './graph-stylesheet.schema';

const GRAPH_DECKGL_UPDATE_TRIGGERS: DeckGLUpdateTriggers = {
  circle: ['getFillColor', 'getRadius', 'getLineColor', 'getLineWidth'],
  rectangle: ['getFillColor', 'getLineColor', 'getLineWidth'],
  'rounded-rectangle': ['getFillColor', 'getLineColor', 'getLineWidth', 'getCornerRadius'],
  'path-rounded-rectangle': ['getFillColor', 'getLineColor', 'getLineWidth', 'getCornerRadius'],
  label: ['getColor', 'getText', 'getSize', 'getTextAnchor', 'getAlignmentBaseline', 'getAngle'],
  marker: ['getColor', 'getSize', 'getMarker'],
  Edge: ['getColor', 'getWidth'],
  edge: ['getColor', 'getWidth'],
  'edge-label': ['getColor', 'getText', 'getSize', 'getTextAnchor', 'getAlignmentBaseline'],
  flow: ['getColor', 'getWidth', 'getSpeed', 'getTailLength'],
  arrow: ['getColor', 'getSize', 'getOffset']
};

function formatStylesheetError(error: ZodError) {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'root';
      return `  • ${path}: ${issue.message}`;
    })
    .join('\n');
  return `Invalid graph stylesheet:\n${details}`;
}

export class GraphStyleEngine extends StyleEngine {
  constructor(style: GraphStylesheet, {stateUpdateTrigger}: {stateUpdateTrigger?: unknown} = {}) {
    let parsedStyle: GraphStylesheetParsed;
    const parseResult = GraphStylesheetSchema.safeParse(style);
    if (parseResult.success) {
      parsedStyle = parseResult.data;
    } else {
      const error = parseResult.error;
      const styleType = style?.type;
      const fallbackType = isGraphStyleType(styleType) ? styleType : DEFAULT_FALLBACK_STYLE_TYPE;
      log.warn(formatStylesheetError(error));
      parsedStyle = GraphStylesheetSchema.parse({type: fallbackType});
    }

    super(parsedStyle, {
      deckglAccessorMap: GRAPH_DECKGL_ACCESSOR_MAP,
      deckglUpdateTriggers: GRAPH_DECKGL_UPDATE_TRIGGERS,
      stateUpdateTrigger
    });
  }
}

const DEFAULT_FALLBACK_STYLE_TYPE: GraphStyleType = 'edge';

function isGraphStyleType(value: unknown): value is GraphStyleType {
  return typeof value === 'string' && value in GRAPH_DECKGL_ACCESSOR_MAP;
}

export {
  GraphStyleScaleTypeEnum,
  GraphStyleScaleSchema,
  GraphStyleAttributeReferenceSchema,
  GraphStyleLeafValueSchema,
  GraphStyleStateMapSchema,
  GraphStyleValueSchema,
  GraphStylesheetSchema
} from './graph-stylesheet.schema';

export type {
  GraphStyleAttributeReference,
  GraphStyleLeafValue,
  GraphStyleScale,
  GraphStyleScaleType,
  GraphStyleSelector,
  GraphStyleType,
  GraphStyleValue,
  GraphStylesheet,
  GraphStylesheetInput,
  GraphStylesheetParsed
} from './graph-stylesheet.schema';
