// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** The styles compared, by the URL their fixtures were recorded from. */
export const REFERENCE_STYLES = {
  'ofm-liberty': 'https://tiles.openfreemap.org/styles/liberty',
  'ofm-positron': 'https://tiles.openfreemap.org/styles/positron',
  'ofm-dark': 'https://tiles.openfreemap.org/styles/dark',
  'carto-positron': 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
} as const;

export type ReferenceStyleId = keyof typeof REFERENCE_STYLES;

/** One camera on one style, rendered by both MapLibre GL JS and `BasemapLayer`. */
export type ReferenceScene = {
  id: string;
  style: ReferenceStyleId;
  /** `[longitude, latitude]`. */
  center: [number, number];
  zoom: number;
  /** What the scene exercises. */
  note?: string;
};

/** Both renderers draw into a canvas of this size, in CSS pixels, at device pixel ratio 1. */
export const VIEWPORT = {width: 512, height: 512};

/**
 * The scenes checked by default (and in CI). Zoom fractions stay below .5 where possible: MapLibre
 * picks tiles at the integer zoom and deck.gl's `TileLayer` at the rounded zoom, so a fraction of
 * .5 or more makes `BasemapLayer` load the next zoom's tiles, which are larger fixtures.
 */
export const DEFAULT_SCENES: ReferenceScene[] = [
  {
    id: 'world-positron-z0.6',
    style: 'ofm-positron',
    center: [0, 20],
    zoom: 0.6,
    note: 'Whole world: country labels and boundaries'
  },
  {
    id: 'europe-liberty-z5.2',
    style: 'ofm-liberty',
    center: [10, 48],
    zoom: 5.2,
    note: 'Below z7 Liberty has a raster layer second in style order (visgl/deck.gl-community#816)'
  },
  {
    id: 'africa-positron-z3.6',
    style: 'ofm-positron',
    center: [20, 2],
    zoom: 3.6,
    note: 'Labels across a tile seam at 22.5°E (visgl/deck.gl-community#816)'
  },
  {
    id: 'paris-liberty-z13.3',
    style: 'ofm-liberty',
    center: [2.3417, 48.8575],
    zoom: 13.3,
    note: 'Dense city: fills, casings, road names along lines, POI icons'
  },
  {
    id: 'new-york-dark-z12.3',
    style: 'ofm-dark',
    center: [-73.985, 40.748],
    zoom: 12.3,
    note: 'Dark style: halos on a dark background'
  },
  {
    id: 'new-york-positron-z14.2',
    style: 'ofm-positron',
    center: [-73.99, 40.735],
    zoom: 14.2,
    note: 'Street grid with line-placed street names'
  },
  {
    id: 'tokyo-carto-positron-z12.3',
    style: 'carto-positron',
    center: [139.76, 35.68],
    zoom: 12.3,
    note: 'CARTO tiles and fonts; non-Latin labels'
  },
  {
    id: 'paris-carto-positron-z14.2',
    style: 'carto-positron',
    center: [2.3417, 48.8575],
    zoom: 14.2,
    note: 'CARTO street names along lines'
  }
];

const PLACES: Array<{id: string; center: [number, number]}> = [
  {id: 'paris', center: [2.3417, 48.8575]},
  {id: 'new-york', center: [-73.985, 40.748]},
  {id: 'tokyo', center: [139.76, 35.68]}
];

const EXTENDED_ZOOMS = [4.3, 8.3, 11.3, 13.3, 15.3];

/**
 * A larger set for local runs: every style at every place and zoom, plus a world view per style.
 * Its fixtures are recorded on demand (VITE_REFERENCE_RENDER_MODE=record) and not committed.
 */
export const EXTENDED_SCENES: ReferenceScene[] = (
  Object.keys(REFERENCE_STYLES) as ReferenceStyleId[]
).flatMap(style => [
  {
    id: `world-${style}-z0.6`,
    style,
    center: [0, 20] as [number, number],
    zoom: 0.6
  },
  ...PLACES.flatMap(place =>
    EXTENDED_ZOOMS.map(zoom => ({
      id: `${place.id}-${style}-z${zoom}`,
      style,
      center: place.center,
      zoom
    }))
  )
]);

/** Scenes selected by a comma-separated list of ids, or `default` / `extended` / `all`. */
export function selectScenes(selection: string | undefined): ReferenceScene[] {
  const value = (selection || 'default').trim();
  if (value === 'default') {
    return DEFAULT_SCENES;
  }
  if (value === 'extended') {
    return EXTENDED_SCENES;
  }
  const all = [...DEFAULT_SCENES, ...EXTENDED_SCENES];
  if (value === 'all') {
    return all;
  }
  const ids = value.split(',').map(id => id.trim());
  const scenes = all.filter(scene => ids.includes(scene.id));
  const unknown = ids.filter(id => !scenes.some(scene => scene.id === id));
  if (unknown.length) {
    throw new Error(`Unknown reference scenes: ${unknown.join(', ')}`);
  }
  return scenes;
}
