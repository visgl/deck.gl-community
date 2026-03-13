// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {
  createScatterplotLayer,
  createPathLayer,
  createPolygonLayer,
  createTextLayer,
  createHeatmapLayer,
  createIconLayer,
  createViewState,
  getBoundingBox,
  fitViewport,
  createColorAccessor,
  createRadiusAccessor,
  flattenGeoJSON,
  extractPositions,
  createNoodle,
  hydrateNoodle,
  validateNoodle,
  DeckBuilder
} from '../src/index';

// ---------------------------------------------------------------------------
// Layer skills
// ---------------------------------------------------------------------------

describe('createScatterplotLayer', () => {
  it('returns a LayerDescriptor with type ScatterplotLayer', () => {
    const layer = createScatterplotLayer({
      data: [{lng: 0, lat: 0}],
      getPosition: (d) => [d.lng, d.lat]
    });
    expect(layer.type).toBe('ScatterplotLayer');
    expect(layer.id).toBe('scatterplot-layer');
    expect(layer.props.data).toHaveLength(1);
  });

  it('accepts a custom id', () => {
    const layer = createScatterplotLayer({
      id: 'my-layer',
      data: [],
      getPosition: (d: {lng: number; lat: number}) => [d.lng, d.lat]
    });
    expect(layer.id).toBe('my-layer');
  });

  it('forwards custom props', () => {
    const layer = createScatterplotLayer({
      data: [],
      getPosition: () => [0, 0],
      stroked: true,
      radiusMinPixels: 2,
      radiusMaxPixels: 50,
      radiusUnits: 'pixels'
    });
    expect(layer.props.stroked).toBe(true);
    expect(layer.props.radiusUnits).toBe('pixels');
  });
});

describe('createPathLayer', () => {
  it('returns a LayerDescriptor with type PathLayer', () => {
    const layer = createPathLayer({
      data: [],
      getPath: (d: {coords: [number, number][]}) => d.coords
    });
    expect(layer.type).toBe('PathLayer');
  });
});

describe('createPolygonLayer', () => {
  it('returns a LayerDescriptor with type PolygonLayer', () => {
    const layer = createPolygonLayer({
      data: [],
      getPolygon: (d: {ring: [number, number][]}) => d.ring
    });
    expect(layer.type).toBe('PolygonLayer');
    expect(layer.props.extruded).toBe(false);
  });

  it('supports extruded mode', () => {
    const layer = createPolygonLayer({
      data: [],
      getPolygon: () => [],
      extruded: true,
      getElevation: 100
    });
    expect(layer.props.extruded).toBe(true);
    expect(layer.props.getElevation).toBe(100);
  });
});

describe('createTextLayer', () => {
  it('returns a LayerDescriptor with type TextLayer', () => {
    const layer = createTextLayer({
      data: [],
      getPosition: () => [0, 0],
      getText: (d: {label: string}) => d.label
    });
    expect(layer.type).toBe('TextLayer');
  });
});

describe('createHeatmapLayer', () => {
  it('returns a LayerDescriptor with type HeatmapLayer', () => {
    const layer = createHeatmapLayer({
      data: [],
      getPosition: () => [0, 0]
    });
    expect(layer.type).toBe('HeatmapLayer');
    expect(layer.props.radiusPixels).toBe(30);
  });
});

describe('createIconLayer', () => {
  it('returns a LayerDescriptor with type IconLayer', () => {
    const layer = createIconLayer({
      data: [],
      iconAtlas: '/icons.png',
      iconMapping: {pin: {x: 0, y: 0, width: 32, height: 32}},
      getPosition: () => [0, 0],
      getIcon: () => 'pin'
    });
    expect(layer.type).toBe('IconLayer');
    expect(layer.props.iconAtlas).toBe('/icons.png');
  });
});

// ---------------------------------------------------------------------------
// Viewport skills
// ---------------------------------------------------------------------------

describe('createViewState', () => {
  it('returns defaults when called with no args', () => {
    const vs = createViewState();
    expect(vs.longitude).toBe(0);
    expect(vs.latitude).toBe(0);
    expect(vs.zoom).toBe(1);
    expect(vs.pitch).toBe(0);
    expect(vs.bearing).toBe(0);
  });

  it('merges provided values with defaults', () => {
    const vs = createViewState({longitude: -122.4, latitude: 37.8, zoom: 11});
    expect(vs.longitude).toBe(-122.4);
    expect(vs.zoom).toBe(11);
    expect(vs.pitch).toBe(0);
  });
});

describe('getBoundingBox', () => {
  it('returns a [minLng, minLat, maxLng, maxLat] tuple', () => {
    const bbox = getBoundingBox([
      [0, 0],
      [10, 20],
      [-5, 15]
    ]);
    expect(bbox).toEqual([-5, 0, 10, 20]);
  });

  it('returns [0,0,0,0] for an empty array', () => {
    expect(getBoundingBox([])).toEqual([0, 0, 0, 0]);
  });

  it('handles a single position', () => {
    expect(getBoundingBox([[5, 10]])).toEqual([5, 10, 5, 10]);
  });
});

