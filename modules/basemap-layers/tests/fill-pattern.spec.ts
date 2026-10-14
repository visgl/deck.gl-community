// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {
  MAX_PATTERN_ATLAS_SIZE,
  bleedIntoTransparentPixels,
  getFeaturesWithoutPattern,
  getFillPatternGroups,
  getFillPatternProps,
  getPatternAtlas,
  packPatternImages
} from '../src/fill-pattern';
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
  const missing = feature('landuse', 'Polygon', square, {pattern: 'missing'});
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

  test('a missing image keeps its outline, in style order and depth-tested', () => {
    content.splice(4, 0, missing);
    let layers: any[];
    try {
      layers = renderTwoTiles('globe', [
        WATER,
        BUILDINGS,
        {...LANDUSE, paint: {...LANDUSE.paint, 'fill-outline-color': '#ff0000'}},
        ROADS
      ]);
    } finally {
      content.splice(4, 1);
    }
    const landuse = layers.filter(layer => layer.id.includes('"landuse"'));
    expect(landuse.map(layer => layer.id)).toEqual([
      'test-tiles-a-"landuse"-pattern-0',
      'test-tiles-a-"landuse"-pattern-1',
      'test-tiles-a-"landuse"-missing-pattern',
      'test-tiles-b-"landuse"-pattern-0',
      'test-tiles-b-"landuse"-pattern-1',
      'test-tiles-b-"landuse"-missing-pattern'
    ]);
    const outlines = landuse.filter(layer => layer.id.endsWith('-missing-pattern'));
    for (const layer of outlines) {
      expect(layer.props.data).toEqual([missing]);
      expect(layer.props.styleLayerIndex).toBe(2);
      expect(layer.props.parameters).toMatchObject({depthTest: true, depthWriteEnabled: false});
      // No fill, only the outline.
      expect(layer.props.getFillColor).toEqual([0, 0, 0, 0]);
      expect(layer.props.stroked).toBe(true);
      expect(layer.props.getLineColor).toEqual([255, 0, 0, 255]);
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

describe('missing pattern images', () => {
  test('draw their outline but no fill when other features have an image', () => {
    const features = [polygon({pattern: 'wetland'}), polygon({pattern: 'missing'})];
    const paint = {'fill-pattern': ['get', 'pattern'], 'fill-outline-color': '#ff0000'};
    const [patterned, outline] = renderFills(paint, features);
    expect(patterned.props.data).toEqual([features[0]]);
    expect(outline.id).toBe('test-tile-"fill"-missing-pattern');
    expect(outline.props.data).toEqual([features[1]]);
    expect(outline.props.getFillColor).toEqual([0, 0, 0, 0]);
    expect(outline.props.getLineColor).toEqual([255, 0, 0, 255]);
    // The features without an image are reused while the groups are.
    const styleLayer = {paint};
    const groups = getFillPatternGroups(features, styleLayer, 12, SPRITES);
    expect(getFeaturesWithoutPattern(features, groups)).toEqual([features[1]]);
    expect(getFeaturesWithoutPattern(features, groups)).toBe(
      getFeaturesWithoutPattern(features, getFillPatternGroups(features, styleLayer, 12.5, SPRITES))
    );
  });

  test('add no layer without fill-outline-color', () => {
    const features = [polygon({pattern: 'wetland'}), polygon({pattern: 'missing'})];
    const layers = renderFills({'fill-pattern': ['get', 'pattern']}, features);
    expect(layers.map(layer => layer.id)).toEqual(['test-tile-"fill"']);
  });
});

describe('pattern atlases', () => {
  test('a single image is cached per sprite; several images are kept by their group', () => {
    expect(getPatternAtlas(DEFAULT_SPRITE, ['wetland'])).toBe(
      getPatternAtlas(DEFAULT_SPRITE, ['wetland'])
    );
    // Sets of images vary from tile to tile, so they are not cached beyond their group.
    expect(getPatternAtlas(DEFAULT_SPRITE, ['sand', 'wetland'])).not.toBe(
      getPatternAtlas(DEFAULT_SPRITE, ['sand', 'wetland'])
    );
    const group = getFillPatternGroups(
      [polygon({pattern: 'wetland'}), polygon({pattern: 'sand'})],
      {paint: {'fill-pattern': ['get', 'pattern']}},
      12,
      SPRITES
    )[0];
    getFillPatternProps(group, 12);
    const atlas = group.patternAtlas;
    expect(atlas).toBeDefined();
    // A new zoom step regenerates the tile's layers from the same group and atlas.
    getFillPatternProps(group, 13);
    expect(group.patternAtlas).toBe(atlas);
  });

  test('packs images into rows within the texture size limit', () => {
    const sizes = Array.from({length: 128}, () => ({width: 128, height: 128}));
    const packing = packPatternImages(sizes)!;
    expect(packing.width).toBeLessThanOrEqual(MAX_PATTERN_ATLAS_SIZE);
    expect(packing.height).toBeLessThanOrEqual(MAX_PATTERN_ATLAS_SIZE);
    // Each image and its 1 pixel border lie inside the atlas and overlap no other.
    const boxes = packing.positions.map(([x, y], index) => [
      x - 1,
      y - 1,
      x + sizes[index].width + 1,
      y + sizes[index].height + 1
    ]);
    for (const [index, [left, top, right, bottom]] of boxes.entries()) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(packing.width);
      expect(bottom).toBeLessThanOrEqual(packing.height);
      for (const [l, t, r, b] of boxes.slice(index + 1)) {
        expect(left >= r || right <= l || top >= b || bottom <= t).toBe(true);
      }
    }
  });

  test('packs images of mixed sizes, and gives up beyond the limit', () => {
    const sizes = [
      {width: 15, height: 15},
      {width: 64, height: 32},
      {width: 7, height: 40},
      {width: 30, height: 30}
    ];
    const packing = packPatternImages(sizes, 80)!;
    expect(packing.width).toBeLessThanOrEqual(80);
    expect(packing.positions).toHaveLength(4);
    expect(packPatternImages([{width: 100, height: 10}], 80)).toBeNull();
    expect(
      packPatternImages(
        Array.from({length: 10}, () => ({width: 38, height: 38})),
        80
      )
    ).toBeNull();
  });
});

describe('bleedIntoTransparentPixels', () => {
  test('gives transparent pixels next to visible ones their alpha-weighted color, and no alpha', () => {
    // A row of 4 pixels: opaque red, half-transparent blue, transparent, transparent.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 85, 0, 0, 0, 0, 0, 0, 0, 0]);
    bleedIntoTransparentPixels({data, width: 4, height: 1} as ImageData);
    expect(Array.from(data.slice(0, 8))).toEqual([255, 0, 0, 255, 0, 0, 255, 85]);
    // Next to the blue pixel only.
    expect(Array.from(data.slice(8, 12))).toEqual([0, 0, 255, 0]);
    // Next to transparent pixels only: unchanged.
    expect(Array.from(data.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  test('takes no color from outside its rectangle', () => {
    // Opaque red at x = 0, then a rectangle from x = 1: transparent, opaque white.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
    bleedIntoTransparentPixels({data, width: 3, height: 1} as ImageData, [1, 0, 3, 1]);
    expect(Array.from(data.slice(4, 8))).toEqual([255, 255, 255, 0]);
  });

  test('weighs neighbors by their alpha', () => {
    // Opaque red, transparent, blue at a third of the alpha.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 85]);
    bleedIntoTransparentPixels({data, width: 3, height: 1} as ImageData);
    expect(Array.from(data.slice(4, 8))).toEqual([191, 0, 64, 0]);
  });

  test('bleeds in place, copying nothing of the image', () => {
    // An atlas makes one call per packed image: a copy of the whole atlas in each call would
    // copy 128 times 4030 x 650 pixels, 1.25 GiB, for 128 images.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
    data.slice = () => {
      throw new Error('copied the image');
    };
    bleedIntoTransparentPixels({data, width: 2, height: 1} as ImageData);
    expect(Array.from(data.subarray(4, 8))).toEqual([255, 0, 0, 0]);
  });

  test('draws as a bleed from a copy of the image taken before each rectangle', () => {
    // Bleeding writes only to transparent pixels, which weigh nothing, so no copy is needed.
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const [width, height] = [23, 17];
    const data = new Uint8ClampedArray(width * height * 4).map((_, i) =>
      i % 4 === 3 && random() < 0.6 ? 0 : Math.floor(random() * 256)
    );
    const expected = data.slice();
    const rectangles = Array.from({length: 12}, () => {
      const [left, top] = [Math.floor(random() * width), Math.floor(random() * height)];
      const right = left + 1 + Math.floor(random() * (width - left));
      return [left, top, right, top + 1 + Math.floor(random() * (height - top))];
    });
    rectangles.push([0, 0, width, height]);
    for (const [left, top, right, bottom] of rectangles) {
      bleedIntoTransparentPixels({data, width, height} as ImageData, [left, top, right, bottom]);
      const source = expected.slice();
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const i = (y * width + x) * 4;
          if (source[i + 3] !== 0) {
            continue;
          }
          const sum = [0, 0, 0, 0];
          for (let ny = Math.max(top, y - 1); ny <= Math.min(bottom - 1, y + 1); ny++) {
            for (let nx = Math.max(left, x - 1); nx <= Math.min(right - 1, x + 1); nx++) {
              const j = (ny * width + nx) * 4;
              for (let c = 0; c < 3; c++) {
                sum[c] += source[j + c] * source[j + 3];
              }
              sum[3] += source[j + 3];
            }
          }
          if (sum[3]) {
            for (let c = 0; c < 3; c++) {
              expected[i + c] = sum[c] / sum[3];
            }
          }
        }
      }
      expect(Array.from(data), `[${left}, ${top}, ${right}, ${bottom}]`).toEqual(
        Array.from(expected)
      );
    }
  });
});
