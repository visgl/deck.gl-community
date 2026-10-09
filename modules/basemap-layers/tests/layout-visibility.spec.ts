/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  vector: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']},
  raster: {type: 'raster', tiles: ['https://tiles.example.com/{z}/{x}/{y}.png']}
};

const FEATURES = [
  {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: {layerName: 'transportation', name: 'Main Street'}
  },
  {
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
    properties: {layerName: 'building', render_height: 10}
  }
];

function render(layers: Record<string, unknown>[], zoom = 12): any[] {
  return getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {version: 8, sources: SOURCES, layers} as any
  });
}

/** Style-layer ids a vector tile draws. */
function drawnLayerIds(layers: Record<string, unknown>[]): string[] {
  const vectorLayer = render(layers).find(layer => layer.id === 'test-vector');
  if (!vectorLayer) {
    return [];
  }
  return vectorLayer.props
    .renderSubLayers({id: 'tile', data: FEATURES, tile: {index: {x: 0, y: 0, z: 12}}})
    .filter(Boolean)
    .map((sublayer: any) => sublayer.id.replace(/^tile-/, ''));
}

const road = {id: 'road', type: 'line', source: 'vector', 'source-layer': 'transportation'};
const label = {
  id: 'road-label',
  type: 'symbol',
  source: 'vector',
  'source-layer': 'transportation',
  layout: {'text-field': '{name}'}
};
const buildings = {
  id: 'buildings',
  type: 'fill-extrusion',
  source: 'vector',
  'source-layer': 'building',
  paint: {'fill-extrusion-height': ['get', 'render_height']}
};

describe('layout.visibility', () => {
  test('a vector layer with visibility "none" is not drawn', () => {
    expect(drawnLayerIds([road, {...road, id: 'hidden', layout: {visibility: 'none'}}])).toEqual([
      'road'
    ]);
  });

  test('"visible" and an absent visibility both draw', () => {
    expect(drawnLayerIds([road, {...road, id: 'shown', layout: {visibility: 'visible'}}])).toEqual([
      'road',
      'shown'
    ]);
  });

  test('hidden symbol and fill-extrusion layers are not drawn', () => {
    const hidden = {visibility: 'none'};
    expect(
      drawnLayerIds([
        road,
        {...label, layout: {...label.layout, ...hidden}},
        {...buildings, layout: hidden}
      ])
    ).toEqual(['road']);
    expect(drawnLayerIds([road, label, buildings])).toEqual(['road', 'road-label', 'buildings']);
  });

  test('a source whose layers are all hidden gets no tile layer', () => {
    expect(
      render([{...road, layout: {visibility: 'none'}}]).find(layer => layer.id === 'test-vector')
    ).toBeUndefined();
  });

  test('a hidden background layer is not drawn', () => {
    const background = {id: 'bg', type: 'background', paint: {'background-color': '#ff0000'}};
    const ids = (layers: Record<string, unknown>[]) => render(layers).map(layer => layer.id);
    expect(ids([background]).some(id => id.includes('bg'))).toBe(true);
    expect(ids([{...background, layout: {visibility: 'none'}}]).some(id => id.includes('bg'))).toBe(
      false
    );
  });

  test('a hidden raster layer is not drawn', () => {
    const imagery = {id: 'imagery', type: 'raster', source: 'raster'};
    expect(render([imagery]).find(layer => layer.id === 'test-imagery')).toBeDefined();
    expect(
      render([{...imagery, layout: {visibility: 'none'}}]).find(
        layer => layer.id === 'test-imagery'
      )
    ).toBeUndefined();
  });

  test('toggling visibility in place takes effect on the next render', () => {
    const toggled: any = {...road, id: 'toggled', layout: {visibility: 'none'}};
    const layers = [road, toggled];
    expect(drawnLayerIds(layers)).toEqual(['road']);
    toggled.layout.visibility = 'visible';
    expect(drawnLayerIds(layers)).toEqual(['road', 'toggled']);
    toggled.layout.visibility = 'none';
    expect(drawnLayerIds(layers)).toEqual(['road']);
  });
});
