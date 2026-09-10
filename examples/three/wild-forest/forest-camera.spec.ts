// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport, _GlobeViewport} from '@deck.gl/core';
import {describe, expect, it, vi} from 'vitest';
import {
  getGroveBoundsPoints,
  getGroveView,
  pickTreeAtPixel,
  createGroveFlight
} from './forest-camera';
import {createTreeSamples, FOREST_SITES} from './forest-data';

describe('grove camera', () => {
  it('projects geography once and reuses a fitted camera on repeat selection', () => {
    const grove = createTreeSamples().filter(tree => tree.siteId === 'siwa');
    const projection = vi.spyOn(WebMercatorViewport.prototype, 'projectFlat');
    try {
      const fitted = getGroveView(grove, 900, 600);
      // The old nested fit projected 400 × 8 corners × 88 trial cameras.
      expect(projection.mock.calls.length).toBeLessThan(1000);
      projection.mockClear();
      expect(getGroveView(grove, 900, 600)).toEqual(fitted);
      expect(projection).not.toHaveBeenCalled();
      getGroveView(grove, 390, 740);
      expect(projection).toHaveBeenCalled();
    } finally {
      projection.mockRestore();
    }
  });
  it('flies out and back in without enlarging models or losing the altitude target', () => {
    const trees = createTreeSamples();
    const from = getGroveView(
      trees.filter(tree => tree.siteId === 'siwa'),
      900,
      600
    );
    const to = getGroveView(
      trees.filter(tree => tree.siteId === 'kyoto'),
      900,
      600
    );
    const flight = createGroveFlight(from, to, 900, 600);
    const midpoint = flight(0.5);
    expect(flight(0).longitude).toBeCloseTo(from.longitude);
    expect(midpoint.zoom).toBeLessThan(12);
    expect(midpoint.longitude).toBeGreaterThan(from.longitude);
    expect(midpoint.longitude).toBeLessThan(to.longitude);
    expect(midpoint.position![2]).toBeCloseTo((from.position![2] + to.position![2]) / 2);
    expect(flight(1)).toEqual(to);
    const westbound = createGroveFlight(to, {...from, longitude: -119.58}, 900, 600);
    expect(westbound(0.5).longitude).toBeGreaterThan(to.longitude);
    expect(westbound(1).longitude).toBe(-119.58);
  });
  it('picks local crowns without making distant, invisible trees clickable', () => {
    const trees = createTreeSamples();
    const grove = trees.filter(tree => tree.siteId === 'alentejo');
    const view = getGroveView(grove, 900, 600);
    const viewport = new WebMercatorViewport({...view, width: 900, height: 600});
    const oak = grove[12];
    const [x, y] = viewport.project([oak.position[0], oak.position[1], oak.height * 0.65]);
    expect(pickTreeAtPixel(trees, viewport, view, x, y)?.siteId).toBe('alentejo');
    const globeView = {longitude: -20, latitude: 25, zoom: 1.3};
    const globeViewport = new _GlobeViewport({...globeView, width: 900, height: 600});
    const [globeX, globeY] = globeViewport.project(oak.position);
    expect(pickTreeAtPixel(trees, globeViewport, globeView, globeX, globeY)).toBeUndefined();
    expect(pickTreeAtPixel(trees, viewport, view, 0, 0)).toBeUndefined();
  });
  it.each([
    {width: 900, height: 600},
    {width: 390, height: 740},
    {width: 664, height: 560}
  ])('centers full 3D groves inside the controls at $width × $height', ({width, height}) => {
    for (const site of FOREST_SITES) {
      const trees = createTreeSamples().filter(tree => tree.siteId === site.id);
      const view = getGroveView(trees, width, height);
      const viewport = new WebMercatorViewport({...view, width, height});
      const pixels = getGroveBoundsPoints(trees).map(point => viewport.project(point));
      const xs = pixels.map(point => point[0]);
      const ys = pixels.map(point => point[1]);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(23.9);
      expect(Math.max(...xs)).toBeLessThanOrEqual(width - 23.9);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(119.9);
      expect(Math.max(...ys)).toBeLessThanOrEqual(height - 89.9);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(width / 2, 0);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo((height + 30) / 2, 0);
      expect(view.position![2]).toBeGreaterThan(0);
    }
  });
});
