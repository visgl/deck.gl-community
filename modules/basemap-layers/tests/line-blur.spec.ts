// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {LayerExtension} from '@deck.gl/core';
import {PathStyleExtension} from '@deck.gl/extensions';
import {describe, expect, test} from 'vitest';
import {getBasemapLayers, getLineOffset} from '../src/globe-layers';
import {LineBlurExtension, getBlurredLineWidth} from '../src/line-blur-extension';

function line(properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties
  };
}

/** Renders one line style layer for one tile and returns all its sublayers. */
function renderLines(
  paint: Record<string, unknown>,
  features = [line()],
  zoom = 12,
  extensions?: unknown[]
): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {
      version: 8,
      sources: {
        tiles: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
        }
      },
      layers: [{id: 'line', type: 'line', source: 'tiles', paint}]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  return vectorLayer.props
    .renderSubLayers({
      id: 'test-tile',
      data: features,
      extensions,
      tile: {index: {x: 0, y: 0, z: Math.floor(zoom)}}
    })
    .flat();
}

function getBlurExtensions(layer: any): any[] {
  return (layer.props.extensions || []).filter(
    (extension: any) => extension instanceof LineBlurExtension
  );
}

function evaluate(layer: any, name: string, features: any[]): unknown[] {
  const accessor = layer.props[name];
  return features.map((feature, index) =>
    typeof accessor === 'function' ? accessor(feature, {index}) : accessor
  );
}

/** A stand-in for a layer's `this` in the extension's methods. */
function fakeLayer(state: Record<string, unknown>, deviceType = 'webgl'): any {
  const attributes: Record<string, unknown> = {};
  return {
    context: {device: {type: deviceType}},
    state,
    attributes,
    getAttributeManager: () => ({
      addInstanced: (added: object) => Object.assign(attributes, added)
    })
  };
}

