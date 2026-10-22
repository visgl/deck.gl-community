// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {
  DEFAULT_FILL_EXTRUSION_LIGHT,
  FillExtrusionLightingExtension,
  getFillExtrusionLightDirection
} from '../src/fill-extrusion-lighting-extension.ts';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  tiles: {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
  }
};

const BUILDING = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ]
    ]
  },
  properties: {layerName: 'land'}
};

/** Renders a style's one fill-extrusion layer for one tile. */
function renderExtrusion(
  style: {light?: unknown; paint?: Record<string, unknown>} = {},
  zoom = 15.6
): any {
  const styleDefinition = {
    version: 8,
    sources: SOURCES,
    ...(style.light === undefined ? {} : {light: style.light}),
    layers: [
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'tiles',
        'source-layer': 'land',
        paint: {'fill-extrusion-height': 10, ...style.paint}
      }
    ]
  };
  const layers = getBasemapLayers({idPrefix: 'test', mode: 'map', zoom, styleDefinition} as any);
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  const [sublayer] = vectorLayer.props.renderSubLayers({
    id: 'test-tiles-tile',
    data: [BUILDING],
    tile: {index: {x: 0, y: 0, z: Math.floor(zoom)}}
  });
  return sublayer;
}

describe('fill-extrusion lighting', () => {
  test('shades extrusions with the extension instead of deck.gl lights', () => {
    const sublayer = renderExtrusion();
    expect(
      sublayer.props.extensions.some(
        (extension: unknown) => extension instanceof FillExtrusionLightingExtension
      )
    ).toBe(true);
    expect(sublayer.props.fillExtrusionLight).toBe(DEFAULT_FILL_EXTRUSION_LIGHT);
    expect(sublayer.props.fillExtrusionVerticalGradient).toBe(true);
  });

  test('passes fill-extrusion-vertical-gradient', () => {
    const sublayer = renderExtrusion({paint: {'fill-extrusion-vertical-gradient': false}});
    expect(sublayer.props.fillExtrusionVerticalGradient).toBe(false);
  });

  test("evaluates the style's light at the zoom step, defaulting unset properties", () => {
    const light = {
      anchor: 'map',
      color: '#ff8000',
      intensity: ['interpolate', ['linear'], ['zoom'], 15, 0.2, 16, 0.6]
    };
    const sublayer = renderExtrusion({light});
    const {fillExtrusionLight} = sublayer.props;
    expect(fillExtrusionLight.anchor).toBe('map');
    expect(fillExtrusionLight.position).toEqual([1.15, 210, 30]);
    expect(fillExtrusionLight.color.map((value: number) => Math.round(value * 255))).toEqual([
      255, 128, 0
    ]);
    // At the zoom step 15.5.
    expect(fillExtrusionLight.intensity).toBeCloseTo(0.4, 5);
    // The same light object is kept within the zoom step, so tile sublayers are kept.
    expect(renderExtrusion({light}).props.fillExtrusionLight).toBe(fillExtrusionLight);
  });

  test('takes the default for a light property of the wrong type', () => {
    const sublayer = renderExtrusion({light: {intensity: 'bright', position: [1, 2]}});
    expect(sublayer.props.fillExtrusionLight.intensity).toBe(0.5);
    expect(sublayer.props.fillExtrusionLight.position).toEqual([1.15, 210, 30]);
  });
});

describe('getFillExtrusionLightDirection', () => {
  // MapLibre's default light, at azimuth 210 and polar 30 degrees, lights the walls facing south
  // and east of south (see `getFillExtrusionLightDirection`).
  test('reverses the horizontal part of the light, for walls facing out', () => {
    const [x, y, z] = getFillExtrusionLightDirection(DEFAULT_FILL_EXTRUSION_LIGHT, 0);
    expect(x).toBeCloseTo(-0.2875, 4);
    expect(y).toBeCloseTo(-0.498, 3);
    expect(z).toBeCloseTo(0.996, 3);
  });

  test('turns a viewport-anchored light with the bearing, and not a map-anchored one', () => {
    const viewport = getFillExtrusionLightDirection(DEFAULT_FILL_EXTRUSION_LIGHT, 90);
    expect(viewport[0]).toBeCloseTo(-0.498, 3);
    expect(viewport[1]).toBeCloseTo(0.2875, 4);
    const map = {...DEFAULT_FILL_EXTRUSION_LIGHT, anchor: 'map' as const};
    expect(getFillExtrusionLightDirection(map, 90)).toEqual(getFillExtrusionLightDirection(map, 0));
  });
});

describe('FillExtrusionLightingExtension', () => {
  const extension = new FillExtrusionLightingExtension();
  const layerOn = (type: string, extruded = true): any => ({
    context: {device: {type}},
    state: {polygonTesselator: {}},
    props: {extruded}
  });

  test('shades extruded polygons on WebGL only, leaving deck.gl lights on WebGPU', () => {
    expect(extension.isEnabled(layerOn('webgl'))).toBe(true);
    expect(extension.isEnabled(layerOn('webgpu'))).toBe(false);
    expect(extension.isEnabled(layerOn('webgl', false))).toBe(false);
  });
});
