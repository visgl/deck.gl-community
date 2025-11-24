// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-continue */  

import {ZodError, type ZodIssue} from 'zod';

import {StylesheetEngine, type DeckGLUpdateTriggers} from './stylesheet-engine';
import {
  GraphStyleRuleSchema,
  type GraphStyleRule,
  type GraphStyleRuleParsed
} from './graph-stylesheet.schema';
import {GRAPH_DECKGL_ACCESSOR_MAP} from './graph-style-accessor-map';
import {warn} from '../utils/log';

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

export class GraphStylesheetEngine extends StylesheetEngine {
  constructor(style: GraphStyleRule, {stateUpdateTrigger}: {stateUpdateTrigger?: unknown} = {}) {
    const result = GraphStyleRuleSchema.safeParse(style);
    const parsedStyle = result.success
      ? result.data
      : sanitizeStylesheet(style, result.error.issues);

    super(parsedStyle as GraphStyleRule, {
      deckglAccessorMap: GRAPH_DECKGL_ACCESSOR_MAP,
      deckglUpdateTriggers: GRAPH_DECKGL_UPDATE_TRIGGERS,
      stateUpdateTrigger
    });
  }
}

export const GraphStyleEngine = GraphStylesheetEngine;
export type GraphStyleEngine = GraphStylesheetEngine;

export {
  GraphStyleScaleTypeEnum,
  GraphStyleScaleSchema,
  GraphStyleAttributeReferenceSchema,
  GraphStyleLeafValueSchema,
  GraphStyleStateMapSchema,
  GraphStyleValueSchema,
  GraphStylesheetSchema,
  GraphStyleRuleSchema
} from './graph-stylesheet.schema';

export type {
  GraphStylesheet,
  GraphStylesheetInput,
  GraphStyleRule,
  GraphStyleRuleInput,
  GraphStyleRuleParsed,
  GraphStyleSelector,
  GraphStyleType,
  GraphStyleAttributeReference,
  GraphStyleLeafValue,
  GraphStyleScale,
  GraphStyleScaleType,
  GraphStyleValue
} from './graph-stylesheet.schema';

export {GRAPH_DECKGL_ACCESSOR_MAP} from './graph-style-accessor-map';

// eslint-disable-next-line max-statements, complexity
function sanitizeStylesheet(style: GraphStyleRule, issues: ZodIssue[]): GraphStyleRuleParsed {
  if (issues.length) {
    const details = issues
      .map((issue) => {
        const path = issue.path.length ? issue.path.join('.') : 'root';
        return `${path}: ${issue.message}`;
      })
      .join('\n  • ');
    warn(`GraphStyleEngine: stylesheet issues detected:\n  • ${details}`);
  }

  const fallbackTypeCandidate =
    typeof (style as {type?: unknown}).type === 'string' ? (style as {type: string}).type : undefined;
  const fallbackCandidates = Array.from(
    new Set(
      [fallbackTypeCandidate, 'edge'].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    )
  );

  for (const candidate of fallbackCandidates) {
    const sanitized = cloneValue(style) as Record<string, unknown>;
    sanitized.type = candidate;

    for (const issue of issues) {
      if (!Array.isArray(issue.path) || issue.path.length === 0) {
        continue;
      }

      const path = issue.path.filter(
        (segment): segment is string | number =>
          typeof segment === 'string' || typeof segment === 'number'
      );

      if (path.length === 0) {
        continue;
      }

      const [rootKey] = path;
      if (rootKey === undefined || rootKey === 'type') {
        continue;
      }
    
      if (typeof rootKey === 'string' && rootKey.startsWith(':')) {
        removeNestedProperty(sanitized, path);
        continue;
      }

      if (typeof rootKey !== 'string') {
        continue;
      }

      delete sanitized[rootKey];
    }

    const result = GraphStyleRuleSchema.safeParse(sanitized);
    if (result.success) {
      return result.data;
    }
  }

  // If every fallback failed, rethrow the detailed error so callers know parsing was impossible.
  throw new Error(formatStylesheetError(new ZodError(issues)));
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      return new Date(value) as unknown as T;
    }
    if (value instanceof RegExp) {
      return new RegExp(value.source, value.flags) as unknown as T;
    }
    const cloned: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      cloned[key] = cloneValue(entryValue);
    }
    return cloned as unknown as T;
  }
  return value;
}

// eslint-disable-next-line max-statements, complexity
function removeNestedProperty(target: Record<string, unknown> | unknown[], path: (string | number)[]) {
  if (path.length === 0) {
    return;
  }

  const [head, ...rest] = path;
  if (head === undefined) {
    return;
  }

  if (Array.isArray(target)) {
    const index = typeof head === 'number' ? head : Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= target.length) {
      return;
    }
    if (rest.length === 0) {
      target.splice(index, 1);
      return;
    }
    const child = target[index];
    if (!child || typeof child !== 'object') {
      target.splice(index, 1);
      return;
    }
    removeNestedProperty(child as Record<string, unknown> | unknown[], rest);
    if (isEmptyObject(child)) {
      target.splice(index, 1);
    }
    return;
  }

  const recordTarget = target;

  if (rest.length === 0) {
    delete recordTarget[head as keyof typeof recordTarget];
    return;
  }

  const child = recordTarget[head as keyof typeof recordTarget];
  if (!child || typeof child !== 'object') {
    delete recordTarget[head as keyof typeof recordTarget];
    return;
  }

  removeNestedProperty(child as Record<string, unknown> | unknown[], rest);

  if (isEmptyObject(child)) {
    delete recordTarget[head as keyof typeof recordTarget];
  }
}

function isEmptyObject(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.keys(value as Record<string, unknown>).length === 0;
}
