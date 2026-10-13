/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const feature = (layerName: string, name: string) => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1]
    ]
  },
  properties: {layerName, name}
});

function createStyle(styleLayers: any[]): any {
  return {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: styleLayers.map(layer => ({type: 'line', source: 'tiles', ...layer}))
  };
}

function tileSubLayers(
  styleLayers: any[],
  features: any[],
  zoom = 12,
  style = createStyle(styleLayers)
) {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: style
  }).find((layer: any) => layer.id === 'test-tiles');
  return vectorLayer.props
    .renderSubLayers({id: 'test-tiles-tile', data: features, tile: {index: {x: 0, y: 0, z: 12}}})
    .filter(Boolean);
}

const names = (layer: any) => layer.props.data.map((f: any) => f.properties.name);

describe('tile features by source layer', () => {
  const features = [
    feature('roads', 'r1'),
    feature('rivers', 'w1'),
    feature('roads', 'r2'),
    feature('rivers', 'w2'),
    feature('roads', 'r3')
  ];

  test('each style layer draws the features of its source layer, in tile order', () => {
    // Different caps keep the style layers in sublayers of their own (see layer-batching.spec).
    const [roads, rivers, filtered] = tileSubLayers(
      [
        {id: 'roads', 'source-layer': 'roads', layout: {'line-cap': 'butt'}},
        {id: 'rivers', 'source-layer': 'rivers', layout: {'line-cap': 'round'}},
        {
          id: 'some-roads',
          'source-layer': 'roads',
          layout: {'line-cap': 'butt'},
          filter: ['!=', ['get', 'name'], 'r2']
        }
      ],
      features
    );
    expect(names(roads)).toEqual(['r1', 'r2', 'r3']);
    expect(names(rivers)).toEqual(['w1', 'w2']);
    expect(names(filtered)).toEqual(['r1', 'r3']);
  });

  test('a source layer the tile lacks draws nothing', () => {
    expect(tileSubLayers([{id: 'rails', 'source-layer': 'rails'}], features)).toEqual([]);
  });

  test('the same tile content keeps its feature arrays across zoom steps', () => {
    const layers = [{id: 'roads', 'source-layer': 'roads', filter: ['has', 'name']}];
    const style = createStyle(layers);
    const [before] = tileSubLayers(layers, features, 12.1, style);
    const [after] = tileSubLayers(layers, features, 12.6, style);
    expect(after.props.data).toBe(before.props.data);
  });

  test('tile content edited in place is split again', () => {
    const content = [feature('roads', 'r1'), feature('rivers', 'w1')];
    const layers = [{id: 'roads', 'source-layer': 'roads'}];
    // The same style, so that the same style layer filters the content again.
    const style = createStyle(layers);
    const [first] = tileSubLayers(layers, content, 12, style);
    expect(names(first)).toEqual(['r1']);
    content.push(feature('roads', 'r2'));
    const [second] = tileSubLayers(layers, content, 12, style);
    expect(names(second)).toEqual(['r1', 'r2']);
    // With a new style too.
    const [third] = tileSubLayers(layers, content);
    expect(names(third)).toEqual(['r1', 'r2']);
  });

  test('each style layer of a tile is filtered by its own filter at a new integer zoom', () => {
    // Different caps keep the style layers in sublayers of their own (see layer-batching.spec).
    const layers = [
      {id: 'roads', 'source-layer': 'roads', layout: {'line-cap': 'butt'}},
      {
        id: 'late-rivers',
        'source-layer': 'rivers',
        layout: {'line-cap': 'round'},
        filter: ['>=', ['zoom'], 13]
      }
    ];
    const style = createStyle(layers);
    expect(tileSubLayers(layers, features, 12.1, style).map(names)).toEqual([['r1', 'r2', 'r3']]);
    expect(tileSubLayers(layers, features, 13.1, style).map(names)).toEqual([
      ['r1', 'r2', 'r3'],
      ['w1', 'w2']
    ]);
  });
});