describe('fitViewport', () => {
  it('returns a valid ViewState', () => {
    const bbox = getBoundingBox([
      [-122.5, 37.7],
      [-122.3, 37.9]
    ]);
    const vs = fitViewport(bbox, {width: 800, height: 600});
    expect(vs.longitude).toBeCloseTo(-122.4, 1);
    expect(vs.latitude).toBeCloseTo(37.8, 1);
    expect(vs.zoom).toBeGreaterThan(0);
    expect(vs.zoom).toBeLessThanOrEqual(16);
  });

  it('respects maxZoom', () => {
    const bbox: [number, number, number, number] = [0, 0, 0.0001, 0.0001];
    const vs = fitViewport(bbox, {width: 800, height: 600, maxZoom: 10});
    expect(vs.zoom).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Data skills
// ---------------------------------------------------------------------------

describe('createColorAccessor', () => {
  it('returns blue for domain minimum', () => {
    const getColor = createColorAccessor({
      getValue: (d: {v: number}) => d.v,
      domainMin: 0,
      domainMax: 100,
      colorLow: [0, 0, 255],
      colorHigh: [255, 0, 0]
    });
    const [r, g, b] = getColor({v: 0});
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(255);
  });

  it('returns red for domain maximum', () => {
    const getColor = createColorAccessor({
      getValue: (d: {v: number}) => d.v,
      domainMin: 0,
      domainMax: 100,
      colorLow: [0, 0, 255],
      colorHigh: [255, 0, 0]
    });
    const [r, g, b] = getColor({v: 100});
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('clamps values outside the domain', () => {
    const getColor = createColorAccessor({
      getValue: (d: {v: number}) => d.v,
      domainMin: 0,
      domainMax: 10
    });
    const belowMin = getColor({v: -5});
    const aboveMax = getColor({v: 999});
    expect(belowMin).toEqual(getColor({v: 0}));
    expect(aboveMax).toEqual(getColor({v: 10}));
  });
});

describe('createRadiusAccessor', () => {
  it('maps domain min to minPixels', () => {
    const getRadius = createRadiusAccessor({
      getValue: (d: {size: number}) => d.size,
      domainMin: 0,
      domainMax: 100,
      minPixels: 5,
      maxPixels: 20
    });
    expect(getRadius({size: 0})).toBe(5);
    expect(getRadius({size: 100})).toBe(20);
  });
});

describe('flattenGeoJSON', () => {
  it('flattens a FeatureCollection into plain objects', () => {
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {type: 'Point' as const, coordinates: [10, 20] as [number, number]},
          properties: {name: 'A'}
        }
      ]
    };
    const flat = flattenGeoJSON(geojson);
    expect(flat).toHaveLength(1);
    expect(flat[0].longitude).toBe(10);
    expect(flat[0].latitude).toBe(20);
    expect(flat[0].name).toBe('A');
  });
});

describe('extractPositions', () => {
  it('extracts positions from a FeatureCollection', () => {
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {type: 'Point' as const, coordinates: [1, 2] as [number, number]},
          properties: {}
        },
        {
          type: 'Feature' as const,
          geometry: {type: 'Point' as const, coordinates: [3, 4] as [number, number]},
          properties: {}
        }
      ]
    };
    const positions = extractPositions(geojson);
    expect(positions).toEqual([
      [1, 2],
      [3, 4]
    ]);
  });
});

// ---------------------------------------------------------------------------
// Noodles
// ---------------------------------------------------------------------------

describe('createNoodle', () => {
  it('creates a ScatterplotLayer noodle with correct type', () => {
    const noodle = createNoodle('ScatterplotLayer', {
      data: [{coord: [0, 0]}],
      position: 'coord'
    });
    expect(noodle.type).toBe('ScatterplotLayer');
    expect((noodle as {position: string}).position).toBe('coord');
  });

  it('creates a HeatmapLayer noodle', () => {
    const noodle = createNoodle('HeatmapLayer', {
      data: [],
      position: 'coordinates'
    });
    expect(noodle.type).toBe('HeatmapLayer');
  });
});

