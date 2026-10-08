// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {PathStyleExtension} from '@deck.gl/extensions';
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  tiles: {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
  }
};

const SQUARE = [
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0]
  ]
];

function polygon(properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {type: 'Polygon', coordinates: SQUARE},
    properties: {layerName: 'land', ...properties}
  };
}

function multiPolygon(properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {type: 'MultiPolygon', coordinates: [SQUARE, SQUARE]},
    properties: {layerName: 'land', ...properties}
  };
}

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
    properties: {layerName: 'land', ...properties}
  };
}

/** Builds the vector source layer for one style layer and renders it for one tile. */
function renderStyleLayer(
  styleLayer: Record<string, unknown>,
  features: unknown[],
  zoom = 15.6,
  tileProps: Record<string, unknown> = {}
): any {
  return renderStyle(styleDefinitionFor(styleLayer), features, zoom, tileProps);
}

function styleDefinitionFor(styleLayer: Record<string, unknown>): any {
  return {
    version: 8,
    sources: SOURCES,
    layers: [{source: 'tiles', 'source-layer': 'land', ...styleLayer}]
  };
}

/** Renders the first style layer of a style definition for one tile. */
function renderStyle(
  styleDefinition: any,
  features: unknown[],
  zoom: number,
  tileProps: Record<string, unknown> = {}
): any {
  const layers = getBasemapLayers({idPrefix: 'test', mode: 'map', zoom, styleDefinition});
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  expect(vectorLayer).toBeDefined();
  const [sublayer] = vectorLayer.props.renderSubLayers({
    id: 'test-tiles-tile',
    data: features,
    tile: {index: {x: 0, y: 0, z: Math.floor(zoom)}},
    ...tileProps
  });
  return sublayer;
}

function dashExtension(sublayer: any): any {
  return (sublayer.props.extensions || []).find(
    (extension: unknown) => extension instanceof PathStyleExtension
  );
}

describe('fill-extrusion', () => {
  test('draws extruded polygons with per-feature height and color', () => {
    const features = [polygon({h: 10, c: 'a'}), polygon({h: 25, c: 'b'})];
    const sublayer = renderStyleLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {
          'fill-extrusion-color': ['match', ['get', 'c'], 'a', '#ff0000', '#0000ff'],
          'fill-extrusion-height': ['get', 'h']
        }
      },
      features
    );

    expect(sublayer.constructor.layerName).toBe('GeoJsonLayer');
    expect(sublayer.props.extruded).toBe(true);
    expect(sublayer.props.filled).toBe(true);
    expect(sublayer.props.stroked).toBe(false);
    expect(sublayer.props.getElevation(features[0])).toBe(10);
    expect(sublayer.props.getElevation(features[1])).toBe(25);
    expect(sublayer.props.getFillColor(features[0])).toEqual([255, 0, 0, 255]);
    expect(sublayer.props.getFillColor(features[1])).toEqual([0, 0, 255, 255]);
  });

  test('uses the style-spec defaults: black, height 0', () => {
    const sublayer = renderStyleLayer({id: 'building-3d', type: 'fill-extrusion'}, [polygon()]);
    expect(sublayer.props.getFillColor).toEqual([0, 0, 0, 255]);
    expect(sublayer.props.getElevation).toBe(0);
  });

  test('ignores the alpha of fill-extrusion-color and applies fill-extrusion-opacity layer-wide', () => {
    const sublayer = renderStyleLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {
          'fill-extrusion-color': 'rgba(255, 0, 0, 0.2)',
          'fill-extrusion-opacity': 0.6,
          'fill-extrusion-height': 10
        }
      },
      [polygon()],
      15.6,
      {opacity: 0.5}
    );

    expect(sublayer.props.getFillColor).toEqual([255, 0, 0, 255]);
    expect(sublayer.props.opacity).toBeCloseTo(0.3, 6);
  });

  test('evaluates a zoom-dependent fill-extrusion-opacity at the zoom step', () => {
    const sublayer = renderStyleLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1]}
      },
      [polygon()],
      15.6
    );
    // Evaluated at 15.5.
    expect(sublayer.props.opacity).toBeCloseTo(0.5, 6);
  });

  test('raises the walls from fill-extrusion-base to fill-extrusion-height', () => {
    const features = [polygon({h: 30, b: 10}), multiPolygon({h: 30, b: 5})];
    const sublayer = renderStyleLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'b']
        }
      },
      features
    );

    const [first, second] = sublayer.props.data;
    // The polygon starts at the base, and rises by the height above it.
    expect(first.geometry.coordinates[0][0]).toEqual([0, 0, 10]);
    expect(second.geometry.coordinates[1][0][2]).toEqual([1, 1, 5]);
    expect(first.properties).toBe(features[0].properties);
    expect(sublayer.props.getElevation(first)).toBe(20);
    expect(sublayer.props.getElevation(second)).toBe(25);
    // The source features are not modified.
    expect(features[0].geometry.coordinates[0][0]).toEqual([0, 0]);
  });

  test('keeps the source features when every base is 0', () => {
    const features = [polygon({h: 30})];
    const sublayer = renderStyleLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0}
      },
      features
    );
    expect(sublayer.props.data[0]).toBe(features[0]);
  });

  test('clamps the base to the height', () => {
    const features = [polygon({h: 10, b: 15})];
    const sublayer = renderStyleLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'b']
        }
      },
      features
    );
    const [raised] = sublayer.props.data;
    expect(raised.geometry.coordinates[0][0]).toEqual([0, 0, 10]);
    expect(sublayer.props.getElevation(raised)).toBe(0);
  });

  test('reuses the raised features while the base is unchanged', () => {
    const styleLayer = {
      id: 'building-3d',
      type: 'fill-extrusion',
      paint: {'fill-extrusion-height': 30, 'fill-extrusion-base': ['get', 'b']}
    };
    const features = [polygon({b: 10})];
    const styleDefinition = styleDefinitionFor(styleLayer);
    const first = renderStyle(styleDefinition, features, 15.1);
    const second = renderStyle(styleDefinition, features, 15.6);
    expect(first.props.data[0]).not.toBe(features[0]);
    expect(second.props.data).toBe(first.props.data);
  });

  test('keys updateTriggers on the zoom step only for zoom-dependent values', () => {
    const features = [polygon({h: 30})];
    const sublayer = renderStyleLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {
          'fill-extrusion-color': ['match', ['get', 'h'], 30, '#ff0000', '#00ff00'],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, ['get', 'h']]
        }
      },
      features,
      15.6
    );

    expect(sublayer.props.updateTriggers.getElevation).toBe(15.5);
    expect(sublayer.props.updateTriggers.getFillColor).toBeUndefined();
    expect(sublayer.props.getElevation(features[0])).toBeCloseTo(15, 6);
  });

  test('recomputes the raised features when a zoom-dependent base changes step', () => {
    const styleLayer = {
      id: 'building-3d',
      type: 'fill-extrusion',
      paint: {
        'fill-extrusion-height': 40,
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, ['get', 'b']]
      }
    };
    const features = [polygon({b: 20})];
    // One style definition, so the raised features would be reused if the step were ignored.
    const styleDefinition = styleDefinitionFor(styleLayer);
    const early = renderStyle(styleDefinition, features, 15.5);
    const late = renderStyle(styleDefinition, features, 15.75);
    expect(early.props.data[0].geometry.coordinates[0][0]).toEqual([0, 0, 10]);
    expect(late.props.data[0].geometry.coordinates[0][0]).toEqual([0, 0, 15]);
  });

  test('depth-tests extrusions against each other', () => {
    const sublayer = renderStyleLayer({id: 'building-3d', type: 'fill-extrusion'}, [polygon()]);
    expect(sublayer.props.parameters).toMatchObject({depthTest: true, depthWriteEnabled: true});
  });
});

