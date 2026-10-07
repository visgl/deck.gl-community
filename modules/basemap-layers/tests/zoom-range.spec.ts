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
