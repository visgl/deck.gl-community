// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  _GlobeViewport as GlobeViewport,
  OrthographicViewport,
  WebMercatorViewport
} from '@deck.gl/core';
import {isGlobeViewport} from '../../src/index';

const camera = {width: 256, height: 256, longitude: 10, latitude: 20, zoom: 2};

describe('isGlobeViewport', () => {
  it('detects a deck.gl 9.4 GlobeViewport (resolution 10)', () => {
    const viewport = new GlobeViewport(camera);
    expect(viewport.resolution).toBe(10);
    expect(isGlobeViewport(viewport)).toBe(true);
  });

  it('detects a GlobeViewport with resolution 0, the deck.gl v10 default', () => {
    const viewport = new GlobeViewport({...camera, resolution: 0});
    expect(viewport.resolution).toBe(0);
    expect(isGlobeViewport(viewport)).toBe(true);
  });

  it('does not detect a WebMercatorViewport', () => {
    expect(isGlobeViewport(new WebMercatorViewport(camera))).toBe(false);
  });

  it('does not detect a WebMercatorViewport that has a resolution (deck.gl v10)', () => {
    // deck.gl freezes a WebMercatorViewport, so a derived object carries the v10 field.
    const viewport = Object.create(new WebMercatorViewport(camera), {resolution: {value: 36}});
    expect(isGlobeViewport(viewport)).toBe(false);
  });

  it('does not detect a non-geospatial viewport', () => {
    expect(isGlobeViewport(new OrthographicViewport({width: 256, height: 256}))).toBe(false);
  });

  it('falls back to instanceof when projectionMode is not a number', () => {
    const viewport = new GlobeViewport({...camera, resolution: 0});
    Object.defineProperty(viewport, 'projectionMode', {value: undefined});
    expect(isGlobeViewport(viewport)).toBe(true);
    expect(isGlobeViewport({resolution: 10})).toBe(false);
  });

  it('returns false for a missing viewport', () => {
    expect(isGlobeViewport(null)).toBe(false);
    expect(isGlobeViewport(undefined)).toBe(false);
  });
});