describe('line-dasharray', () => {
  test('dashes lines with PathStyleExtension, in line widths', () => {
    const sublayer = renderStyleLayer(
      {id: 'path', type: 'line', paint: {'line-width': 3, 'line-dasharray': [2, 1]}},
      [line()]
    );

    const extension = dashExtension(sublayer);
    expect(extension).toBeDefined();
    expect(extension.opts.dash).toBe(true);
    // Dashes run continuously along the line, as in MapLibre, rather than restarting per segment.
    expect(extension.opts.dashMode).toBe('path');
    // deck.gl's `widths` unit is half the line width; MapLibre's is the full width.
    expect(sublayer.props.getDashArray).toEqual([4, 2]);
    expect(sublayer.props.dashJustified).toBe(false);
  });

  test('leaves undashed lines without the extension', () => {
    const sublayer = renderStyleLayer({id: 'path', type: 'line'}, [line()]);
    expect(dashExtension(sublayer)).toBeUndefined();
    expect(sublayer.props.getDashArray).toBeUndefined();
  });

  test('keeps the tile layer extensions', () => {
    const clip = {id: 'clip'};
    const sublayer = renderStyleLayer(
      {id: 'path', type: 'line', paint: {'line-dasharray': [2, 1]}},
      [line()],
      15.6,
      {extensions: [clip]}
    );
    expect(sublayer.props.extensions[0]).toBe(clip);
    expect(dashExtension(sublayer)).toBeDefined();
  });

  test('shares one extension instance across sublayers', () => {
    const styleLayer = {id: 'path', type: 'line', paint: {'line-dasharray': [2, 1]}};
    const first = renderStyleLayer(styleLayer, [line()]);
    const second = renderStyleLayer(styleLayer, [line()], 16.2);
    expect(dashExtension(first)).toBeDefined();
    expect(dashExtension(first)).toBe(dashExtension(second));
  });

  test('joins the first and last dash of an odd-length pattern, as MapLibre does', () => {
    const sublayer = renderStyleLayer(
      {id: 'path', type: 'line', paint: {'line-dasharray': [2, 1, 1]}},
      [line()]
    );
    // Dash 2, gap 1, then a dash of 1 that runs into the next period's first dash.
    expect(sublayer.props.getDashArray).toEqual([6, 2]);
    // A single length is all dash: a solid line.
    const single = renderStyleLayer({id: 'path', type: 'line', paint: {'line-dasharray': [3]}}, [
      line()
    ]);
    expect(single.props.getDashArray).toEqual([6, 0]);
  });

  test('approximates a longer pattern by its total dash and gap lengths', () => {
    const sublayer = renderStyleLayer(
      {id: 'path', type: 'line', paint: {'line-dasharray': [2, 1, 1, 1]}},
      [line()]
    );
    expect(sublayer.props.getDashArray).toEqual([6, 4]);
  });

  test('evaluates per feature', () => {
    const features = [line({c: 'a'}), line({c: 'b'})];
    const sublayer = renderStyleLayer(
      {
        id: 'path',
        type: 'line',
        paint: {
          'line-dasharray': ['match', ['get', 'c'], 'a', ['literal', [2, 1]], ['literal', [1, 1]]]
        }
      },
      features
    );
    expect(sublayer.props.getDashArray(features[0])).toEqual([4, 2]);
    expect(sublayer.props.getDashArray(features[1])).toEqual([2, 2]);
    expect(sublayer.props.updateTriggers.getDashArray).toBeUndefined();
  });

  test('evaluates zoom-dependent patterns at integer zooms, as the style spec specifies', () => {
    const features = [line({c: 'a'})];
    const styleLayer = {
      id: 'path',
      type: 'line',
      paint: {
        'line-dasharray': [
          'step',
          ['zoom'],
          ['literal', [1, 1]],
          15.5,
          ['match', ['get', 'c'], 'a', ['literal', [3, 3]], ['literal', [4, 4]]]
        ]
      }
    };
    const at156 = renderStyleLayer(styleLayer, features, 15.6);
    const at162 = renderStyleLayer(styleLayer, features, 16.2);
    // z15.6 evaluates at z15, below the step.
    expect(at156.props.getDashArray(features[0])).toEqual([2, 2]);
    expect(at156.props.updateTriggers.getDashArray).toBe(15);
    expect(at162.props.getDashArray(features[0])).toEqual([6, 6]);
    expect(at162.props.updateTriggers.getDashArray).toBe(16);
  });

  test('draws a solid line for an empty or zero-length pattern', () => {
    const empty = renderStyleLayer(
      {id: 'path', type: 'line', paint: {'line-dasharray': ['literal', []]}},
      [line()]
    );
    expect(empty.props.getDashArray).toEqual([0, 0]);
    const zeroGaps = renderStyleLayer(
      {id: 'path', type: 'line', paint: {'line-dasharray': [2, 0]}},
      [line()]
    );
    expect(zeroGaps.props.getDashArray).toEqual([4, 0]);
  });
});

