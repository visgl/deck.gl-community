// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {normalizeTextMaxWidth} from '../../src/layers/common-layers/zoomable-text-layer/zoomable-text-layer';

const TEXT_LAYER_MAX_SAFE_WIDTH = 32767;

describe('ZoomableTextLayer helpers', () => {
  it('normalizes invalid max width values to a safe TextLayer width', () => {
    expect(normalizeTextMaxWidth(undefined)).toBe(TEXT_LAYER_MAX_SAFE_WIDTH);
    expect(normalizeTextMaxWidth(Number.NaN)).toBe(TEXT_LAYER_MAX_SAFE_WIDTH);
    expect(normalizeTextMaxWidth(0)).toBe(TEXT_LAYER_MAX_SAFE_WIDTH);
    expect(normalizeTextMaxWidth(-1)).toBe(TEXT_LAYER_MAX_SAFE_WIDTH);
  });

  it('clamps large max width values to TextLayer attribute limits', () => {
    expect(normalizeTextMaxWidth(100)).toBe(100);
    expect(normalizeTextMaxWidth('120')).toBe(120);
    expect(normalizeTextMaxWidth(50000)).toBe(TEXT_LAYER_MAX_SAFE_WIDTH);
  });

  it('normalizes max width accessors per datum', () => {
    const getMaxWidth = normalizeTextMaxWidth((d: {width?: unknown}) => d.width);

    expect(getMaxWidth({width: 32})).toBe(32);
    expect(getMaxWidth({width: '64'})).toBe(64);
    expect(getMaxWidth({width: Number.NaN})).toBe(TEXT_LAYER_MAX_SAFE_WIDTH);
    expect(getMaxWidth({width: 50000})).toBe(TEXT_LAYER_MAX_SAFE_WIDTH);
  });
});
