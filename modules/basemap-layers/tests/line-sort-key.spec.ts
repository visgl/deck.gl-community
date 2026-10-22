/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

function road(properties: Record<string, unknown> = {}): any {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: {layerName: 'roads', ...properties}
  };
}

function line(id: string, paint = {}, layout = {}, filter?: unknown[]): any {
  return {
    id,
    type: 'line',
    source: 'tiles',
    'source-layer': 'roads',
    ...(filter ? {filter} : {}),
    paint: {'line-width': 2, ...paint},
    layout
  };
}

/** The sublayers of one tile, flattened. */
function render(layers: any[], features: any[], zoom = 12, mode: 'map' | 'globe' = 'map'): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode,
    zoom,
    styleDefinition: {version: 8, sources: SOURCES, layers} as any
  }).find(layer => layer.id === 'test-tiles');
  return vectorLayer.props
    .renderSubLayers({id: 'test-tiles-tile', data: features, tile: {index: {x: 0, y: 0, z: 12}}})
    .flat(Infinity)
    .filter(Boolean);
}

const SORT_KEY = {'line-sort-key': ['get', 'key']};

describe('line-sort-key', () => {
  test('draws features in ascending key order, ties in tile order, on a map and a globe', () => {
    const features = [road({key: 2}), road({key: 1}), road({key: 2}), road({key: -1})];
    for (const mode of ['map', 'globe'] as const) {
      const [layer] = render([line('roads', {}, SORT_KEY)], features, 12, mode);
      expect(layer.props.data).toEqual([features[3], features[1], features[0], features[2]]);
    }
  });

  test('keeps tile order without a key, or with a constant one', () => {
    const features = [road({key: 2}), road({key: 1})];
    expect(render([line('roads')], features)[0].props.data).toEqual(features);
    const constant = render([line('roads', {}, {'line-sort-key': 3})], features)[0];
    expect(constant.props.data).toEqual(features);
  });

  test('reuses the sorted features across zoom steps, and sorts again when the key changes', () => {
    const features = [road({key: 2}), road({key: 1})];
    const layers = [line('roads', {}, {...SORT_KEY})];
    const data = render(layers, features, 12)[0].props.data;
    expect(render(layers, features, 12.25)[0].props.data).toBe(data);
    layers[0].layout['line-sort-key'] = ['-', 0, ['get', 'key']];
    expect(render(layers, features, 12.25)[0].props.data).toEqual(features);
  });

  test('sorts dashed, offset and gap lines, and both sides of a gap', () => {
    const features = [road({key: 2}), road({key: 1})];
    const sorted = [features[1], features[0]];
    for (const paint of [
      {'line-dasharray': [2, 1]},
      {'line-offset': 2},
      {'line-blur': 1},
      {'line-gap-width': 3}
    ]) {
      const layers = render([line('roads', paint, SORT_KEY)], features);
      expect(layers.length).toBeGreaterThan(0);
      for (const layer of layers) {
        expect(layer.props.data).toEqual(sorted);
      }
    }
  });

  test('sorts each style layer of a batch within its own part', () => {
    const features = [
      road({kind: 'a', key: 2}),
      road({kind: 'b', key: 2}),
      road({kind: 'a', key: 1}),
      road({kind: 'b', key: 1})
    ];
    const layers = render(
      [
        line('a', {}, SORT_KEY, ['==', ['get', 'kind'], 'a']),
        line('b', {}, SORT_KEY, ['==', ['get', 'kind'], 'b'])
      ],
      features
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].props.data).toEqual([features[2], features[0], features[3], features[1]]);
  });

  test('sorts each line shape group of a data-driven cap', () => {
    const features = [
      road({cap: 'round', key: 2}),
      road({cap: 'butt', key: 3}),
      road({cap: 'round', key: 1}),
      road({cap: 'butt', key: 0})
    ];
    const layers = render([line('roads', {}, {...SORT_KEY, 'line-cap': ['get', 'cap']})], features);
    expect(layers.map(layer => layer.props.data)).toEqual([
      [features[3], features[1]],
      [features[2], features[0]]
    ]);
  });
});
