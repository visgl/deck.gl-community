// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getFillPatternGroups} from '../src/fill-pattern';
import {
  FillPatternExtension,
  FillTranslateExtension,
  getFillTranslateOffset
} from '../src/fill-style-extensions';
import {getBasemapLayers} from '../src/globe-layers';
import type {SpriteAtlas, SpriteIconMappingEntry} from '../src/sprite';

function entry(pixelRatio = 1): SpriteIconMappingEntry {
  return {x: 0, y: 0, width: 16, height: 16, mask: false, pixelRatio};
}

const DEFAULT_SPRITE: SpriteAtlas = {
  id: 'default',
  // An image object, not a URL: deck.gl resolves a URL prop only once the layer loads it.
  image: {name: 'default image'} as any,
  mapping: {wetland: entry(2), sand: entry(2)}
};
const BASE_SPRITE: SpriteAtlas = {
  id: 'base',
  image: {name: 'base image'} as any,
  mapping: {hatched: entry(1), striped: entry(2)}
};
const SPRITES = [DEFAULT_SPRITE, BASE_SPRITE];

function polygon(properties: Record<string, unknown> = {}) {
  return {
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
    properties
  };
}

/** Renders one fill style layer for one tile and returns all its sublayers. */
function renderFills(
  paint: Record<string, unknown>,
  features: unknown[] = [polygon()],
  {zoom = 12, spriteAtlases = SPRITES}: {zoom?: number; spriteAtlases?: SpriteAtlas[] | null} = {}
): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    spriteAtlases,
    styleDefinition: {
      version: 8,
      sources: {
        tiles: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
        }
      },
      layers: [{id: 'fill', type: 'fill', source: 'tiles', paint}]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  return [
    vectorLayer.props.renderSubLayers({
      id: 'test-tile',
      data: features,
      tile: {index: {x: 0, y: 0, z: Math.floor(zoom)}}
    })
  ].flat(2);
}

function evaluate(accessor: unknown, feature: unknown) {
  return typeof accessor === 'function' ? accessor(feature, {index: 0}) : accessor;
}