describe('line-blur', () => {
  test('leaves lines without line-blur unchanged', () => {
    const [layer] = renderLines({'line-width': 2});
    expect(getBlurExtensions(layer)).toEqual([]);
    expect(layer.props.getBlur).toBeUndefined();
    expect(layer.props.lineAntialiasing).toBe(false);
  });

  test('blurs with antialiasing, after the tile and path style extensions', () => {
    const tileExtension = new LayerExtension();
    const paint = {'line-blur': 3, 'line-dasharray': [2, 1]};
    const [layer] = renderLines(paint, [line()], 12, [tileExtension]);
    const {extensions} = layer.props;
    expect(extensions).toHaveLength(3);
    expect(extensions[0]).toBe(tileExtension);
    expect(extensions[1]).toBeInstanceOf(PathStyleExtension);
    expect(extensions[2]).toBeInstanceOf(LineBlurExtension);
    // Shared, so deck.gl does not see the extensions change.
    expect(extensions[2]).toBe(getBlurExtensions(renderLines({'line-blur': 1})[0])[0]);
    expect(layer.props.getBlur).toBe(3);
    expect(layer.props.lineAntialiasing).toBe(true);
  });

  test('evaluates data-driven and zoom-dependent blur, clamped at 0', () => {
    const features = [line({blur: -2}), line({blur: 4}), line()];
    const [layer] = renderLines({'line-blur': ['get', 'blur']}, features);
    expect(evaluate(layer, 'getBlur', features)).toEqual([0, 4, 0]);

    const paint = {
      'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 0, 14, 8]
    };
    const [low] = renderLines(paint, [line()], 10);
    const [high] = renderLines(paint, [line()], 13);
    expect(low.props.getBlur).toBe(0);
    expect(high.props.getBlur).toBe(6);

    const perFeature = {
      'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 0, 14, ['get', 'blur']]
    };
    const [lowFeature] = renderLines(perFeature, [line({blur: 8})], 10);
    const [highFeature] = renderLines(perFeature, [line({blur: 8})], 13);
    expect(evaluate(highFeature, 'getBlur', [line({blur: 8})])).toEqual([6]);
    expect(lowFeature.props.updateTriggers.getBlur).not.toEqual(
      highFeature.props.updateTriggers.getBlur
    );
  });

  test('draws each line of a gap blur wider, and blur / 2 closer to the gap', () => {
    const features = [line()];
    const layers = renderLines(
      {
        'line-width': 4,
        'line-gap-width': 8,
        'line-blur': 2,
        'line-offset': 1
      },
      features
    );
    expect(layers).toHaveLength(2);
    // Each line covers 4 - 2 to 4 + 4 pixels from the gap's center, so is centered 5 away.
    expect(layers.map(layer => evaluate(layer, 'getLineWidth', features)[0])).toEqual([6, 6]);
    expect(layers.map(layer => layer.props.getOffset(features[0]))).toEqual([
      (1 + 5) / 6,
      (1 - 5) / 6
    ]);
  });

  test('keeps the width of features without a data-driven gap', () => {
    const features = [line({gap: 0}), line({gap: 8})];
    const layers = renderLines(
      {'line-width': 4, 'line-gap-width': ['get', 'gap'], 'line-blur': 2},
      features
    );
    expect(evaluate(layers[0], 'getLineWidth', features)).toEqual([4, 6]);
    expect(evaluate(layers[1], 'getLineWidth', features)).toEqual([0, 6]);
    expect(features.map(feature => layers[0].props.getOffset(feature))).toEqual([0, 5 / 6]);
  });

  test('blurred lines keep their style layer index and depth after an extrusion', () => {
    const vectorLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'globe',
      zoom: 15,
      styleDefinition: {
        version: 8,
        sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
        layers: [
          {id: 'building', type: 'fill-extrusion', source: 'tiles', 'source-layer': 'building'},
          {
            id: 'boundary',
            type: 'line',
            source: 'tiles',
            'source-layer': 'boundary',
            paint: {'line-width': 4, 'line-gap-width': 8, 'line-blur': 2}
          }
        ]
      } as any
    }).find(layer => layer.id === 'test-tiles');
    const feature = (layerName: string, type: string, coordinates: unknown) => ({
      type: 'Feature',
      geometry: {type, coordinates},
      properties: {layerName}
    });
    const sublayers = vectorLayer.props
      .renderSubLayers({
        id: 'tile',
        data: [
          feature('building', 'Polygon', [
            [
              [0, 0],
              [0.001, 0],
              [0.001, 0.001],
              [0, 0]
            ]
          ]),
          feature('boundary', 'LineString', [
            [0, 0],
            [0.001, 0.001]
          ])
        ],
        tile: {index: {x: 0, y: 0, z: 15}}
      })
      .flat(Infinity)
      .filter((layer: any) => layer.id.startsWith('tile-"boundary"'));
    // Both lines of the gap.
    expect(sublayers).toHaveLength(2);
    for (const layer of sublayers) {
      expect(getBlurExtensions(layer)).toHaveLength(1);
      expect(layer.props.styleLayerIndex).toBe(1);
      expect(layer.props.parameters).toMatchObject({
        depthTest: true,
        depthCompare: 'less-equal',
        depthWriteEnabled: false
      });
    }
  });

  test('getLineOffset and getBlurredLineWidth', () => {
    expect(getBlurredLineWidth(4, 8, 2)).toBe(6);
    expect(getBlurredLineWidth(4, 0, 2)).toBe(4);
    expect(getBlurredLineWidth(0, 8, 2)).toBe(0);
    expect(getLineOffset(0, 8, 4, 1, 2)).toBe(5 / 6);
    expect(getLineOffset(0, 8, 4, -1, 2)).toBe(-5 / 6);
    // Without a gap, blur does not move the line.
    expect(getLineOffset(6, 0, 3, 1, 2)).toBe(2);
    // Without blur, as before.
    expect(getLineOffset(0, 4, 2, 1)).toBe(1.5);
  });

  test('adds the attribute and shader code to path layers only', () => {
    const extension = new LineBlurExtension();
    const path = fakeLayer({pathTesselator: {}});
    extension.initializeState.call(path, undefined as any, extension);
    expect(Object.keys(path.attributes)).toEqual(['instanceLineBlur']);
    const {inject} = extension.getShaders.call(path, extension) as any;
    expect(inject['fs:#main-end']).toContain('edgePixels');
    expect(inject['vs:#main-end']).toContain('lineBlur_blur');

    for (const other of [fakeLayer({}), fakeLayer({pathTesselator: {}}, 'webgpu')]) {
      extension.initializeState.call(other, undefined as any, extension);
      expect(other.attributes).toEqual({});
      expect(extension.getShaders.call(other, extension)).toEqual({});
    }
  });
});
