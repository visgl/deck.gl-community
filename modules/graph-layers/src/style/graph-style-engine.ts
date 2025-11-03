// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ZodError} from 'zod';

import {StyleEngine, type DeckGLUpdateTriggers} from '../style-engine/style-engine';
import {
  GraphStylesheetSchema,
  type GraphStylesheet,
  type GraphStylesheetParsed
} from './graph-stylesheet.schema';
import {GRAPH_DECKGL_ACCESSOR_MAP} from './graph-style-accessor-map';

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
    try {
      parsedStyle = GraphStylesheetSchema.parse(style);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(formatStylesheetError(error));
      }
      throw error;
    }

    super(parsedStyle as GraphStylesheet, {
      deckglAccessorMap: GRAPH_DECKGL_ACCESSOR_MAP,
      deckglUpdateTriggers: GRAPH_DECKGL_UPDATE_TRIGGERS,
      stateUpdateTrigger
    });
  }
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
  GraphStyleSelector,
  GraphStyleType,
  GraphStylesheet,
  GraphStylesheetInput,
  GraphStylesheetParsed
} from './graph-stylesheet.schema';

export type {
  GraphStyleAttributeReference,
  GraphStyleLeafValue,
  GraphStyleScale,
  GraphStyleScaleType,
  GraphStyleValue
} from '../style-engine/style-types';

export {GRAPH_DECKGL_ACCESSOR_MAP} from './graph-style-accessor-map';