describe('fill-pattern', () => {
  test('a pattern draws its image from the sprite, with fill-opacity as the alpha', () => {
    const [layer] = renderFills({
      'fill-pattern': 'wetland',
      'fill-opacity': 0.5
    });
    expect(layer.props.extensions.some(ext => ext instanceof FillPatternExtension)).toBe(true);
    expect(layer.props.fillPatternAtlas).toBe(DEFAULT_SPRITE.image);
    expect(layer.props.fillPatternMapping).toBe(DEFAULT_SPRITE.mapping);
    expect(layer.props.fillPatternMask).toBe(false);
    expect(layer.props.fillPatternSizeUnits).toBe('common');
    expect(layer.props.getFillPattern).toBe('wetland');
    expect(layer.props.getFillColor).toEqual([255, 255, 255, 128]);
  });

  test('the pattern is one CSS pixel per image pixel at the integer zoom', () => {
    // A 2x image at zoom 12.75: 2 ** -12 common units per CSS pixel, halved.
    const [layer] = renderFills({'fill-pattern': 'wetland'}, [polygon()], {
      zoom: 12.75
    });
    expect(layer.props.getFillPatternScale).toBe(2 ** -12 / 2);
    const [base] = renderFills({'fill-pattern': 'base:hatched'}, [polygon()], {zoom: 13});
    expect(base.props.getFillPatternScale).toBe(2 ** -13);
  });

  test('a data-driven fill-opacity is evaluated per feature', () => {
    const features = [polygon({opacity: 0.25}), polygon({opacity: 1})];
    const [layer] = renderFills(
      {'fill-pattern': 'wetland', 'fill-opacity': ['get', 'opacity']},
      features
    );
    expect(evaluate(layer.props.getFillColor, features[0])).toEqual([255, 255, 255, 64]);
    expect(evaluate(layer.props.getFillColor, features[1])).toEqual([255, 255, 255, 255]);
  });

  test('a missing image, or sprites still loading, draw no fill', () => {
    for (const layer of [
      ...renderFills({'fill-pattern': 'missing', 'fill-color': '#ff0000'}),
      ...renderFills({'fill-pattern': 'wetland'}, [polygon()], {
        spriteAtlases: null
      }),
      ...renderFills({'fill-pattern': 'wetland'}, [polygon()], {
        spriteAtlases: []
      })
    ]) {
      expect(layer.props.getFillColor).toEqual([0, 0, 0, 0]);
      expect(layer.props.extensions || []).toEqual([]);
    }
  });

  test('a data-driven pattern splits the features by sprite and drops missing images', () => {
    const features = [
      polygon({pattern: 'wetland'}),
      polygon({pattern: 'base:hatched'}),
      polygon({pattern: 'missing'}),
      polygon({pattern: 'sand'}),
      polygon({pattern: 'base:striped'})
    ];
    const layers = renderFills({'fill-pattern': ['get', 'pattern']}, features);
    expect(layers.map(layer => layer.id)).toEqual([
      'test-tile-"fill"-pattern-0',
      'test-tile-"fill"-pattern-1'
    ]);
    const [defaultLayer, baseLayer] = layers;
    expect(defaultLayer.props.data).toEqual([features[0], features[3]]);
    expect(defaultLayer.props.fillPatternMapping).toBe(DEFAULT_SPRITE.mapping);
    expect(
      defaultLayer.props.data.map(f => evaluate(defaultLayer.props.getFillPattern, f))
    ).toEqual(['wetland', 'sand']);
    // The default sprite's images share a pixel ratio, so the scale is a constant.
    expect(defaultLayer.props.getFillPatternScale).toBe(2 ** -12 / 2);
    expect(baseLayer.props.data).toEqual([features[1], features[4]]);
    expect(baseLayer.props.fillPatternAtlas).toBe(BASE_SPRITE.image);
    expect(baseLayer.props.data.map(f => evaluate(baseLayer.props.getFillPattern, f))).toEqual([
      'hatched',
      'striped'
    ]);
    // The base sprite's images do not.
    expect(baseLayer.props.data.map(f => evaluate(baseLayer.props.getFillPatternScale, f))).toEqual(
      [2 ** -12, 2 ** -12 / 2]
    );
  });

  test('one sprite keeps the sublayer id and the tile features', () => {
    const features = [polygon({pattern: 'wetland'}), polygon({pattern: 'sand'})];
    const [layer] = renderFills({'fill-pattern': ['get', 'pattern']}, features);
    expect(layer.id).toBe('test-tile-"fill"');
    expect(layer.props.data).toEqual(features);
    const [constant] = renderFills({'fill-pattern': 'wetland'}, features);
    expect(constant.props.data).toBe(features);
  });

  test('fill-pattern is evaluated at the integer zoom', () => {
    const paint = {'fill-pattern': ['step', ['zoom'], 'wetland', 13, 'sand']};
    expect(renderFills(paint, [polygon()], {zoom: 12.9})[0].props.getFillPattern).toBe('wetland');
    expect(renderFills(paint, [polygon()], {zoom: 13})[0].props.getFillPattern).toBe('sand');
    const dataPaint = {
      'fill-pattern': ['step', ['zoom'], ['get', 'low'], 13, ['get', 'high']]
    };
    const feature = polygon({low: 'wetland', high: 'sand'});
    const [low] = renderFills(dataPaint, [feature], {zoom: 12.9});
    expect(evaluate(low.props.getFillPattern, feature)).toBe('wetland');
    const [high] = renderFills(dataPaint, [feature], {zoom: 13.25});
    expect(evaluate(high.props.getFillPattern, feature)).toBe('sand');
  });

  test('the image expression sees the loaded sprite images', () => {
    const feature = polygon();
    const [layer] = renderFills(
      {'fill-pattern': ['coalesce', ['image', 'missing'], ['image', 'sand']]},
      [feature]
    );
    expect(evaluate(layer.props.getFillPattern, feature)).toBe('sand');
  });

  test('per-feature groups are reused while their inputs are unchanged', () => {
    const styleLayer = {paint: {'fill-pattern': ['get', 'pattern']}};
    const features = [polygon({pattern: 'wetland'}), polygon({pattern: 'base:hatched'})];
    const groups = getFillPatternGroups(features, styleLayer, 12, SPRITES);
    expect(getFillPatternGroups(features, styleLayer, 12.75, SPRITES)).toBe(groups);
    // The image depends on the sprites, so new sprites regroup the features.
    expect(getFillPatternGroups(features, styleLayer, 12, [...SPRITES])).not.toBe(groups);
    // A zoom-dependent pattern regroups at a new integer zoom only.
    const zoomLayer = {
      paint: {
        'fill-pattern': ['step', ['zoom'], ['get', 'pattern'], 13, 'sand']
      }
    };
    const zoomGroups = getFillPatternGroups(features, zoomLayer, 12, SPRITES);
    expect(getFillPatternGroups(features, zoomLayer, 12.5, SPRITES)).toBe(zoomGroups);
    expect(getFillPatternGroups(features, zoomLayer, 13, SPRITES)).not.toBe(zoomGroups);
  });

  test('a pattern keeps the outline in fill-outline-color', () => {
    const [layer] = renderFills({
      'fill-pattern': 'wetland',
      'fill-outline-color': '#ff0000'
    });
    expect(layer.props.stroked).toBe(true);
    expect(layer.props.getLineColor).toEqual([255, 0, 0, 255]);
  });
});

