/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {PathStyleExtension} from '@deck.gl/extensions';
import {getBasemapLayers} from '../src/index.ts';
import {isSameProps} from '../src/globe-layers';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

const CONTENT = [
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
    properties: {layerName: 'water'}
  },
  {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: {layerName: 'road'}
  }
];

const STYLE_LAYERS = [
  {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
  // A different cap keeps the two lines in sublayers of their own.
  {
    id: 'road',
    type: 'line',
    source: 'tiles',
    'source-layer': 'road',
    paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 10, 3]}
  },
  {
    id: 'rail',
    type: 'line',
    source: 'tiles',
    'source-layer': 'road',
    layout: {'line-cap': 'round'},
    paint: {'line-width': 2}
  },
  {
    id: 'path',
    type: 'line',
    source: 'tiles',
    'source-layer': 'road',
    paint: {'line-width': 2, 'line-gap-width': 1}
  }
];

function getTileLayer(zoom: number, styleLayers: any[], minzoom?: number): any {
  const sources = {tiles: {...SOURCES.tiles, minzoom}};
  return getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {version: 8, sources, layers: styleLayers} as any
  }).find((layer: any) => layer.id === 'test-tiles');
}

/**
 * Renders the tile layer's tiles at `zoom`, as deck.gl does after an update that regenerates
 * the tile sublayers: the tile layer is a new instance with the previous one's state.
 */
function renderAt(
  zoom: number,
  state?: any,
  styleLayers = STYLE_LAYERS,
  minzoom?: number,
  webgl = true
) {
  const tileLayer = getTileLayer(zoom, styleLayers, minzoom);
  // Without WebGL, zoom-dependent paint is evaluated into props (see `ZoomPaintExtension`).
  tileLayer.context = {viewport: {zoom, resolution: 0}, device: {type: webgl ? 'webgl' : 'webgpu'}};
  tileLayer.internalState = {};
  tileLayer.state = state ?? {
    tileLayers: new Map(),
    // One view, which shows both tiles.
    tilesetViews: new Map([['default', {isTileVisible: () => true}]]),
    tileset: {
      tiles: ['a', 'b'].map((id, x) => ({
        id,
        index: {x, y: 0, z: 8},
        bbox: {west: 0, south: 0, east: 1, north: 1},
        isLoaded: true,
        content: CONTENT
      }))
    }
  };
  // An update of the tile layer's triggers drops every tile's sublayers.
  tileLayer.state.tileLayers.clear();
  const layers: any[] = tileLayer.renderLayers();
  return {state: tileLayer.state, layers: new Map(layers.map(layer => [layer.id, layer]))};
}

describe('tile sublayers across a zoom step', () => {
  test('keep their instance when their props do not change', () => {
    const first = renderAt(8.1);
    const second = renderAt(8.3, first.state);
    expect([...second.layers.keys()]).toEqual([...first.layers.keys()]);
    for (const [id, layer] of second.layers) {
      // The road's zoom-dependent width, which changes from 8 to 8.25, is not a prop.
      expect(layer, id).toBe(first.layers.get(id));
    }
  });

  test('are new when a zoom-dependent value changes, where it is a prop', () => {
    const first = renderAt(8.1, undefined, STYLE_LAYERS, undefined, false);
    const second = renderAt(8.3, first.state, STYLE_LAYERS, undefined, false);
    for (const [id, layer] of second.layers) {
      // Only the zoom-dependent road width changes from 8 to 8.25.
      expect(layer === first.layers.get(id), id).toBe(!id.includes('"road"'));
    }
  });

  test('keep both sides of a line with a gap', () => {
    const first = renderAt(8.1);
    const second = renderAt(8.3, first.state);
    const gapIds = [...second.layers.keys()].filter(id => id.endsWith('-gap'));
    expect(gapIds).toEqual(['test-tiles-a-"path"-gap', 'test-tiles-b-"path"-gap']);
    for (const id of gapIds) {
      expect(second.layers.get(id)).toBe(first.layers.get(id));
    }
  });

  test('are new when a style value changes', () => {
    const first = renderAt(8.1);
    const styleLayers = STYLE_LAYERS.map(layer =>
      layer.id === 'water' ? {...layer, paint: {'fill-color': '#ff0000'}} : layer
    );
    const second = renderAt(8.3, first.state, styleLayers);
    expect(second.layers.get('test-tiles-a-"water"')).not.toBe(
      first.layers.get('test-tiles-a-"water"')
    );
    expect(second.layers.get('test-tiles-a-"rail"')).toBe(first.layers.get('test-tiles-a-"rail"'));
  });

  test("record the tile's props", () => {
    const {layers} = renderAt(8.1);
    const second = renderAt(8.3, renderAt(8.2).state);
    for (const layers_ of [layers, second.layers]) {
      for (const layer of layers_.values()) {
        expect(layer.props.tile?.id).toBe(layer.id.split('-')[2]);
      }
    }
  });
});

describe('isSameProps', () => {
  test('compares arrays, plain objects and extensions by value', () => {
    const props = () => ({
      id: 'a',
      getLineColor: [1, 2, 3, 255],
      coordinateOrigin: [1, 2, 0],
      parameters: {depthTest: true},
      updateTriggers: {getLineWidth: [12, 0.5]},
      extensions: [new PathStyleExtension({dash: true})]
    });
    expect(isSameProps(props(), props())).toBe(true);
    expect(isSameProps(props(), {...props(), getLineColor: [1, 2, 3, 254]})).toBe(false);
    expect(isSameProps(props(), {...props(), parameters: {depthTest: false}})).toBe(false);
    expect(isSameProps(props(), {...props(), updateTriggers: {getLineWidth: [12, 0.75]}})).toBe(
      false
    );
    expect(
      isSameProps(props(), {...props(), extensions: [new PathStyleExtension({offset: true})]})
    ).toBe(false);
    const {id: _, ...withoutId} = props();
    expect(isSameProps(props(), withoutId)).toBe(false);
  });

  test('compares data by identity, as deck.gl does', () => {
    const data = [{id: 1}];
    expect(isSameProps({data}, {data})).toBe(true);
    expect(isSameProps({data}, {data: [{id: 1}]})).toBe(false);
  });

  test('accepts new per-feature accessors, not other new functions', () => {
    expect(isSameProps({getLineWidth: () => 1}, {getLineWidth: () => 1})).toBe(true);
    expect(isSameProps({zoomPaint: {getValues: () => 1}}, {zoomPaint: {getValues: () => 1}})).toBe(
      false
    );
    expect(isSameProps({getLineWidth: () => 1}, {getLineWidth: 1})).toBe(false);
    expect(isSameProps({onHover: () => 1}, {onHover: () => 1})).toBe(false);
  });
});
