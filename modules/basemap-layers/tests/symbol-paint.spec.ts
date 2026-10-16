/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}
};

const feature = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0, 0]},
  properties: {layerName: 'place', name: 'A'}
};

/** Renders one symbol style layer for one tile and returns its label sublayer. */
function labelSublayer(paint: Record<string, unknown>): any {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 8,
    styleDefinition: {
      version: 8,
      sources: SOURCES,
      layers: [
        {
          id: 'places',
          type: 'symbol',
          source: 'tiles',
          'source-layer': 'place',
          layout: {'text-field': '{name}'},
          paint
        }
      ]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  return vectorLayer.props
    .renderSubLayers({id: 'tile', data: [feature], tile: {index: {x: 0, y: 0, z: 8}}})
    .find(Boolean);
}

describe('symbol paint', () => {
  test('text-color defaults to opaque black, as in the style spec', () => {
    expect(labelSublayer({}).props.textColor).toEqual([0, 0, 0, 255]);
  });

  test('text-halo-color keeps its own alpha', () => {
    const sublayer = labelSublayer({
      'text-halo-color': 'rgba(255, 255, 255, 0.5)',
      'text-halo-width': 1
    });
    expect(sublayer.getLabelHalo(feature)?.outlineColor).toEqual([255, 255, 255, 128]);
  });
});