describe('fill-translate', () => {
  test('passes the offset and its anchor to the fill', () => {
    const [layer] = renderFills({
      'fill-color': '#000000',
      'fill-translate': [-2, 3]
    });
    expect(layer.props.extensions.some(ext => ext instanceof FillTranslateExtension)).toBe(true);
    expect(layer.props.fillTranslate).toEqual([-2, 3]);
    expect(layer.props.fillTranslateAnchor).toBe('map');
    const [viewport] = renderFills({
      'fill-translate': [1, 1],
      'fill-translate-anchor': 'viewport'
    });
    expect(viewport.props.fillTranslateAnchor).toBe('viewport');
  });

  test('is evaluated at the zoom', () => {
    const paint = {
      'fill-translate': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        ['literal', [0, 0]],
        16,
        ['literal', [-2, -2]]
      ]
    };
    const [layer] = renderFills(paint, [polygon()], {zoom: 15});
    expect(layer.props.fillTranslate).toEqual([-1, -1]);
  });

  test('a fill without fill-translate has no extension', () => {
    const [layer] = renderFills({'fill-color': '#000000'});
    expect(layer.props.extensions || []).toEqual([]);
    expect(layer.props.fillTranslate).toBeUndefined();
  });

  test('combines with a pattern', () => {
    const [layer] = renderFills({
      'fill-pattern': 'wetland',
      'fill-translate': [1, 0]
    });
    expect(layer.props.extensions.map(ext => ext.constructor)).toEqual([
      FillPatternExtension,
      FillTranslateExtension
    ]);
  });

  test('a viewport anchor turns the offset by the bearing, a map anchor does not', () => {
    expect(getFillTranslateOffset([10, 0], 'map', 90)).toEqual([10, 0]);
    // With east up on screen, screen right is south and screen down is west.
    const [x, y] = getFillTranslateOffset([10, 0], 'viewport', 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(10);
    const [downX, downY] = getFillTranslateOffset([0, 10], 'viewport', 90);
    expect(downX).toBeCloseTo(-10);
    expect(downY).toBeCloseTo(0);
  });
});

describe('fill extensions on WebGPU', () => {
  const layer = (type: string) => ({context: {device: {type}}, props: {}}) as any;

  test('a patterned fill draws nothing, and nothing is translated', () => {
    const pattern = new FillPatternExtension();
    expect(pattern.getSubLayerProps.call(layer('webgpu'), pattern).getFillColor).toEqual([
      0, 0, 0, 0
    ]);
    expect(pattern.getSubLayerProps.call(layer('webgl'), pattern).getFillColor).toBeUndefined();
    const translate = new FillTranslateExtension();
    expect(translate.getShaders.call(layer('webgpu'), translate)).toEqual({});
    expect(translate.getShaders.call(layer('webgl'), translate).modules).toHaveLength(1);
  });
});

