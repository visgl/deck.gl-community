// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {
  GraphStyleEngine,
  GraphStylesheetSchema,
  type GraphStylesheet
} from '../../src/style/graph-style-engine';

describe('GraphStylesheetSchema', () => {
  it('accepts a valid stylesheet definition', () => {
    const stylesheet: GraphStylesheet<'circle'> = {
      type: 'circle',
      fill: '#ffffff',
      radius: {
        default: 4,
        hover: 8
      },
      ':hover': {
        stroke: '#0f172a'
      }
    };

    expect(() => GraphStylesheetSchema.parse(stylesheet)).not.toThrow();
    expect(() => new GraphStyleEngine(stylesheet)).not.toThrow();
  });

  it('reports unknown properties', () => {
    const invalidStylesheet = {
      type: 'circle',
      foo: 'bar'
    } as unknown as GraphStylesheet;

    const result = GraphStylesheetSchema.safeParse(invalidStylesheet);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain(
      'Unknown style property "foo".'
    );

    expect(() => new GraphStyleEngine(invalidStylesheet)).toThrowError(
      /Unknown style property "foo"/i
    );
  });

  it('validates selector overrides', () => {
    const invalidSelectorStylesheet = {
      type: 'circle',
      ':hover': {
        unknown: '#ffffff'
      }
    } as unknown as GraphStylesheet;

    const result = GraphStylesheetSchema.safeParse(invalidSelectorStylesheet);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain(
      "Unrecognized key(s) in object: 'unknown'"
    );

    expect(() => new GraphStyleEngine(invalidSelectorStylesheet)).toThrowError(
      /:hover.*unknown/i
    );
  });

  it('validates attribute references', () => {
    const invalidAttributeReference = {
      type: 'circle',
      radius: {
        attribute: '',
        fallback: 4
      }
    } as unknown as GraphStylesheet;

    const result = GraphStylesheetSchema.safeParse(invalidAttributeReference);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain(
      'Attribute name is required.'
    );

    expect(() => new GraphStyleEngine(invalidAttributeReference)).toThrowError(
      /radius\.attribute.*Attribute name is required\./i
    );
  });
});
