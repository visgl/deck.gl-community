import {expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';

test('evaluates OpenFreeMap multilingual label expressions per feature', () => {
  const layer = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    zoom: 10,
    styleLayer: {
      layout: {
        'text-field': [
          'case',
          ['has', 'name:nonlatin'],
          ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
          ['coalesce', ['get', 'name_en'], ['get', 'name']]
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 20, 30]
      }
    }
  });
  const geometry = {type: 'Point', coordinates: [0, 0]};
  expect(
    layer.getLabel({geometry, properties: {'name:latin': 'Tokyo', 'name:nonlatin': '東京'}})
  ).toBe('Tokyo\n東京');
  expect(layer.getLabel({geometry, properties: {name_en: 'London'}})).toBe('London');
  expect(layer.getLabel({geometry, properties: {name: 'Paris'}})).toBe('Paris');
  expect(layer.getLabelSize({geometry})).toBe(20);
});

test('preserves legacy token labels and zoom stops', () => {
  const layer = new MVTLabelLayer({
    id: 'legacy',
    config: {labels: true},
    zoom: 8,
    styleLayer: {
      layout: {
        'text-field': {
          stops: [
            [0, '{name}'],
            [8, '{name_en}']
          ]
        }
      }
    }
  });
  expect(
    layer.getLabel({
      geometry: {type: 'Point', coordinates: [0, 0]},
      properties: {name_en: 'London'}
    })
  ).toBe('London');
});