describe('hydrateNoodle', () => {
  it('resolves field-path accessors into functions', () => {
    const noodle = createNoodle('ScatterplotLayer', {
      data: [{coord: [10, 20]}],
      position: 'coord',
      radius: 'size'
    });
    const props = hydrateNoodle(noodle);
    expect(typeof props.getPosition).toBe('function');
    expect((props.getPosition as (d: unknown) => unknown)({coord: [10, 20]})).toEqual([10, 20]);
  });

  it('supports nested dot-path accessors', () => {
    const noodle = createNoodle('ScatterplotLayer', {
      data: [{meta: {size: 42}}],
      position: 'coord',
      radius: 'meta.size'
    });
    const props = hydrateNoodle(noodle);
    expect((props.getRadius as (d: unknown) => unknown)({meta: {size: 42}})).toBe(42);
  });

  it('keeps static values as-is', () => {
    const noodle = createNoodle('ScatterplotLayer', {
      data: [],
      position: 'coord',
      fillColor: [255, 0, 0]
    });
    const props = hydrateNoodle(noodle);
    expect(props.getFillColor).toEqual([255, 0, 0]);
  });

  it('hydrates a PathLayer noodle', () => {
    const noodle = createNoodle('PathLayer', {
      data: [],
      path: 'coords',
      color: [100, 200, 50]
    });
    const props = hydrateNoodle(noodle);
    expect(props.getColor).toEqual([100, 200, 50]);
    expect(typeof props.getPath).toBe('function');
  });

  it('hydrates a TextLayer noodle', () => {
    const noodle = createNoodle('TextLayer', {
      data: [{pos: [1, 2], label: 'hello'}],
      position: 'pos',
      text: 'label'
    });
    const props = hydrateNoodle(noodle);
    expect((props.getText as (d: unknown) => unknown)({pos: [1, 2], label: 'hello'})).toBe('hello');
  });
});

describe('validateNoodle', () => {
  it('returns valid for a correct ScatterplotLayer noodle', () => {
    const result = validateNoodle({
      type: 'ScatterplotLayer',
      data: [],
      position: 'coord'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports missing type', () => {
    const result = validateNoodle({data: [], position: 'coord'});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('reports non-array data', () => {
    const result = validateNoodle({type: 'ScatterplotLayer', data: 'oops', position: 'x'});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('data'))).toBe(true);
  });

  it('reports missing position for ScatterplotLayer', () => {
    const result = validateNoodle({type: 'ScatterplotLayer', data: []});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('position'))).toBe(true);
  });

  it('reports missing path for PathLayer', () => {
    const result = validateNoodle({type: 'PathLayer', data: []});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('path'))).toBe(true);
  });

  it('reports invalid opacity', () => {
    const result = validateNoodle({
      type: 'ScatterplotLayer',
      data: [],
      position: 'coord',
      opacity: 2
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('opacity'))).toBe(true);
  });

  it('returns invalid for a non-object', () => {
    expect(validateNoodle(null).valid).toBe(false);
    expect(validateNoodle('string').valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DeckBuilder
// ---------------------------------------------------------------------------

describe('DeckBuilder', () => {
  it('builds a default config', () => {
    const config = new DeckBuilder().build();
    expect(config.initialViewState.zoom).toBe(1);
    expect(config.controller).toBe(true);
    expect(config.layers).toHaveLength(0);
    expect(config.width).toBe('100%');
  });

  it('chains addLayer calls', () => {
    const layerA = createScatterplotLayer({data: [], getPosition: () => [0, 0], id: 'a'});
    const layerB = createPathLayer({data: [], getPath: () => [], id: 'b'});

    const config = new DeckBuilder().addLayer(layerA).addLayer(layerB).build();
    expect(config.layers).toHaveLength(2);
    expect(config.layers[0].id).toBe('a');
    expect(config.layers[1].id).toBe('b');
  });

  it('prependLayer inserts at the start', () => {
    const layerA = createScatterplotLayer({data: [], getPosition: () => [0, 0], id: 'a'});
    const layerB = createPathLayer({data: [], getPath: () => [], id: 'b'});

    const config = new DeckBuilder().addLayer(layerA).prependLayer(layerB).build();
    expect(config.layers[0].id).toBe('b');
  });

  it('removeLayer removes by id', () => {
    const layer = createScatterplotLayer({data: [], getPosition: () => [0, 0], id: 'a'});
    const config = new DeckBuilder().addLayer(layer).removeLayer('a').build();
    expect(config.layers).toHaveLength(0);
  });

  it('replaceLayer swaps by id', () => {
    const layerA = createScatterplotLayer({data: [], getPosition: () => [0, 0], id: 'layer'});
    const layerB = createPathLayer({data: [], getPath: () => [], id: 'layer'});
    const config = new DeckBuilder().addLayer(layerA).replaceLayer(layerB).build();
    expect(config.layers[0].type).toBe('PathLayer');
  });

  it('setViewState is reflected in build output', () => {
    const config = new DeckBuilder()
      .setViewState({longitude: -74, latitude: 40.7, zoom: 10})
      .build();
    expect(config.initialViewState.longitude).toBe(-74);
  });

  it('setContainer sets the container field', () => {
    const config = new DeckBuilder().setContainer('map-div').build();
    expect(config.container).toBe('map-div');
  });

  it('getLayers does not mutate the internal list', () => {
    const builder = new DeckBuilder();
    const layer = createScatterplotLayer({data: [], getPosition: () => [0, 0]});
    builder.addLayer(layer);
    const layers = builder.getLayers();
    layers.pop();
    expect(builder.getLayers()).toHaveLength(1);
  });
});
