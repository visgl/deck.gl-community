/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';
import {RasterColorExtension, getRasterColorUniforms} from '../src/raster-color-extension.ts';

const SOURCES = {
  raster: {type: 'raster', tiles: ['https://tiles.example.com/{z}/{x}/{y}.png'], tileSize: 256}
};

/** The tile layer that draws one raster style layer. */
function getRasterLayer(paint: Record<string, unknown> | undefined, zoom = 5): any {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {
      version: 8,
      sources: SOURCES,
      layers: [{id: 'imagery', type: 'raster', source: 'raster', ...(paint ? {paint} : {})}]
    } as any
  });
  return layers.find(layer => layer.id === 'test-imagery');
}

/** The bitmap layer that a raster tile layer draws for one tile. */
function renderTile(rasterLayer: any): any {
  return rasterLayer.props.renderSubLayers({
    ...rasterLayer.props,
    id: 'test-imagery-tile',
    data: null,
    tile: {index: {x: 0, y: 0, z: 5}, bbox: {west: 0, south: 0, east: 1, north: 1}}
  });
}

/** The alpha a layer draws with: deck.gl's shaders use `opacity ** (1 / 2.2)`. */
function getDrawnOpacity(layer: any): number {
  return layer.props.opacity ** (1 / 2.2);
}

describe('raster-opacity', () => {
  test('defaults to opaque', () => {
    expect(getDrawnOpacity(getRasterLayer(undefined))).toBe(1);
  });

  test('sets the opacity of the layer and of each tile', () => {
    const rasterLayer = getRasterLayer({'raster-opacity': 0.4});
    expect(getDrawnOpacity(rasterLayer)).toBeCloseTo(0.4, 10);
    expect(getDrawnOpacity(renderTile(rasterLayer))).toBeCloseTo(0.4, 10);
  });

  test('follows a zoom-dependent value', () => {
    const paint = {'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 8, 1]};
    expect(getDrawnOpacity(getRasterLayer(paint, 4))).toBe(0);
    expect(getDrawnOpacity(getRasterLayer(paint, 6))).toBeCloseTo(0.5, 10);
    expect(getDrawnOpacity(getRasterLayer(paint, 9))).toBe(1);
  });
});

describe('raster color adjustments', () => {
  test('a layer without them draws without the color extension', () => {
    const rasterLayer = getRasterLayer({'raster-opacity': 0.5});
    expect(rasterLayer.props.extensions).toEqual([]);
  });

  test('a layer that sets them to their defaults draws without the color extension', () => {
    const rasterLayer = getRasterLayer({
      'raster-brightness-min': 0,
      'raster-brightness-max': 1,
      'raster-saturation': 0,
      'raster-contrast': 0,
      'raster-hue-rotate': 0
    });
    expect(rasterLayer.props.extensions).toEqual([]);
  });

  test('are passed to each tile with the color extension, defaults filled in', () => {
    const rasterLayer = getRasterLayer({'raster-saturation': -1, 'raster-hue-rotate': 90});
    const tile = renderTile(rasterLayer);
    expect(tile.props.extensions).toHaveLength(1);
    expect(tile.props.extensions[0]).toBeInstanceOf(RasterColorExtension);
    expect(tile.props.rasterColorAdjustments).toEqual({
      brightnessMin: 0,
      brightnessMax: 1,
      saturation: -1,
      contrast: 0,
      hueRotate: 90
    });
  });

  test('each adjustment is read from its own property', () => {
    const rasterLayer = getRasterLayer({
      'raster-brightness-min': 0.1,
      'raster-brightness-max': 0.9,
      'raster-saturation': 0.2,
      'raster-contrast': 0.3,
      'raster-hue-rotate': 40
    });
    expect(rasterLayer.props.rasterColorAdjustments).toEqual({
      brightnessMin: 0.1,
      brightnessMax: 0.9,
      saturation: 0.2,
      contrast: 0.3,
      hueRotate: 40
    });
  });

  test('follow zoom-dependent values', () => {
    const paint = {'raster-contrast': ['interpolate', ['linear'], ['zoom'], 0, 0, 10, 0.5]};
    expect(getRasterLayer(paint, 0).props.extensions).toEqual([]);
    expect(getRasterLayer(paint, 4).props.rasterColorAdjustments.contrast).toBeCloseTo(0.2);
  });

  // The expected values follow MapLibre GL JS's `raster_program.ts`.
  test('compute the shader uniforms as MapLibre does', () => {
    const identity = getRasterColorUniforms({
      brightnessMin: 0,
      brightnessMax: 1,
      saturation: 0,
      contrast: 0,
      hueRotate: 0
    });
    expect(identity.brightnessLow).toBe(0);
    expect(identity.brightnessHigh).toBe(1);
    expect(identity.saturationFactor).toBe(-0);
    expect(identity.contrastFactor).toBe(1);
    expect(identity.spinWeights).toEqual([1, 0, 0]);

    const adjusted = getRasterColorUniforms({
      brightnessMin: 0.2,
      brightnessMax: 0.7,
      saturation: 0.5,
      contrast: 0.5,
      hueRotate: 120
    });
    expect(adjusted.brightnessLow).toBe(0.2);
    expect(adjusted.brightnessHigh).toBe(0.7);
    expect(adjusted.saturationFactor).toBeCloseTo(1 - 1 / 0.501, 10);
    expect(adjusted.contrastFactor).toBe(2);
    // A third of a turn maps red to green, green to blue and blue to red.
    expect(adjusted.spinWeights[0]).toBeCloseTo(0, 10);
    expect(adjusted.spinWeights[1]).toBeCloseTo(0, 10);
    expect(adjusted.spinWeights[2]).toBeCloseTo(1, 10);

    const reduced = getRasterColorUniforms({
      brightnessMin: 0,
      brightnessMax: 1,
      saturation: -0.5,
      contrast: -0.5,
      hueRotate: 0
    });
    expect(reduced.saturationFactor).toBe(0.5);
    expect(reduced.contrastFactor).toBe(0.5);
  });
});

describe('raster-resampling', () => {
  test('defaults to linear filtering', () => {
    const rasterLayer = getRasterLayer(undefined);
    expect(rasterLayer.props.textureParameters).toBeNull();
    expect(renderTile(rasterLayer).id).toBe('test-imagery-tile');
  });

  test('nearest magnifies each tile with the nearest texel', () => {
    const tile = renderTile(getRasterLayer({'raster-resampling': 'nearest'}));
    expect(tile.props.textureParameters).toEqual({magFilter: 'nearest'});
    // A texture keeps its filter, so switching filters creates a new bitmap layer.
    expect(tile.id).toBe('test-imagery-tile-nearest');
  });

  test('resampling: nearest is honoured too', () => {
    const tile = renderTile(getRasterLayer({resampling: 'nearest'}));
    expect(tile.props.textureParameters).toEqual({magFilter: 'nearest'});
  });

  test('follows a zoom-dependent value', () => {
    const paint = {'raster-resampling': ['step', ['zoom'], 'linear', 6, 'nearest']};
    expect(getRasterLayer(paint, 5).props.textureParameters).toBeNull();
    expect(getRasterLayer(paint, 7).props.textureParameters).toEqual({magFilter: 'nearest'});
  });
});
