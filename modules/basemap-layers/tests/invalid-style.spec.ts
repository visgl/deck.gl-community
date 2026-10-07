/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';
import {filterFeatures} from '../src/map-style.ts';
import {compileStyleFilter} from '../src/style-expression.ts';

const SOURCES = {
  tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}
};

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
  properties: {layerName: 'land', class: 'a'}
};

function renderTile(styleLayer: Record<string, unknown>): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 8,
    styleDefinition: {
      version: 8,
      sources: SOURCES,
      layers: [{id: 'land', source: 'tiles', 'source-layer': 'land', ...styleLayer}]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  return vectorLayer.props
    .renderSubLayers({id: 'tile', data: [polygon], tile: {index: {x: 0, y: 0, z: 8}}})
    .filter(Boolean);
}

describe('invalid style values', () => {
  test('an expression the style spec rejects is skipped, and the rest of the layer renders', () => {
    const [sublayer] = renderTile({
      type: 'fill',
      paint: {'fill-color': ['config', 'landColor'], 'fill-opacity': 0.5}
    });
    expect(sublayer).toBeDefined();
    const color = sublayer.props.getFillColor;
    expect(Array.isArray(color) && color.every(Number.isFinite)).toBe(true);
  });

  test('an unknown operator nested in a known one is skipped instead of throwing', () => {
    expect(() =>
      renderTile({type: 'fill', paint: {'fill-color': ['to-color', ['config', 'landColor']]}})
    ).not.toThrow();
  });

  test('a filter the style spec rejects matches no features instead of throwing', () => {
    expect(() => renderTile({type: 'fill', filter: ['nope', 1]})).not.toThrow();
  });
});

describe('filterFeatures', () => {
  test('does not modify the features it is given', () => {
    const feature = structuredClone(polygon);
    filterFeatures({features: [feature] as any, filter: ['==', ['get', 'class'], 'a']});
    expect(feature.type).toBe('Feature');
  });

  test('filters GeoJSON features by geometry type', () => {
    const result = filterFeatures({
      features: [structuredClone(polygon)] as any,
      filter: ['==', ['geometry-type'], 'Polygon']
    });
    expect(result).toHaveLength(1);
  });
});

describe('compileStyleFilter', () => {
  test('compiles each filter array once', () => {
    const filter = ['==', ['get', 'class'], 'a'];
    expect(compileStyleFilter(filter)).toBe(compileStyleFilter(filter));
  });
});
