/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const polygon = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0]
      ]
    ]
  },
  properties: {layerName: 'land'}
};

/** Renders one style layer for one tile and returns the tile's sublayers. */
function renderTile(styleLayer: Record<string, unknown>, features: unknown[] = [polygon]): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 12,
    styleDefinition: {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: [{source: 'tiles', 'source-layer': 'land', ...styleLayer}]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  return vectorLayer.props
    .renderSubLayers({id: 'test-tile', data: features, tile: {index: {x: 0, y: 0, z: 12}}})
    .flat();
}

/** The GeoJsonLayer sublayers a layer would create, given data for every geometry kind. */
function drawnKinds(layer: any): string[] {
  return ['polygons-fill', 'polygons-stroke', 'linestrings', 'points-circle'].filter(id =>
    layer.shouldRenderSubLayer(id, [{}])
  );
}

describe('sublayers that draw nothing', () => {
  test('a fill draws polygons only', () => {
    const [layer] = renderTile({id: 'land', type: 'fill', paint: {'fill-color': '#f00'}});
    expect(drawnKinds(layer)).toEqual(['polygons-fill']);
  });

  test('a fill with an outline draws polygons, their outlines and line strings', () => {
    const [layer] = renderTile({
      id: 'land',
      type: 'fill',
      paint: {'fill-color': '#f00', 'fill-outline-color': '#00f'}
    });
    expect(drawnKinds(layer)).toEqual(['polygons-fill', 'polygons-stroke', 'linestrings']);
  });

  test('a line draws polygon outlines and line strings, not polygon fills or points', () => {
    const [layer] = renderTile({id: 'land', type: 'line', paint: {'line-color': '#f00'}});
    expect(drawnKinds(layer)).toEqual(['polygons-stroke', 'linestrings']);
  });

  test('a fill-extrusion draws polygons only', () => {
    const [layer] = renderTile({
      id: 'building',
      type: 'fill-extrusion',
      paint: {'fill-extrusion-height': 10}
    });
    expect(drawnKinds(layer)).toEqual(['polygons-fill']);
  });

  test('a transparent fill with an outline draws the outline only', () => {
    const [layer] = renderTile({
      id: 'land',
      type: 'fill',
      paint: {'fill-color': 'rgba(0, 0, 0, 0)', 'fill-outline-color': '#00f'}
    });
    expect(drawnKinds(layer)).toEqual(['polygons-stroke', 'linestrings']);
  });

  test.each([
    ['a transparent fill', {type: 'fill', paint: {'fill-color': 'rgba(255, 0, 0, 0)'}}],
    ['a fill with fill-opacity 0', {type: 'fill', paint: {'fill-opacity': 0}}],
    ['a patterned fill', {type: 'fill', paint: {'fill-pattern': 'dots'}}],
    ['a transparent line', {type: 'line', paint: {'line-opacity': 0}}],
    ['a line of width 0', {type: 'line', paint: {'line-width': 0}}]
  ])('%s creates no sublayer', (_, styleLayer) => {
    expect(renderTile({id: 'land', ...styleLayer})).toEqual([]);
  });

  test('a data-driven transparent color still draws', () => {
    const layers = renderTile({
      id: 'land',
      type: 'fill',
      paint: {'fill-color': ['case', ['has', 'x'], '#f00', 'rgba(0, 0, 0, 0)']}
    });
    expect(layers).toHaveLength(1);
  });
});
