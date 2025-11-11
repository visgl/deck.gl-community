// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, it, expect, vi} from 'vitest';

import {
  GraphStylesheetEngine,
  GraphStylesheetSchema,
  type GraphStylesheet
} from '../../src/style/graph-style-engine';
import {log as graphLog} from '../../src/utils/log';

function mockWarn() {
  return vi.spyOn(graphLog, 'warn').mockImplementation(() => graphLog);
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(() => new GraphStylesheetEngine(stylesheet)).not.toThrow();
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

    const warnSpy = mockWarn();
    const stylesheet = new GraphStylesheetEngine(invalidStylesheet);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown style property "foo"')
    );
    const getFillColor = stylesheet.getDeckGLAccessor('getFillColor');
    const fillValue =
      typeof getFillColor === 'function' ? getFillColor({state: 'default'}) : getFillColor;
    expect(fillValue).toEqual([0, 0, 0]);
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
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => /Unrecognized key/.test(message) && message.includes('unknown'))).toBe(true);

    const warnSpy = mockWarn();
    const stylesheet = new GraphStylesheetEngine(invalidSelectorStylesheet);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/:hover/));
    const getFillColor = stylesheet.getDeckGLAccessor('getFillColor');
    const fillValue = typeof getFillColor === 'function' ? getFillColor({state: 'hover'}) : getFillColor;
    expect(fillValue).toEqual([0, 0, 0]);
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

    const warnSpy = mockWarn();
    const stylesheet = new GraphStylesheetEngine(invalidAttributeReference);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('radius.attribute')
    );
    const getRadius = stylesheet.getDeckGLAccessor('getRadius');
    const radiusValue = typeof getRadius === 'function' ? getRadius({state: 'default'}) : getRadius;
    expect(radiusValue).toBe(1);
  });
});
