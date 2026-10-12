// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {CullingVolume} from '@math.gl/culling';
import {
  getOSMTileIndices,
  isOutsideCullingVolume
} from '../../src/shared-tile-2d-layer/deck-tile-traversal';

const viewport = new WebMercatorViewport({
  width: 256,
  height: 256,
  longitude: 0,
  latitude: 0,
  zoom: 1
});

describe('isOutsideCullingVolume', () => {
  it('reads math.gl 4 numeric results', () => {
    expect(isOutsideCullingVolume(-1)).toBe(true);
    expect(isOutsideCullingVolume(0)).toBe(false);
    expect(isOutsideCullingVolume(1)).toBe(false);
  });

  it('reads math.gl 5 string results', () => {
    expect(isOutsideCullingVolume('outside')).toBe(true);
    expect(isOutsideCullingVolume('intersecting')).toBe(false);
    expect(isOutsideCullingVolume('intersect')).toBe(false);
    expect(isOutsideCullingVolume('inside')).toBe(false);
  });
});

describe('getOSMTileIndices culling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects tiles in view with the installed math.gl', () => {
    expect(getOSMTileIndices(viewport, 1, null).length).toBeGreaterThan(0);
  });

  for (const outside of [-1, 'outside']) {
    it(`culls every tile when computeVisibility returns ${JSON.stringify(outside)}`, () => {
      vi.spyOn(CullingVolume.prototype, 'computeVisibility').mockReturnValue(outside as any);
      expect(getOSMTileIndices(viewport, 1, null)).toEqual([]);
    });
  }

  for (const visible of [0, 1, 'intersecting', 'inside']) {
    it(`keeps tiles when computeVisibility returns ${JSON.stringify(visible)}`, () => {
      vi.spyOn(CullingVolume.prototype, 'computeVisibility').mockReturnValue(visible as any);
      expect(getOSMTileIndices(viewport, 1, null).length).toBe(4);
    });
  }
});