describe('fill-pattern in the style draw order', () => {
  const square = [
    [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0]
    ]
  ];
  const feature = (layerName: string, type: string, coordinates: unknown, properties = {}) => ({
    type: 'Feature',
    geometry: {type, coordinates},
    properties: {layerName, ...properties}
  });
  // Each tile has a landuse polygon with an image from each sprite.
  const content = [
    feature('water', 'Polygon', square),
    feature('building', 'Polygon', square),
    feature('landuse', 'Polygon', square, {pattern: 'wetland'}),
    feature('landuse', 'Polygon', square, {pattern: 'base:hatched'}),
    feature('road', 'LineString', square[0])
  ];
  const WATER = {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'};
  const BUILDINGS = {
    id: 'building-3d',
    type: 'fill-extrusion',
    source: 'tiles',
    'source-layer': 'building',
    minzoom: 14
  };
  const LANDUSE = {
    id: 'landuse',
    type: 'fill',
    source: 'tiles',
    'source-layer': 'landuse',
    paint: {'fill-pattern': ['get', 'pattern']}
  };
  const ROADS = {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'};

  /** The sublayers that the tile layer draws for two loaded tiles, in draw order. */
  function renderTwoTiles(mode: 'map' | 'globe', layers: unknown[]): any[] {
    const tileLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode,
      zoom: 15,
      spriteAtlases: SPRITES,
      styleDefinition: {
        version: 8,
        sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
        layers
      } as any
    }).find((layer: any) => layer.id === 'test-tiles');
    const tile = (id: string, x: number) => ({
      id,
      index: {x, y: 0, z: 15},
      bbox: {west: 0, south: 0, east: 1, north: 1},
      isLoaded: true,
      content,
      layers: null
    });
    // Just enough layer state for `TileLayer.renderLayers` to render two loaded tiles.
    tileLayer.context = {viewport: {zoom: 15, resolution: 0}};
    tileLayer.internalState = {};
    tileLayer.state = {
      tileLayers: new Map(),
      tileset: {tiles: [tile('a', 0), tile('b', 1)]}
    };
    return tileLayer.renderLayers();
  }

  test('the per-sprite sublayers of each tile draw in style order, after the extrusion', () => {
    const layers = renderTwoTiles('globe', [WATER, BUILDINGS, LANDUSE, ROADS]);
    expect(layers.map(layer => [layer.id, layer.props.styleLayerIndex])).toEqual([
      ['test-tiles-a-"water"', 0],
      ['test-tiles-b-"water"', 0],
      ['test-tiles-a-"building-3d"', 1],
      ['test-tiles-b-"building-3d"', 1],
      ['test-tiles-a-"landuse"-pattern-0', 2],
      ['test-tiles-a-"landuse"-pattern-1', 2],
      ['test-tiles-b-"landuse"-pattern-0', 2],
      ['test-tiles-b-"landuse"-pattern-1', 2],
      ['test-tiles-a-"roads"', 3],
      ['test-tiles-b-"roads"', 3]
    ]);
    // After the extrusion, each sprite's sublayer is depth-tested against the buildings, without
    // writing depth, as the other flat layers are.
    const patterned = layers.filter(layer => layer.id.includes('"landuse"'));
    for (const layer of patterned) {
      expect(layer.props.parameters).toMatchObject({
        depthTest: true,
        depthCompare: 'less-equal',
        depthWriteEnabled: false,
        cullMode: 'back'
      });
    }
    // Each sprite's sublayer draws only its own images, from the tile's shared features.
    expect(patterned.map(layer => layer.props.data)).toEqual([
      [content[2]],
      [content[3]],
      [content[2]],
      [content[3]]
    ]);
  });

  test('before the extrusion, the per-sprite sublayers draw without depth on a globe', () => {
    const layers = renderTwoTiles('globe', [WATER, LANDUSE, BUILDINGS, ROADS]);
    const patterned = layers.filter(layer => layer.id.includes('"landuse"'));
    expect(patterned.map(layer => layer.props.styleLayerIndex)).toEqual([1, 1, 1, 1]);
    for (const layer of patterned) {
      expect(layer.props.parameters).toMatchObject({depthTest: false, depthWriteEnabled: false});
    }
  });

  test('on a map, the per-sprite sublayers are depth-tested', () => {
    const layers = renderTwoTiles('map', [WATER, BUILDINGS, LANDUSE, ROADS]);
    const patterned = layers.filter(layer => layer.id.includes('"landuse"'));
    expect(patterned).toHaveLength(4);
    for (const layer of patterned) {
      expect(layer.props.parameters).toMatchObject({depthTest: true, depthWriteEnabled: false});
    }
  });
});
