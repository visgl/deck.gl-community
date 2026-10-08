/* eslint-disable import/no-extraneous-dependencies */
import {expect, test, vi} from 'vitest';

const calls = {parseProperties: 0};
vi.mock('../src/mapbox-style', async importOriginal => {
  const original: any = await importOriginal();
  return {
    ...original,
    parseProperties: (...args: any[]) => {
      calls.parseProperties++;
      return original.parseProperties(...args);
    }
  };
});

test('label paint is evaluated once per style layer and zoom step, not per tile', async () => {
  const {getBasemapLayers} = await import('../src/index.ts');
  const style = {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [
      {
        id: 'labels',
        type: 'symbol',
        source: 'tiles',
        'source-layer': 'place',
        layout: {'text-field': '{name}'},
        paint: {'text-color': ['interpolate', ['linear'], ['zoom'], 10, '#000', 12, '#fff']}
      }
    ]
  } as any;
  const features = [
    {
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [0, 0]},
      properties: {layerName: 'place', name: 'a'}
    }
  ];
  const renderTiles = (zoom: number) => {
    const vectorLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom,
      styleDefinition: style
    }).find((layer: any) => layer.id === 'test-tiles');
    for (let x = 0; x < 3; x++) {
      vectorLayer.props.renderSubLayers({
        id: `test-tiles-${x}`,
        data: features,
        tile: {index: {x, y: 0, z: 11}}
      });
    }
  };

  calls.parseProperties = 0;
  renderTiles(11.1);
  expect(calls.parseProperties).toBe(1);
  renderTiles(11.2);
  expect(calls.parseProperties).toBe(1);
  renderTiles(11.3);
  expect(calls.parseProperties).toBe(2);
});
