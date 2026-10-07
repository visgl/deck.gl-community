/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {parseProperties} from '../src/mapbox-style';

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
