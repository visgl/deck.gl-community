/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {log} from '@deck.gl/core';
import {filterFeatures, parseProperties} from '../src/mapbox-style';

describe('parseProperties after an in-place edit', () => {
  test('returns the edited paint value, not a cached one', () => {
    const layer: any = {id: 'fill', type: 'fill', paint: {'fill-color': '#ff0000'}};
    expect(parseProperties(layer, {zoom: 10})).toEqual([{'fill-color': [255, 0, 0, 1]}]);
    layer.paint['fill-color'] = '#0000ff';
    expect(parseProperties(layer, {zoom: 10})).toEqual([{'fill-color': [0, 0, 255, 1]}]);
  });

  test('picks up an edited zoom expression', () => {
    const layer: any = {id: 'line', type: 'line', paint: {'line-width': 2}};
    expect(parseProperties(layer, {zoom: 10})).toEqual([{'line-width': 2}]);
    layer.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 10, 4, 12, 8];
    expect(parseProperties(layer, {zoom: 10})).toEqual([{'line-width': 4}]);
  });
});

describe('parseProperties global inputs', () => {
  test('passes inputs other than zoom to the expression', () => {
    const layer: any = {
      id: 'heat',
      type: 'heatmap',
      paint: {
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          '#ff0000',
          1,
          '#0000ff'
        ]
      }
    };
    expect(parseProperties(layer, {zoom: 10, heatmapDensity: 1})).toEqual([
      {'heatmap-color': [0, 0, 255, 1]}
    ]);
  });
});

describe('filterFeatures after an in-place edit', () => {
  const features = [
    {type: 'Feature', geometry: {type: 'Point'}, properties: {class: 'major'}},
    {type: 'Feature', geometry: {type: 'Point'}, properties: {class: 'minor'}}
  ];
  const classes = (filter: unknown) =>
    filterFeatures({features: features as any, filter}).map(f => f.properties?.class);

  test('applies the edited filter, not a cached one', () => {
    const filter: any[] = ['==', ['get', 'class'], 'major'];
    expect(classes(filter)).toEqual(['major']);
    filter[2] = 'minor';
    expect(classes(filter)).toEqual(['minor']);
  });

  test('a rejected filter that is edited into a valid one matches again', () => {
    vi.spyOn(log, 'warn').mockReturnValue(() => {});
    const filter: any[] = ['not-an-operator', 'major'];
    expect(classes(filter)).toEqual([]);
    filter.splice(0, 2, '==', ['get', 'class'], 'major');
    expect(classes(filter)).toEqual(['major']);
    vi.restoreAllMocks();
  });
});
