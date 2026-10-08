/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  vector: {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt'],
    maxzoom: 14
  },
  raster: {
    type: 'raster',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.png'],
    maxzoom: 10
  }
};

function render(layers: Record<string, unknown>[], zoom: number): any[] {
  return getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {version: 8, sources: SOURCES, layers} as any
  });
}

const road = {id: 'road', type: 'line', source: 'vector', 'source-layer': 'transportation'};

const ROAD_FEATURE = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1]
    ]
  },
  properties: {layerName: 'transportation'}
};

/** Style-layer ids a tile draws at `zoom`, for one road feature. */
function drawnLayerIds(layers: Record<string, unknown>[], zoom: number): string[] {
  const vectorLayer = render(layers, zoom).find(layer => layer.id === 'test-vector');
  return vectorLayer.props
    .renderSubLayers({id: 'tile', data: [ROAD_FEATURE], tile: {index: {x: 0, y: 0, z: 10}}})
    .filter(Boolean)
    .map((sublayer: any) => sublayer.id.replace(/^tile-/, ''));
}

describe('zoom ranges', () => {
  test('a style layer without its own maxzoom keeps rendering past the source maxzoom', () => {
    const vectorLayer = render([road], 16).find(layer => layer.id === 'test-vector');
    expect(vectorLayer).toBeDefined();
  });

  test('the tile layer overzooms from the source maxzoom', () => {
    const vectorLayer = render([{...road, maxzoom: 18}], 16).find(
      layer => layer.id === 'test-vector'
    );
    expect(vectorLayer.props.maxZoom).toBe(14);
  });

  test('a style layer is hidden outside its own zoom range', () => {
    const limited = {...road, minzoom: 5, maxzoom: 12};
    expect(render([limited], 4).find(layer => layer.id === 'test-vector')).toBeUndefined();
    expect(render([limited], 11).find(layer => layer.id === 'test-vector')).toBeDefined();
    expect(render([limited], 12).find(layer => layer.id === 'test-vector')).toBeUndefined();
  });

  test('a raster layer keeps rendering past the source maxzoom and overzooms its tiles', () => {
    const rasterLayer = render([{id: 'imagery', type: 'raster', source: 'raster'}], 12).find(
      layer => layer.id === 'test-imagery'
    );
    expect(rasterLayer).toBeDefined();
    expect(rasterLayer.props.maxZoom).toBe(10);
  });
});

describe('tile regeneration at layer limits', () => {
  test('regenerates when a layer drops out at a fractional maxzoom', () => {
    const layers = [
      {...road, id: 'b', maxzoom: 10.5},
      {...road, id: 'c'}
    ];
    const keyAt = (zoom: number) =>
      render(layers, zoom).find(layer => layer.id === 'test-vector').props.updateTriggers
        .renderSubLayers;
    expect(keyAt(10.2)).not.toEqual(keyAt(10.6));
  });

  test('a tile regenerated past the fractional maxzoom no longer draws the layer', () => {
    const layers = [
      {...road, id: 'b', maxzoom: 10.5},
      {...road, id: 'c'}
    ];
    expect(drawnLayerIds(layers, 10.2)).toEqual(['b', 'c']);
    expect(drawnLayerIds(layers, 10.6)).toEqual(['c']);
  });

  test('a fractional limit inside one zoom step still regenerates and hides the layer', () => {
    // 10.55 and 10.65 share the 10.5 evaluation step; only the 10.6 limit separates them.
    const layers = [
      {...road, id: 'b', maxzoom: 10.6},
      {...road, id: 'c'}
    ];
    const keyAt = (zoom: number) =>
      render(layers, zoom).find(layer => layer.id === 'test-vector').props.updateTriggers
        .renderSubLayers;
    expect(keyAt(10.55)).not.toEqual(keyAt(10.65));
    expect(drawnLayerIds(layers, 10.55)).toEqual(['b', 'c']);
    expect(drawnLayerIds(layers, 10.65)).toEqual(['c']);
  });
});
