// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {normalizeTextMaxWidth} from '../../src/layers/common-layers/zoomable-text-layer/zoomable-text-layer';

import {GraphStylesheetEngine} from '../../src/style/graph-style-engine';

describe('ZoomableTextLayer wrapping width', () => {
  it.each([
    undefined,
    null,
    Number.NaN,
    Infinity,
    -Infinity,
    '120',
    {},
    () => 32
  ])('preserves the default for unsupported width %s', value => {
    expect(normalizeTextMaxWidth(value)).toBe(12);
  });
  it.each([
    'label',
    'edge-label'
  ] as const)('preserves configured %s stylesheet widths as scalars', type => {
    for (const width of [-1, 0, 120, 50000]) {
      const stylesheet = new GraphStylesheetEngine({type, textMaxWidth: width});
      expect(stylesheet.getDeckGLAccessor('textMaxWidth')).toBe(width);
      expect(normalizeTextMaxWidth(stylesheet.getDeckGLAccessors().textMaxWidth)).toBe(width);
    }
  });

  it.each([-1, 0, 0.5, 12, 120, 50000])('preserves supported scalar width %s', value => {
    expect(normalizeTextMaxWidth(value)).toBe(value);
  });
});
