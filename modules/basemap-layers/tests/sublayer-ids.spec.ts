// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const FEATURES = [
  {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: {kind: 'a', name: 'n', height: 10}
  },
  {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [1, 0],
        [0, 1]
      ]
    },
    properties: {kind: 'b', name: 'n', height: 10}
  },
  {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [0.5, 0.5]},
    properties: {kind: 'a', name: 'n'}
  },
  {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0]
        ]
      ]
    },
    properties: {kind: 'a', height: 10}
  }
];

/** A line with a gap, split into two per-feature line shape groups. */
const ROAD = {
  id: 'road',
  type: 'line',
  source: 'tiles',
  layout: {'line-cap': ['match', ['get', 'kind'], 'a', 'round', 'butt']},
  paint: {'line-gap-width': 4}
};
/** A line with a gap and one line shape. */
const RAIL = {id: 'rail', type: 'line', source: 'tiles', paint: {'line-gap-width': 4}};
const LABEL = {id: 'place', type: 'symbol', source: 'tiles', layout: {'text-field': '{name}'}};
const CIRCLE = {id: 'poi', type: 'circle', source: 'tiles'};
const EXTRUSION = {
  id: 'building',
  type: 'fill-extrusion',
  source: 'tiles',
  paint: {'fill-extrusion-height': ['get', 'height']}
};
const BASE_LAYERS = [ROAD, RAIL, LABEL, CIRCLE, EXTRUSION];

/**
 * Style layers named after the base layers plus each suffix that a generated layer appends: the
 * second side of a gap, line shape groups, and deck.gl's composite sublayers.
 */
const SUFFIXES = [
  'gap',
  'true-false-1',
  'false-false-1',
  'true-false-1-gap',
  'linestrings',
  'polygons-fill',
  'points-circle',
  'geojson',
  'text',
  'icons-default'
];

const STYLE_LAYERS = [
  ...BASE_LAYERS,
  ...BASE_LAYERS.flatMap(base =>
    SUFFIXES.map(suffix => ({...RAIL, paint: {}, id: `${base.id}-${suffix}`}))
  )
];

/** Each style layer's sublayers in one tile, in style order. */
function renderTile(
  styleLayers: Record<string, unknown>[] = STYLE_LAYERS,
  tileProps: Record<string, unknown> = {}
): any[][] {
  // A layer after a label layer starts another tile layer of the source (see `getStyleLayerRuns`).
  const vectorLayers: any[] = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 12,
    styleDefinition: {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: styleLayers
    } as any
  }).filter(layer => layer.id.startsWith('test-tiles'));
  // A tile layer's sublayers come as one list; each records the style layer of the run it draws.
  return vectorLayers.flatMap(vectorLayer => {
    const subLayers: any[] = vectorLayer.props.renderSubLayers({
      id: `${vectorLayer.id}-0-0-12`,
      data: FEATURES,
      tile: {index: {x: 0, y: 0, z: 12}},
      ...tileProps
    });
    const byStyleLayer = new Map<number, any[]>();
    for (const layer of subLayers.flat(Infinity)) {
      const index = layer.props.styleLayerIndex;
      byStyleLayer.set(index, [...(byStyleLayer.get(index) || []), layer]);
    }
    return [...byStyleLayer].sort(([a], [b]) => a - b).map(([, layers]) => layers);
  });
}

/**
 * Ids of one style layer's sublayers that extend an id of another style layer's sublayers.
 * deck.gl names composite sublayers `<id>-<name>`, so these are the ids that can collide.
 */
function getExtendedIds(tile: any[][]): string[] {
  const extended: string[] = [];
  tile.forEach((layers, index) => {
    tile.forEach((otherLayers, otherIndex) => {
      for (const layer of index === otherIndex ? [] : layers) {
        for (const other of otherLayers) {
          if (other.id.startsWith(`${layer.id}-`)) {
            extended.push(`${other.id} extends ${layer.id}`);
          }
        }
      }
    });
  });
  return extended;
}

describe('tile sublayer ids', () => {
  test('the base layers generate the suffixes that the other style layers are named after', () => {
    const [road, rail] = renderTile(BASE_LAYERS);
    // Two line shape groups, each with its gap side.
    expect(road).toHaveLength(4);
    // One line shape and its gap side.
    expect(rail).toHaveLength(2);
    const roadId = road[0].id.replace(/-true-false-1$/, '');
    expect(road.map(layer => layer.id)).toEqual([
      `${roadId}-true-false-1`,
      `${roadId}-true-false-1-gap`,
      `${roadId}-false-false-1`,
      `${roadId}-false-false-1-gap`
    ]);
    expect(rail[1].id).toBe(`${rail[0].id}-gap`);
  });

  test('are unique across the style layers of a tile', () => {
    const tile = renderTile();
    expect(tile).toHaveLength(STYLE_LAYERS.length);
    const ids = tile.flat().map(layer => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("no style layer's id extends another's, so deck.gl's sublayer ids cannot collide", () => {
    expect(getExtendedIds(renderTile())).toEqual([]);
  });

  test('style layer ids are kept apart whatever characters they contain', () => {
    const styleLayerIds = ['a', 'a"', 'a"-gap', 'a\\', 'a\\"', 'a\\"-gap', '"a"', 'a b', ''];
    const tile = renderTile(styleLayerIds.map(id => ({...RAIL, id})));
    expect(tile).toHaveLength(styleLayerIds.length);
    const ids = tile.flat().map(layer => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getExtendedIds(tile)).toEqual([]);
  });
});
