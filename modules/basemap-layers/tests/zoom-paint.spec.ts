/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';
import {ZoomPaintContext, getZoomPaintValues} from '../src/globe-layers';
import {getZoomBucket} from '../src/style-accessor';
import {
  ZOOM_PAINT_FILL_COLOR_ROW,
  ZOOM_PAINT_LINE_COLOR_ROW,
  ZOOM_PAINT_WIDTH_ROW,
  ZoomPaintExtension,
  getZoomPaintOffset
} from '../src/zoom-paint-extension';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

function feature(type: string, properties: Record<string, unknown> = {}) {
  const coordinates =
    type === 'Polygon'
      ? [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0]
          ]
        ]
      : [
          [0, 0],
          [1, 1]
        ];
  return {
    type: 'Feature',
    geometry: {type, coordinates},
    properties: {layerName: 'land', ...properties}
  };
}

function makeStyle(styleLayers: Record<string, unknown>[]): any {
  return {
    version: 8,
    sources: SOURCES,
    layers: styleLayers.map(layer => ({source: 'tiles', 'source-layer': 'land', ...layer}))
  };
}

/** The tile layer state that tiles share, as in `StyledMVTLayer`. */
let context = new ZoomPaintContext();

/**
 * Renders one tile's sublayers, with paint from `ZoomPaintExtension` as `StyledMVTLayer` does on
 * WebGL, or without it.
 */
function renderTile(style: any, features: unknown[], zoom: number, webgl = true): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    zoom,
    styleDefinition: Array.isArray(style) ? makeStyle(style) : style
  }).find(layer => layer.id === 'test-tiles');
  context.zoom = getZoomBucket(zoom);
  return vectorLayer.props
    .renderSubLayers({
      id: 'tile',
      data: features,
      tile: {index: {x: 0, y: 0, z: 12}},
      zoomPaintContext: webgl ? context : null
    })
    .flat();
}

/** A sublayer's zoom paint values at a zoom. */
function valuesAt(layer: any, zoom: number): Float32Array {
  context.zoom = getZoomBucket(zoom);
  return layer.props.zoomPaint.getValues();
}

/** An accessor's value for each of a sublayer's features. */
function valuesOf(layer: any, accessor: string): unknown[] {
  const value = layer.props[accessor];
  return layer.props.data.map((object: any, index: number) =>
    typeof value === 'function' ? value(object, {index}) : value
  );
}

/** The texel of a style layer in a row of zoom paint values. */
function texel(values: Float32Array, row: number, part: number): number[] {
  const offset = getZoomPaintOffset(row, part);
  return Array.from(values.subarray(offset, offset + 4));
}

const ZOOM_WIDTH = ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 5];
const line = (id: string, paint: Record<string, unknown>) => ({id, type: 'line', paint});
const fill = (id: string, paint: Record<string, unknown>) => ({id, type: 'fill', paint});

