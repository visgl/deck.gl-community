/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

/** Renders one line style layer for one tile and returns its line width. */
function lineWidthFor(sourceLayer: string, id: string, width = 4): number {
  return lineSublayerFor(sourceLayer, id, width).props.getLineWidth;
}

function lineSublayerFor(sourceLayer: string, id: string, width: number): any {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 12,
    styleDefinition: {
      version: 8,
      sources: SOURCES,
      layers: [
        {
          id,
          type: 'line',
          source: 'tiles',
          'source-layer': sourceLayer,
          paint: {'line-width': width}
        }
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
  return sublayer;
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

  test('a line-width of 0 draws nothing', () => {
    expect(lineWidthFor('transportation', 'road_hidden', 0)).toBe(0);
  });

  test('wide lines are not capped', () => {
    const sublayer = lineSublayerFor('transportation', 'road_casing', 40);
    expect(sublayer.props.getLineWidth).toBe(40);
    expect(sublayer.props.lineWidthMaxPixels).toBeGreaterThanOrEqual(40);
  });
});
