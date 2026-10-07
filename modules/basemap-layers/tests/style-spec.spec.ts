/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {Color} from '@maplibre/maplibre-gl-style-spec';
import {colorToArray, filterFeatures, parseProperties} from '../src/mapbox-style';
import {resolveBasemapStyle} from '../src/style-resolver';

function evaluatePaint(paint: Record<string, unknown>, zoom: number) {
  return Object.assign({}, ...parseProperties({id: 'layer', type: 'line', paint}, {zoom}));
}

describe('style-spec evaluation', () => {
  test('colors evaluate to [r, g, b, a] with RGB in 0-255 and alpha in 0-1', () => {
    const {'line-color': color} = evaluatePaint({'line-color': 'rgba(255, 128, 0, 0.5)'}, 0);
    expect(color).toHaveLength(4);
    expect(color[0]).toBeCloseTo(255, 6);
    expect(color[1]).toBeCloseTo(128, 6);
    expect(color[2]).toBeCloseTo(0, 6);
    expect(color[3]).toBeCloseTo(0.5, 6);
  });

  test('a fully transparent color evaluates to [0, 0, 0, 0]', () => {
    expect(colorToArray(Color.parse('rgba(255, 0, 0, 0)')!)).toEqual([0, 0, 0, 0]);
  });

  test('legacy zoom functions with stops interpolate', () => {
    const paint = {
      'line-width': {
        stops: [
          [0, 1],
          [10, 5]
        ]
      }
    };
    expect(evaluatePaint(paint, 5)['line-width']).toBeCloseTo(3, 6);
    expect(evaluatePaint(paint, 10)['line-width']).toBeCloseTo(5, 6);
  });

  test('expression and legacy filters select the same features', () => {
    const features = [
      {type: 2, properties: {class: 'minor'}},
      {type: 2, properties: {class: 'major'}}
    ];
    const expression = filterFeatures({features, filter: ['==', ['get', 'class'], 'major']});
    const legacy = filterFeatures({features, filter: ['==', 'class', 'major']});
    expect(expression).toEqual([features[1]]);
    expect(legacy).toEqual([features[1]]);
  });

  test('layers with ref inherit the referenced layer properties', async () => {
    const style = await resolveBasemapStyle({
      version: 8,
      sources: {base: {type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf']}},
      layers: [
        {id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads'},
        {id: 'roads-casing', ref: 'roads', paint: {'line-width': 4}}
      ]
    });
    expect(style.layers[1]).toMatchObject({
      id: 'roads-casing',
      type: 'line',
      source: 'base',
      'source-layer': 'roads'
    });
  });
});
