/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {log} from '@deck.gl/core';
import {filterFeatures, parseProperties} from '../src/mapbox-style';
import {getBasemapLayers} from '../src/index.ts';

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

describe('tile filters after an in-place edit', () => {
  const features = [
    {
      type: 'Feature',
      geometry: {type: 'LineString', coordinates: []},
      properties: {layerName: 'transportation', class: 'road'}
    },
    {
      type: 'Feature',
      geometry: {type: 'LineString', coordinates: []},
      properties: {layerName: 'transportation', class: 'rail'}
    }
  ];
  const filter: any[] = ['==', ['get', 'class'], 'road'];
  const style: any = {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [{id: 'lines', type: 'line', source: 'tiles', 'source-layer': 'transportation', filter}]
  };
  const drawnClasses = (zoom: number) => {
    const vectorLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom,
      styleDefinition: style
    }).find((layer: any) => layer.id === 'test-tiles');
    const [sublayer] = vectorLayer.props
      .renderSubLayers({id: 'test-tiles-tile', data: features, tile: {index: {x: 0, y: 0, z: 12}}})
      .filter(Boolean);
    // A filter that matches nothing draws no sublayer.
    return sublayer ? sublayer.props.data.map((feature: any) => feature.properties.class) : [];
  };

  test('draws the edited filter, not the cached matches', () => {
    expect(drawnClasses(12)).toEqual(['road']);
    filter[2] = 'rail';
    expect(drawnClasses(12)).toEqual(['rail']);
  });

  test('notices when an edited filter starts reading the zoom', () => {
    filter.splice(0, filter.length, '==', ['get', 'class'], 'road');
    expect(drawnClasses(12.2)).toEqual(['road']);
    filter.splice(0, filter.length, 'all', ['==', ['get', 'class'], 'rail'], ['>=', ['zoom'], 13]);
    expect(drawnClasses(12.2)).toEqual([]);
    expect(drawnClasses(13.2)).toEqual(['rail']);
  });
});