describe('fill-outline-color', () => {
  test('draws a 1 pixel outline in fill-outline-color', () => {
    const sublayer = renderStyleLayer(
      {
        id: 'land',
        type: 'fill',
        paint: {'fill-color': '#ff0000', 'fill-outline-color': '#0000ff', 'fill-opacity': 0.5}
      },
      [polygon()]
    );

    expect(sublayer.props.filled).toBe(true);
    expect(sublayer.props.stroked).toBe(true);
    expect(sublayer.props.getFillColor).toEqual([255, 0, 0, 128]);
    // MapLibre multiplies the outline color by fill-opacity.
    expect(sublayer.props.getLineColor).toEqual([0, 0, 255, 128]);
    expect(sublayer.props.getLineWidth).toBe(1);
    expect(sublayer.props.lineWidthUnits).toBe('pixels');
  });

  test('evaluates fill-outline-color per feature', () => {
    const features = [polygon({c: 'a'}), polygon({c: 'b'})];
    const sublayer = renderStyleLayer(
      {
        id: 'land',
        type: 'fill',
        paint: {
          'fill-color': '#ff0000',
          'fill-outline-color': ['match', ['get', 'c'], 'a', '#00ff00', '#0000ff']
        }
      },
      features
    );
    expect(sublayer.props.getLineColor(features[0])).toEqual([0, 255, 0, 255]);
    expect(sublayer.props.getLineColor(features[1])).toEqual([0, 0, 255, 255]);
  });

  test('draws no outline when fill-outline-color is unset', () => {
    const sublayer = renderStyleLayer(
      {id: 'land', type: 'fill', paint: {'fill-color': '#ff0000'}},
      [polygon()]
    );
    expect(sublayer.props.stroked).toBe(false);
  });

  test('draws no outline when fill-antialias is false', () => {
    const sublayer = renderStyleLayer(
      {
        id: 'land',
        type: 'fill',
        paint: {'fill-color': '#ff0000', 'fill-outline-color': '#0000ff', 'fill-antialias': false}
      },
      [polygon()]
    );
    expect(sublayer.props.stroked).toBe(false);
  });

  test('does not color lines with fill-outline-color', () => {
    const sublayer = renderStyleLayer(
      {
        id: 'path',
        type: 'line',
        paint: {'fill-outline-color': '#0000ff'}
      },
      [line()]
    );
    // The style-spec default line-color is black.
    expect(sublayer.props.getLineColor).toEqual([0, 0, 0, 255]);
  });
});
