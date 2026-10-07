/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}
};

function point(properties: Record<string, unknown>) {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [0, 0]},
    properties: {layerName: 'place', name: 'n', ...properties}
  };
}

describe('label priority across style layers', () => {
  test("a later style layer's labels outrank an earlier layer's, whatever their sort keys", () => {
    const vectorLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 8,
      styleDefinition: {
        version: 8,
        sources: SOURCES,
        layers: [
          {
            id: 'pois',
            type: 'symbol',
            source: 'tiles',
            'source-layer': 'place',
            filter: ['==', ['get', 'kind'], 'poi'],
            layout: {'text-field': '{name}', 'symbol-sort-key': ['get', 'rank']}
          },
          {
            id: 'cities',
            type: 'symbol',
            source: 'tiles',
            'source-layer': 'place',
            filter: ['==', ['get', 'kind'], 'city'],
            layout: {'text-field': '{name}'}
          }
        ]
      } as any
    }).find(layer => layer.id === 'test-tiles');

    const features = [
      point({kind: 'poi', rank: -1e6}),
      point({kind: 'poi', rank: 1}),
      point({kind: 'city', class: 'village'})
    ];
    const [pois, cities] = vectorLayer.props
      .renderSubLayers({id: 'tile', data: features, tile: {index: {x: 0, y: 0, z: 8}}})
      .filter(Boolean);

    const poiPriorities = pois.props.data.map((f: any) => pois.getLabelCollisionPriority(f));
    const cityPriorities = cities.props.data.map((f: any) => cities.getLabelCollisionPriority(f));
    expect(Math.min(...cityPriorities)).toBeGreaterThan(Math.max(...poiPriorities));
  });
});
