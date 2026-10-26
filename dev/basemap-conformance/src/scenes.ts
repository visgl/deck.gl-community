// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ConformanceScene} from './types';

/** Every renderer draws into a canvas of this size, in CSS pixels, at device pixel ratio 1. */
export const VIEWPORT = {width: 512, height: 512};

/**
 * The styles of the corpus, by id: the fixture path of the style JSON (under a fixture root), and
 * where it came from. Every renderer receives the same resolved JSON (see `loadConformanceStyle`).
 */
export const STYLES: Record<string, {fixture: string; origin: string}> = {
  /**
   * tangram.gl's Streets example as a static MapLibre style: the output of
   * `createComparisonStyle('streetsVector', 'mapFlat', 'openfreemap', {labels: true})` from
   * tangram.gl's `examples/deck/comparison-style.ts`, serialized to JSON. It holds the Streets
   * palette, road grades and widths, and a `place` name layer mirroring Tangram's `places` layer.
   */
  'tangram-streets': {
    fixture: 'styles/tangram-streets.json',
    origin: 'https://github.com/visgl/tangram.gl/blob/master/examples/deck/comparison-style.ts'
  },
  /** basemap-layers' own reference styles, read from its committed fixtures. */
  'ofm-liberty': {
    fixture: 'styles/ofm-liberty.json',
    origin: 'https://tiles.openfreemap.org/styles/liberty'
  },
  'ofm-positron': {
    fixture: 'styles/ofm-positron.json',
    origin: 'https://tiles.openfreemap.org/styles/positron'
  }
};

/**
 * The scenes. Zoom fractions stay below .5: MapLibre picks tiles at the integer zoom and deck.gl's
 * `TileLayer` at the rounded zoom, so a fraction of .5 or more makes deck.gl renderers load the
 * next zoom's tiles.
 */
export const SCENES: ConformanceScene[] = [
  {
    id: 'world-streets-z1.3',
    style: 'tangram-streets',
    center: [10, 30],
    zoom: 1.3,
    note: 'Low zoom: landcover, water, country and continent names'
  },
  {
    id: 'europe-streets-z4.3',
    style: 'tangram-streets',
    center: [10, 48],
    zoom: 4.3,
    note: 'Regional: major roads, city names, tile seams'
  },
  {
    id: 'tokyo-streets-z11.3',
    style: 'tangram-streets',
    center: [139.76, 35.68],
    zoom: 11.3,
    note: 'Metro: road hierarchy, non-Latin place names'
  },
  {
    id: 'paris-streets-z13.3',
    style: 'tangram-streets',
    center: [2.3417, 48.8575],
    zoom: 13.3,
    note: 'Dense city: buildings (z13+), road grades, river'
  },
  {
    id: 'new-york-streets-z14.2',
    style: 'tangram-streets',
    center: [-73.99, 40.735],
    zoom: 14.2,
    note: 'Street grid, buildings, overzoomed z14 data'
  },
  // Control scenes: basemap-layers' own reference scenes, rendered by the shared runner. Their
  // scores must match `modules/basemap-layers/tests/reference-render` (same fixtures, same
  // metrics), which checks that the shared runner measures what the original harness measures.
  {
    id: 'paris-liberty-z13.3',
    style: 'ofm-liberty',
    center: [2.3417, 48.8575],
    zoom: 13.3,
    note: 'Control: basemap-layers reference scene'
  },
  {
    id: 'new-york-positron-z14.2',
    style: 'ofm-positron',
    center: [-73.99, 40.735],
    zoom: 14.2,
    note: 'Control: basemap-layers reference scene'
  }
];

/** Scenes selected by a comma-separated list of ids or style ids, or `all` (the default). */
export function selectScenes(selection: string | undefined): ConformanceScene[] {
  const value = (selection || 'all').trim();
  if (value === 'all') {
    return SCENES;
  }
  const ids = value.split(',').map(id => id.trim());
  const scenes = SCENES.filter(scene => ids.includes(scene.id) || ids.includes(scene.style));
  const unknown = ids.filter(id => !SCENES.some(scene => scene.id === id || scene.style === id));
  if (unknown.length) {
    throw new Error(`Unknown conformance scenes: ${unknown.join(', ')}`);
  }
  return scenes;
}