describe('fills and lines take zoom-dependent paint from a texture', () => {
  test('a batch of constant widths and colors has constant attributes and per-part values', () => {
    const road = feature('LineString');
    const styleLayers = [
      line('casing', {'line-color': '#000000', 'line-width': ZOOM_WIDTH}),
      line('road', {'line-color': '#ffffff', 'line-width': 2})
    ];
    const [layer] = renderTile(styleLayers, [road], 12);
    expect(layer.props.extensions.some((e: unknown) => e instanceof ZoomPaintExtension)).toBe(true);
    expect(layer.props.getLineWidth).toBe(1);
    expect(layer.props.getLineColor).toEqual([0, 0, 0, 0]);
    expect(valuesOf(layer, 'getStylePart')).toEqual([0, 1]);

    const values = valuesAt(layer, 12);
    expect(texel(values, ZOOM_PAINT_WIDTH_ROW, 0)[0]).toBe(3);
    expect(texel(values, ZOOM_PAINT_WIDTH_ROW, 1)[0]).toBe(2);
    expect(texel(values, ZOOM_PAINT_LINE_COLOR_ROW, 0)).toEqual([0, 0, 0, 1]);
    expect(texel(values, ZOOM_PAINT_LINE_COLOR_ROW, 1)).toEqual([1, 1, 1, 1]);
    expect(valuesAt(layer, 13)[getZoomPaintOffset(ZOOM_PAINT_WIDTH_ROW, 0)]).toBe(4);
  });

  test('gives each part the width and colors the CPU path draws, at every zoom step', () => {
    const features = [feature('LineString', {w: 3}), feature('Polygon')];
    const styleLayers = [
      line('a', {
        'line-width': ZOOM_WIDTH,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.2, 14, 1]
      }),
      line('b', {'line-width': ['get', 'w'], 'line-color': '#336699'}),
      line('c', {'line-color': ['interpolate', ['linear'], ['zoom'], 10, '#000', 14, '#fff']})
    ];
    for (const zoom of [10, 11.25, 12.5, 13.75]) {
      const [cpu] = renderTile(styleLayers, features, zoom, false);
      const [gpu] = renderTile(styleLayers, features, zoom);
      const values = valuesAt(gpu, zoom);
      const parts = valuesOf(gpu, 'getStylePart') as number[];
      const widths = valuesOf(gpu, 'getLineWidth') as number[];
      const colors = valuesOf(gpu, 'getLineColor') as number[][];
      const cpuWidths = valuesOf(cpu, 'getLineWidth') as number[];
      const cpuColors = valuesOf(cpu, 'getLineColor') as number[][];
      parts.forEach((part, index) => {
        // The shader multiplies the width attribute by the part's width.
        expect(widths[index] * texel(values, ZOOM_PAINT_WIDTH_ROW, part)[0]).toBeCloseTo(
          cpuWidths[index],
          5
        );
        const color = texel(values, ZOOM_PAINT_LINE_COLOR_ROW, part);
        // The shader takes the attribute where the part's alpha is negative.
        const drawn = color[3] < 0 ? colors[index] : color.map(channel => channel * 255);
        // An 8 bit attribute rounds the CPU path's batched colors.
        drawn.forEach((channel, i) =>
          expect(channel).toBeCloseTo(new Uint8ClampedArray([cpuColors[index][i]])[0], 4)
        );
      });
    }
  });

  test('a per-feature width stays in the attribute, with a part width of 1', () => {
    const styleLayers = [line('a', {'line-width': ['get', 'w']}), line('b', {'line-width': 4})];
    const [layer] = renderTile(styleLayers, [feature('LineString', {w: 7})], 12);
    expect(valuesOf(layer, 'getLineWidth')).toEqual([7, 1]);
    const values = valuesAt(layer, 12);
    expect(texel(values, ZOOM_PAINT_WIDTH_ROW, 0)[0]).toBe(1);
    expect(texel(values, ZOOM_PAINT_WIDTH_ROW, 1)[0]).toBe(4);
  });

  test("a sublayer's props do not change across a zoom step", () => {
    const features = [feature('LineString'), feature('Polygon')];
    const style = makeStyle([
      line('a', {'line-width': ZOOM_WIDTH}),
      line('b', {'line-width': ZOOM_WIDTH, 'line-color': '#ff0000'}),
      fill('c', {'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 14, 1]})
    ]);
    const early = renderTile(style, features, 12);
    const late = renderTile(style, features, 12.25);
    expect(late.map(layer => layer.id)).toEqual(early.map(layer => layer.id));
    late.forEach((layer, index) => {
      const before = early[index].props;
      expect(layer.props.data).toBe(before.data);
      expect(layer.props.zoomPaint).toBe(before.zoomPaint);
      // Constants, which deck.gl compares by value.
      for (const key of ['getLineWidth', 'getLineColor', 'getFillColor']) {
        expect(layer.props[key], key).toEqual(before[key]);
      }
      expect(layer.props.updateTriggers).toEqual(before.updateTriggers);
    });
    // Only the values change.
    expect(valuesAt(late[0], 12.25)).not.toEqual(valuesAt(late[0], 12));
  });

  test('evaluates again when a paint value is replaced', () => {
    const style = makeStyle([line('a', {'line-width': 2}), line('b', {'line-width': 3})]);
    const [layer] = renderTile(style, [feature('LineString')], 12);
    const before = valuesAt(layer, 12);
    expect(valuesAt(layer, 12)).toBe(before);
    style.layers[0].paint['line-width'] = 5;
    const after = valuesAt(layer, 12);
    expect(texel(after, ZOOM_PAINT_WIDTH_ROW, 0)[0]).toBe(5);
  });

  test('a fill color that is per feature keeps the attribute', () => {
    const styleLayers = [
      fill('a', {'fill-color': ['match', ['get', 'k'], 'x', '#ff0000', '#0000ff']}),
      fill('b', {'fill-color': '#00ff00'})
    ];
    const [layer] = renderTile(styleLayers, [feature('Polygon', {k: 'x'})], 12);
    expect(valuesOf(layer, 'getFillColor')).toEqual([
      [255, 0, 0, 255],
      [0, 0, 0, 0]
    ]);
    const values = valuesAt(layer, 12);
    expect(texel(values, ZOOM_PAINT_FILL_COLOR_ROW, 0)[3]).toBe(-1);
    expect(texel(values, ZOOM_PAINT_FILL_COLOR_ROW, 1)).toEqual([0, 1, 0, 1]);
  });

  test('colors of one style layer stay unrounded, as deck.gl draws a layer-wide constant', () => {
    // hsl(0, 0%, 50%) is 127.5 gray.
    const gray = 'hsl(0, 0%, 50%)';
    const alone = getZoomPaintValues([fill('a', {'fill-color': gray}) as any], 'map', 12);
    expect(texel(alone, ZOOM_PAINT_FILL_COLOR_ROW, 0)[0]).toBeCloseTo(127.5 / 255, 6);
    const same = getZoomPaintValues(
      [fill('a', {'fill-color': gray}), fill('b', {'fill-color': gray})] as any,
      'map',
      12
    );
    expect(texel(same, ZOOM_PAINT_FILL_COLOR_ROW, 1)[0]).toBeCloseTo(127.5 / 255, 6);
    const mixed = getZoomPaintValues(
      [fill('a', {'fill-color': gray}), fill('b', {'fill-color': '#000'})] as any,
      'map',
      12
    );
    expect(texel(mixed, ZOOM_PAINT_FILL_COLOR_ROW, 0)[0]).toBeCloseTo(128 / 255, 6);
  });

  test('lines with an offset, and the CPU path, keep their paint in attributes', () => {
    const offset = renderTile(
      [line('a', {'line-width': ZOOM_WIDTH, 'line-offset': 2})],
      [feature('LineString')],
      12
    );
    expect(offset[0].props.zoomPaint).toBeUndefined();
    expect(offset[0].props.getLineWidth).toBe(3);
    const cpu = renderTile(
      [line('a', {'line-width': ZOOM_WIDTH})],
      [feature('LineString')],
      12,
      false
    );
    expect(cpu[0].props.zoomPaint).toBeUndefined();
    expect(cpu[0].props.getLineWidth).toBe(3);
  });

  test('blurred lines and translated fills, which take their own extensions, keep their paint', () => {
    const blurred = renderTile(
      [line('a', {'line-width': ZOOM_WIDTH, 'line-blur': 1})],
      [feature('LineString')],
      12
    );
    expect(blurred[0].props.zoomPaint).toBeUndefined();
    expect(blurred[0].props.getLineWidth).toBe(3);
    const translated = renderTile(
      [
        fill('a', {
          'fill-color': ['interpolate', ['linear'], ['zoom'], 10, '#000000', 14, '#ffffff'],
          'fill-translate': [1, 1]
        })
      ],
      [feature('Polygon')],
      12
    );
    expect(translated[0].props.zoomPaint).toBeUndefined();
    expect(translated[0].props.getFillColor).toEqual([127.5, 127.5, 127.5, 255]);
  });
});

describe('zoom paint textures', () => {
  function fakeDevice() {
    const textures: any[] = [];
    const device: any = {
      textures,
      createTexture: vi.fn(() => {
        const texture = {device, writeData: vi.fn(), destroy: vi.fn()};
        textures.push(texture);
        return texture;
      })
    };
    return device;
  }

  test('are created once per device and written when the values change', () => {
    const zoomPaintContext = new ZoomPaintContext();
    const styleLayers = [line('a', {'line-width': ZOOM_WIDTH})] as any[];
    const zoomPaint = zoomPaintContext.get(styleLayers, 'map');
    expect(zoomPaintContext.get(styleLayers, 'map')).toBe(zoomPaint);
    const device = fakeDevice();
    zoomPaintContext.zoom = 12;
    const texture = zoomPaint.getTexture(device) as any;
    expect(zoomPaint.getTexture(device)).toBe(texture);
    expect(texture.writeData).toHaveBeenCalledTimes(1);
    zoomPaintContext.zoom = 12.25;
    zoomPaint.getTexture(device);
    expect(texture.writeData).toHaveBeenCalledTimes(2);
    expect(device.createTexture).toHaveBeenCalledTimes(1);

    const other = fakeDevice();
    zoomPaint.getTexture(other);
    expect(texture.destroy).toHaveBeenCalled();
    expect(other.createTexture).toHaveBeenCalledTimes(1);
  });

  test('are destroyed with the tile layer, or when a new style replaces their style layers', () => {
    const zoomPaintContext = new ZoomPaintContext();
    const device = fakeDevice();
    const first = zoomPaintContext.get([line('a', {})] as any[], 'map');
    first.getTexture(device);
    // The same ids in a new style.
    const second = zoomPaintContext.get([line('a', {})] as any[], 'map');
    expect(second).not.toBe(first);
    expect(device.textures[0].destroy).toHaveBeenCalled();
    second.getTexture(device);
    const third = zoomPaintContext.get([line('b', {})] as any[], 'globe');
    third.getTexture(device);
    zoomPaintContext.destroy();
    expect(device.textures[1].destroy).toHaveBeenCalled();
    expect(device.textures[2].destroy).toHaveBeenCalled();
  });

  test('of style layers no sublayer draws any more are destroyed at the next style change', () => {
    const zoomPaintContext = new ZoomPaintContext();
    const device = fakeDevice();
    zoomPaintContext.setStyle('first');
    zoomPaintContext.get([line('a', {})] as any[], 'map').getTexture(device);
    // A new style without 'a': its sublayers ask for 'b' only.
    zoomPaintContext.setStyle('second');
    const b = [line('b', {})] as any[];
    zoomPaintContext.get(b, 'map').getTexture(device);
    expect(device.textures[0].destroy).not.toHaveBeenCalled();
    // At the next change, 'a' was not asked for since the previous one; 'b' was.
    zoomPaintContext.setStyle('third');
    expect(device.textures[0].destroy).toHaveBeenCalled();
    zoomPaintContext.get(b, 'map');
    zoomPaintContext.setStyle('fourth');
    expect(device.textures[1].destroy).not.toHaveBeenCalled();
    // The same style changes nothing.
    zoomPaintContext.setStyle('fourth');
    zoomPaintContext.setStyle('fourth');
    expect(device.textures[1].destroy).not.toHaveBeenCalled();
  });

  test("follow the vector tile layer's style layers", () => {
    const layers = [{id: 'a', type: 'line', source: 'tiles', 'source-layer': 'road', paint: {}}];
    const styleDefinition: any = {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers
    };
    const layer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 12,
      styleDefinition
    }).find((candidate: any) => candidate.id === 'test-tiles');
    layer.context = {viewport: {zoom: 12}};
    layer.state = {tilesetViews: new Map(), tileLayers: new Map()};
    const setStyle = vi.spyOn(ZoomPaintContext.prototype, 'setStyle');
    try {
      layer.renderSubLayers({
        ...layer.props,
        id: 'tile',
        data: [],
        tile: {id: '0-0-12', index: {x: 0, y: 0, z: 12}}
      });
      expect(setStyle).toHaveBeenCalledWith(layers);
    } finally {
      setStyle.mockRestore();
    }
  });
});
