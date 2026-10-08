/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  tiles: {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
  }
};

function feature(geometryType: string, properties: Record<string, unknown>) {
  return {
    type: 'Feature',
    geometry: {type: geometryType, coordinates: []},
    properties: {layerName: 'land', ...properties}
  };
}

function makeStyle(styleLayer: Record<string, unknown>) {
  return {
    version: 8,
    sources: SOURCES,
    layers: [{id: 'land', source: 'tiles', 'source-layer': 'land', ...styleLayer}]
  } as any;
}

function vectorLayerAt(styleDefinition: any, zoom: number): any {
  return getBasemapLayers({idPrefix: 'test', mode: 'map', zoom, styleDefinition}).find(
    layer => layer.id === 'test-tiles'
  );
}

function renderTile(vectorLayer: any, features: unknown[], x = 0, z = 15): any {
  const [sublayer] = vectorLayer.props.renderSubLayers({
    id: `test-tiles-${x}-${z}`,
    data: features,
    tile: {index: {x, y: 0, z}}
  });
  return sublayer;
}

const LINEAR_WIDTH = {
  type: 'line',
  paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 16, 6]}
};

describe('fractional zoom steps', () => {
  test('zoom-dependent values are evaluated at the zoom rounded down to a 0.25 step', () => {
    const style = makeStyle(LINEAR_WIDTH);
    const features = [feature('LineString', {})];
    const widthAt = (zoom: number) =>
      renderTile(vectorLayerAt(style, zoom), features).props.getLineWidth;

    expect(widthAt(15.5)).toBeCloseTo(4.5, 6);
    expect(widthAt(15.6)).toBeCloseTo(4.5, 6);
    expect(widthAt(15.2)).toBeCloseTo(3, 6);
  });

  test('data-driven zoom-dependent values use the same step and key their trigger on it', () => {
    const style = makeStyle({
      type: 'line',
      paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 15, ['get', 'w'], 16, 6]}
    });
    const features = [feature('LineString', {w: 2})];
    const sublayer = renderTile(vectorLayerAt(style, 15.6), features);

    expect(sublayer.props.getLineWidth(features[0])).toBeCloseTo(4, 6);
    expect(sublayer.props.updateTriggers.getLineWidth).toBe(15.5);
  });

  test('tiles from different pyramid levels get the value of the viewport zoom step', () => {
    // While zooming, placeholder tiles from the levels above and below are drawn next to tiles of
    // the current level. All of them must use the viewport's zoom step, not their own level.
    const style = makeStyle(LINEAR_WIDTH);
    const vectorLayer = vectorLayerAt(style, 15.6);
    const parent = renderTile(vectorLayer, [feature('LineString', {})], 0, 14);
    const current = renderTile(vectorLayer, [feature('LineString', {})], 1, 15);
    const child = renderTile(vectorLayer, [feature('LineString', {})], 2, 16);

    for (const sublayer of [parent, current, child]) {
      expect(sublayer.props.getLineWidth).toBeCloseTo(4.5, 9);
    }
  });

  test('filters still see the integer zoom', () => {
    const style = makeStyle({type: 'line', filter: ['>=', ['zoom'], 15.5]});
    // At z15.7 the filter sees zoom 15, so the style layer renders nothing.
    expect(renderTile(vectorLayerAt(style, 15.7), [feature('LineString', {})])).toBeUndefined();
  });

  test('the regeneration key changes at each 0.25 step', () => {
    const style = makeStyle(LINEAR_WIDTH);
    const keyAt = (zoom: number) => vectorLayerAt(style, zoom).props.updateTriggers.renderSubLayers;

    expect(keyAt(15.2)).not.toEqual(keyAt(15.3));
    expect(keyAt(15.3)).toEqual(keyAt(15.4));
  });

  test('filtered feature arrays are reused within an integer zoom', () => {
    const style = makeStyle({...LINEAR_WIDTH, filter: ['==', ['get', 'kind'], 'road']});
    const features = [feature('LineString', {kind: 'road'}), feature('LineString', {kind: 'rail'})];
    const dataAt = (zoom: number) => renderTile(vectorLayerAt(style, zoom), features).props.data;

    const first = dataAt(15.3);
    expect(first).toHaveLength(1);
    // Same data reference: deck.gl sees no data change and does not re-tessellate.
    expect(dataAt(15.6)).toBe(first);
    // The filter does not read the zoom, so crossing an integer zoom reuses the array too.
    expect(dataAt(16.1)).toBe(first);
  });

  test('a filter that reads the zoom is re-evaluated when the integer zoom changes', () => {
    const style = makeStyle({...LINEAR_WIDTH, filter: ['>=', ['zoom'], 16]});
    const features = [feature('LineString', {})];

    expect(renderTile(vectorLayerAt(style, 15.7), features)).toBeUndefined();
    expect(renderTile(vectorLayerAt(style, 16.1), features).props.data).toHaveLength(1);
    // Back below the limit: the result is recomputed, not served from the z16 entry.
    expect(renderTile(vectorLayerAt(style, 15.2), features)).toBeUndefined();
  });

  test('a filter replaced in place misses the cache', () => {
    const style = makeStyle({...LINEAR_WIDTH, filter: ['==', ['get', 'kind'], 'road']});
    const features = [feature('LineString', {kind: 'road'}), feature('LineString', {kind: 'rail'})];
    const dataAt = () => renderTile(vectorLayerAt(style, 15.3), features).props.data;

    expect(dataAt().map((f: any) => f.properties.kind)).toEqual(['road']);
    style.layers[0].filter = ['==', ['get', 'kind'], 'rail'];
    expect(dataAt().map((f: any) => f.properties.kind)).toEqual(['rail']);
  });

  test('a different style misses the cache', () => {
    const features = [feature('LineString', {kind: 'road'}), feature('LineString', {kind: 'rail'})];
    const kindsFor = (kind: string) =>
      renderTile(
        vectorLayerAt(makeStyle({...LINEAR_WIDTH, filter: ['==', ['get', 'kind'], kind]}), 15.3),
        features
      ).props.data.map((f: any) => f.properties.kind);

    expect(kindsFor('road')).toEqual(['road']);
    expect(kindsFor('rail')).toEqual(['rail']);
  });

  test('source-layer selections are reused within an integer zoom', () => {
    const style = makeStyle(LINEAR_WIDTH);
    const features = [feature('LineString', {}), {...feature('LineString', {}), properties: {}}];
    const dataAt = (zoom: number) => renderTile(vectorLayerAt(style, zoom), features).props.data;

    expect(dataAt(15.6)).toBe(dataAt(15.3));
  });
});
