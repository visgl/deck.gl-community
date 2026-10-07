/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

/** Renders one line style layer for one tile and returns its line width. */
function lineWidthFor(sourceLayer: string, id: string): number {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 12,
    styleDefinition: {
      version: 8,
      sources: SOURCES,
      layers: [
        {id, type: 'line', source: 'tiles', 'source-layer': sourceLayer, paint: {'line-width': 4}}
      ]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  const [sublayer] = vectorLayer.props.renderSubLayers({
    id: 'test-tiles-tile',
    data: [
      {
        type: 'Feature',
        geometry: {type: 'LineString', coordinates: []},
        properties: {layerName: sourceLayer}
      }
    ],
    tile: {index: {x: 0, y: 0, z: 12}}
  });
  return sublayer.props.getLineWidth;
}

describe('line-width', () => {
  test.each([
    ['transportation', 'road_primary'],
    ['boundary', 'boundary_state'],
    ['waterway', 'waterway'],
    ['aeroway', 'aeroway_runway'],
    ['landuse', 'road-like-id']
  ])('draws the style line-width unscaled for source layer %s', (sourceLayer, id) => {
    expect(lineWidthFor(sourceLayer, id)).toBe(4);
  });
});
