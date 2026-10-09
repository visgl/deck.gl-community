// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {normalizeTextMaxWidth} from '../../src/layers/common-layers/zoomable-text-layer/zoomable-text-layer';

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
  it.each([-1, 0, 0.5, 12, 120, 50000])('preserves supported scalar width %s', value => {
    expect(normalizeTextMaxWidth(value)).toBe(value);
  });
});
