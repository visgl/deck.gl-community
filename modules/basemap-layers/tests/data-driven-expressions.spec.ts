/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';
import {findFeaturesStyledByLayer} from '../src/map-style.ts';

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

/** Builds the vector source layer for one style layer and renders it for one tile. */
function renderStyleLayer(styleLayer: Record<string, unknown>, features: unknown[], zoom = 7.6) {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {
      version: 8,
      sources: SOURCES,
      layers: [{source: 'tiles', 'source-layer': 'land', ...styleLayer}]
    } as any
  });
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  const [sublayer] = vectorLayer.props.renderSubLayers({
    id: 'test-tiles-tile',
    data: features,
    tile: {index: {x: 0, y: 0, z: Math.floor(zoom)}}
  });
  return {vectorLayer, sublayer};
}

describe('data-driven paint properties', () => {
  test('evaluates fill-color per feature', () => {
    const features = [feature('Polygon', {class: 'a'}), feature('Polygon', {class: 'b'})];
    const {sublayer} = renderStyleLayer(
      {
        id: 'land',
        type: 'fill',
        paint: {'fill-color': ['match', ['get', 'class'], 'a', '#ff0000', '#0000ff']}
      },
      features
    );

    const getFillColor = sublayer.props.getFillColor;
    expect(typeof getFillColor).toBe('function');
    expect(getFillColor(features[0])).toEqual([255, 0, 0, 255]);
    expect(getFillColor(features[1])).toEqual([0, 0, 255, 255]);
  });

  test('evaluates fill-opacity per feature', () => {
    const features = [feature('Polygon', {o: 0.5}), feature('Polygon', {o: 1})];
    const {sublayer} = renderStyleLayer(
      {
        id: 'land',
        type: 'fill',
        paint: {'fill-color': '#ff0000', 'fill-opacity': ['get', 'o']}
      },
      features
    );

    expect(sublayer.props.getFillColor(features[0])).toEqual([255, 0, 0, 128]);
    expect(sublayer.props.getFillColor(features[1])).toEqual([255, 0, 0, 255]);
  });

  test('evaluates line-color and line-width per feature', () => {
    const features = [feature('LineString', {w: 2, c: 'red'}), feature('LineString', {w: 6})];
    const {sublayer} = renderStyleLayer(
      {
        id: 'land',
        type: 'line',
        paint: {
          'line-color': ['match', ['get', 'c'], 'red', '#ff0000', '#00ff00'],
          'line-width': ['get', 'w']
        }
      },
      features
    );

    expect(sublayer.props.getLineColor(features[0])).toEqual([255, 0, 0, 255]);
    expect(sublayer.props.getLineColor(features[1])).toEqual([0, 255, 0, 255]);
    expect(sublayer.props.getLineWidth(features[0])).toBe(2);
    expect(sublayer.props.getLineWidth(features[1])).toBe(6);
  });

  test('keys updateTriggers on the integer zoom only for zoom-dependent data-driven values', () => {
    const features = [feature('LineString', {w: 2})];
    const {sublayer} = renderStyleLayer(
      {
        id: 'land',
        type: 'line',
        paint: {
          'line-color': ['match', ['get', 'w'], 2, '#ff0000', '#00ff00'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['get', 'w'], 10, 10]
        }
      },
      features,
      7.6
    );

    expect(sublayer.props.updateTriggers.getLineWidth).toBe(7);
    expect(sublayer.props.updateTriggers.getLineColor).toBeUndefined();
    // Evaluated at the integer zoom: 2 + (10 - 2) * (7 - 5) / 5.
    expect(sublayer.props.getLineWidth(features[0])).toBeCloseTo(5.2, 6);
  });

  test('evaluates feature-independent values as constants at the integer zoom', () => {
    const styleLayer = {
      id: 'land',
      type: 'line',
      paint: {
        'line-color': '#ff0000',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 6]
      }
    };
    const features = [feature('LineString', {})];
    // Neighbouring tiles generated at z7.2 and z7.9 must agree: both evaluate at zoom 7.
    const early = renderStyleLayer(styleLayer, features, 7.2).sublayer;
    const late = renderStyleLayer(styleLayer, features, 7.9).sublayer;

    expect(early.props.getLineColor).toEqual([255, 0, 0, 255]);
    // 1 + (6 - 1) * (7 - 5) / 5.
    expect(early.props.getLineWidth).toBeCloseTo(3, 6);
    expect(late.props.getLineWidth).toBeCloseTo(3, 6);
    expect(early.props.updateTriggers.getLineWidth).toBeUndefined();
  });

  test('evaluates zoom in filters at the integer zoom', () => {
    const features = [feature('LineString', {})];
    const {sublayer} = renderStyleLayer(
      {id: 'land', type: 'line', filter: ['>=', ['zoom'], 7.5]},
      features,
      7.9
    );
    // The style spec evaluates zoom expressions in filters only at integer zoom levels, so at
    // z7.9 the filter sees zoom 7 and the tile renders nothing for this style layer.
    expect(sublayer).toBeUndefined();
  });

  test('regenerates tile sublayers when the zoom crosses a fractional minzoom', () => {
    const vectorLayerAt = (zoom: number): any =>
      getBasemapLayers({
        idPrefix: 'test',
        mode: 'map',
        zoom,
        styleDefinition: {
          version: 8,
          sources: SOURCES,
          layers: [
            {id: 'land', type: 'line', source: 'tiles', 'source-layer': 'land'},
            {id: 'late', type: 'line', source: 'tiles', 'source-layer': 'land', minzoom: 7.5}
          ]
        } as any
      }).find(layer => layer.id === 'test-tiles');

    expect(vectorLayerAt(7.2).props.updateTriggers.renderSubLayers).not.toEqual(
      vectorLayerAt(7.9).props.updateTriggers.renderSubLayers
    );
  });

  test('regenerates tile sublayers when the integer zoom changes', () => {
    const styleLayer = {
      id: 'land',
      type: 'line',
      paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['get', 'w'], 10, 10]}
    };
    const features = [feature('LineString', {w: 2})];
    const at7 = renderStyleLayer(styleLayer, features, 7.2).vectorLayer;
    const at7b = renderStyleLayer(styleLayer, features, 7.9).vectorLayer;
    const at8 = renderStyleLayer(styleLayer, features, 8.1).vectorLayer;

    expect(at7.props.updateTriggers.renderSubLayers).toEqual(
      at7b.props.updateTriggers.renderSubLayers
    );
    expect(at7.props.updateTriggers.renderSubLayers).not.toEqual(
      at8.props.updateTriggers.renderSubLayers
    );
  });
});

describe('findFeaturesStyledByLayer', () => {
  test('returns the source-layer features when the style layer has no filter', () => {
    const water = [feature('Polygon', {}), feature('Polygon', {})];
    const features = {tiles: {water}};

    expect(
      findFeaturesStyledByLayer({
        features,
        layer: {source: 'tiles', 'source-layer': 'water'}
      })
    ).toEqual(water);
  });
});
