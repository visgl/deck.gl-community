/* eslint-disable import/no-extraneous-dependencies */
import {afterEach, describe, expect, test, vi} from 'vitest';
import {log} from '@deck.gl/core';
import {getBasemapLayers, getGlobeBaseLayers} from '../src/index.ts';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';
import {
  getSpriteIconMapping,
  getSpriteSources,
  loadSpriteAtlases,
  resolveSpriteIcon
} from '../src/sprite.ts';
import type {SpriteAtlas} from '../src/sprite.ts';

const SPRITE_INDEX = {
  'circle-11': {x: 0, y: 0, width: 34, height: 34, pixelRatio: 2},
  'star-15': {x: 34, y: 0, width: 30, height: 30, sdf: true}
};

/** A fetch stub that answers sprite JSON for the URLs in `available` and 404 otherwise. */
function spriteFetch(available: string[]) {
  const requested: string[] = [];
  const fetchFn = (async (url: string) => {
    requested.push(url);
    return available.includes(url)
      ? {ok: true, status: 200, json: async () => SPRITE_INDEX}
      : {ok: false, status: 404, json: async () => ({})};
  }) as unknown as typeof fetch;
  return {fetchFn, requested};
}

const DEFAULT_ATLAS: SpriteAtlas = {
  id: 'default',
  image: 'https://example.com/sprite.png',
  mapping: getSpriteIconMapping(SPRITE_INDEX)
};
const POI_ATLAS: SpriteAtlas = {
  id: 'poi',
  image: 'https://example.com/poi.png',
  mapping: getSpriteIconMapping({museum: {x: 0, y: 0, width: 20, height: 20}})
};

function feature(properties: Record<string, unknown>) {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [0, 0]},
    properties: {layerName: 'place', ...properties}
  };
}

function iconLayer(
  layout: Record<string, unknown>,
  paint: Record<string, unknown> = {},
  spriteAtlases: SpriteAtlas[] = [DEFAULT_ATLAS, POI_ATLAS]
): any {
  return new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout, paint},
    zoom: 7.6,
    spriteAtlases
  } as any);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sprite URLs', () => {
  test('resolves a single sprite URL, absolute or relative to the style', () => {
    expect(getSpriteSources('https://cdn.example.com/sprite')).toEqual([
      {id: 'default', url: 'https://cdn.example.com/sprite'}
    ]);
    expect(getSpriteSources('../sprites/basic', 'https://example.com/styles/basic.json')).toEqual([
      {id: 'default', url: 'https://example.com/sprites/basic'}
    ]);
  });

  test('resolves the array form with one id per sprite', () => {
    expect(
      getSpriteSources(
        [
          {id: 'default', url: 'sprite'},
          {id: 'poi', url: 'https://cdn.example.com/poi'}
        ],
        'https://example.com/style.json'
      )
    ).toEqual([
      {id: 'default', url: 'https://example.com/sprite'},
      {id: 'poi', url: 'https://cdn.example.com/poi'}
    ]);
  });

  test('a style without a sprite has no sprite sources', () => {
    expect(getSpriteSources(undefined)).toEqual([]);
    expect(getSpriteSources('')).toEqual([]);
  });
});

describe('sprite loading', () => {
  test('requests the @2x sprite at high pixel ratios', async () => {
    const {fetchFn, requested} = spriteFetch(['https://example.com/sprite@2x.json']);
    const [atlas] = await loadSpriteAtlases('https://example.com/sprite', {
      fetch: fetchFn,
      pixelRatio: 2
    });
    expect(requested).toEqual(['https://example.com/sprite@2x.json']);
    expect(atlas.image).toBe('https://example.com/sprite@2x.png');
  });

  test('falls back to the @1x sprite when there is no @2x', async () => {
    const {fetchFn, requested} = spriteFetch(['https://example.com/sprite.json']);
    const [atlas] = await loadSpriteAtlases('https://example.com/sprite', {
      fetch: fetchFn,
      pixelRatio: 2
    });
    expect(requested).toEqual([
      'https://example.com/sprite@2x.json',
      'https://example.com/sprite.json'
    ]);
    expect(atlas.image).toBe('https://example.com/sprite.png');
  });

  test.each([
    1.25, 1.5, 1.75
  ])('requests the @2x sprite at a fractional pixel ratio of %s, as MapLibre does', async pixelRatio => {
    const {fetchFn, requested} = spriteFetch(['https://example.com/sprite@2x.json']);
    const [atlas] = await loadSpriteAtlases('https://example.com/sprite', {
      fetch: fetchFn,
      pixelRatio
    });
    expect(requested).toEqual(['https://example.com/sprite@2x.json']);
    expect(atlas.image).toBe('https://example.com/sprite@2x.png');
  });

  test('requests only the @1x sprite at a pixel ratio of 1', async () => {
    const {fetchFn, requested} = spriteFetch(['https://example.com/sprite.json']);
    await loadSpriteAtlases('https://example.com/sprite', {fetch: fetchFn, pixelRatio: 1});
    expect(requested).toEqual(['https://example.com/sprite.json']);
  });

  test('keeps the query string after the suffix and extension', async () => {
    const {fetchFn, requested} = spriteFetch(['https://example.com/sprite@2x.json?token=secret']);
    const [atlas] = await loadSpriteAtlases('https://example.com/sprite?token=secret', {
      fetch: fetchFn,
      pixelRatio: 2
    });
    expect(requested).toEqual(['https://example.com/sprite@2x.json?token=secret']);
    expect(atlas.image).toBe('https://example.com/sprite@2x.png?token=secret');
  });

  test('a sprite that fails to load is skipped with a warning, not thrown', async () => {
    const warn = vi.spyOn(log, 'warn').mockReturnValue(() => {});
    const {fetchFn} = spriteFetch([]);
    await expect(
      loadSpriteAtlases('https://example.com/missing', {fetch: fetchFn})
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('sprite image', () => {
  test('is fetched and decoded once per sprite where createImageBitmap exists', async () => {
    const bitmap = {width: 17, height: 17};
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap)
    );
    const requested: string[] = [];
    const fetchFn = (async (url: string) => {
      requested.push(url);
      return {ok: true, status: 200, json: async () => SPRITE_INDEX, blob: async () => ({})};
    }) as unknown as typeof fetch;
    const [atlas] = await loadSpriteAtlases('https://example.com/sprite', {fetch: fetchFn});
    vi.unstubAllGlobals();
    expect(requested).toEqual([
      'https://example.com/sprite.json',
      'https://example.com/sprite.png'
    ]);
    expect(atlas.image).toBe(bitmap);
  });
});

describe('sprite mapping', () => {
  test('marks SDF images as masks and defaults the pixel ratio to 1', () => {
    expect(DEFAULT_ATLAS.mapping['circle-11']).toEqual({
      x: 0,
      y: 0,
      width: 34,
      height: 34,
      mask: false,
      pixelRatio: 2
    });
    expect(DEFAULT_ATLAS.mapping['star-15'].mask).toBe(true);
    expect(DEFAULT_ATLAS.mapping['star-15'].pixelRatio).toBe(1);
  });

  test('resolves unprefixed names in the default sprite and id:name in others', () => {
    const atlases = [DEFAULT_ATLAS, POI_ATLAS];
    expect(resolveSpriteIcon(atlases, 'circle-11')?.atlas).toBe(DEFAULT_ATLAS);
    expect(resolveSpriteIcon(atlases, 'poi:museum')).toMatchObject({
      atlas: POI_ATLAS,
      name: 'museum'
    });
    expect(resolveSpriteIcon(atlases, 'museum')).toBeNull();
  });
});

describe('icon-image', () => {
  test('evaluates expressions per feature', () => {
    const layer = iconLayer({
      'icon-image': ['match', ['get', 'class'], 'museum', 'poi:museum', 'circle-11']
    });
    expect(layer.getIcon(feature({class: 'museum'}))?.name).toBe('museum');
    expect(layer.getIcon(feature({class: 'town'}))?.name).toBe('circle-11');
  });

  test('coalesce falls through to an image the sprites hold', () => {
    const layer = iconLayer({
      'icon-image': [
        'coalesce',
        ['image', 'missing'],
        ['image', 'poi:museum'],
        ['image', 'circle-11']
      ]
    });
    const icon = layer.getIcon(feature({}));
    expect(icon?.atlas.id).toBe('poi');
    expect(icon?.name).toBe('museum');
    const unprefixed = iconLayer({
      'icon-image': ['coalesce', ['image', 'missing'], ['image', 'circle-11']]
    });
    expect(unprefixed.getIcon(feature({}))?.name).toBe('circle-11');
  });

  test('resolves legacy {token} names', () => {
    const layer = iconLayer({'icon-image': '{shape}-11'});
    expect(layer.getIcon(feature({shape: 'circle'}))?.name).toBe('circle-11');
  });

  test('a name that is not in the sprite warns once and draws nothing', () => {
    const warn = vi.spyOn(log, 'warn').mockReturnValue(() => {});
    const layer = iconLayer({'icon-image': 'not-in-sprite-a'});
    expect(layer.getIcon(feature({}))).toBeNull();
    expect(layer.getIcon(feature({}))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    layer.state = {labelData: [{position: [0, 0]}]};
    layer.context = {} as any;
    layer.internalState = {subLayers: []} as any;
    expect(layer.renderIconLayers()).toEqual([]);
  });

  test('draws one icon layer per sprite, with only the rows whose icon it holds', () => {
    const layer = iconLayer({'icon-image': ['get', 'icon']});
    const rows = [
      {position: [0, 0], __source: {object: feature({icon: 'circle-11'}), index: 0}},
      {position: [1, 1], __source: {object: feature({icon: 'poi:museum'}), index: 1}},
      {position: [2, 2], __source: {object: feature({icon: 'circle-11'}), index: 2}}
    ];
    layer.state = {labelData: rows};
    layer.context = {} as any;
    layer.internalState = {subLayers: []} as any;
    const iconLayers = layer.renderIconLayers();
    // `iconAtlas` is an async prop (null until the image loads), so identify each layer by id.
    expect(iconLayers.map((sublayer: any) => [sublayer.id, sublayer.props.data.length])).toEqual([
      ['labels-icons-default', 2],
      ['labels-icons-poi', 1]
    ]);
    expect(iconLayers[0].props.iconMapping).toBe(DEFAULT_ATLAS.mapping);
    // Icons are drawn without the collision filter (see the module docs).
    expect(
      iconLayers[0].props.extensions.some(
        (extension: any) => extension.constructor.extensionName === 'CollisionFilterExtension'
      )
    ).toBe(false);
    expect(iconLayers[1].props.iconMapping).toBe(POI_ATLAS.mapping);
  });
});

describe('icon size, color and offset', () => {
  test('icon-size scales the image height in CSS pixels', () => {
    // 34 device pixels at a pixel ratio of 2 is 17 CSS pixels.
    expect(iconLayer({'icon-image': 'circle-11'}).getIconSize(feature({}))).toBe(17);
    expect(
      iconLayer({'icon-image': 'circle-11', 'icon-size': 0.4}).getIconSize(feature({}))
    ).toBeCloseTo(6.8, 6);
  });

  test('SDF icons take icon-color, other icons keep their own colors; both take icon-opacity', () => {
    const paint = {'icon-color': '#ff0000', 'icon-opacity': 0.5};
    expect(iconLayer({'icon-image': 'star-15'}, paint).getIconColor(feature({}))).toEqual([
      255, 0, 0, 128
    ]);
    expect(iconLayer({'icon-image': 'circle-11'}, paint).getIconColor(feature({}))).toEqual([
      255, 255, 255, 128
    ]);
  });

  test('icon-anchor and icon-offset shift the icon, scaled by icon-size', () => {
    const layer = iconLayer({
      'icon-image': 'circle-11',
      'icon-size': 0.4,
      'icon-anchor': 'bottom',
      'icon-offset': [16, 5]
    });
    // 17 CSS px * 0.4 = 6.8 px; the bottom edge sits on the point, so the center moves up 3.4 px.
    const [x, y] = layer.getIconPixelOffset(feature({}));
    expect(x).toBeCloseTo(6.4, 6);
    expect(y).toBeCloseTo(-3.4 + 2, 6);
  });

  test('icon update triggers follow the zoom step only for zoom-dependent properties', () => {
    const triggersAt = (layout: Record<string, unknown>, zoom: number) =>
      new MVTLabelLayer({
        id: 'labels',
        config: {labels: true},
        styleLayer: {layout, paint: {}},
        zoom,
        spriteAtlases: [DEFAULT_ATLAS]
      } as any).getIconUpdateTriggers();
    const constant = {'icon-image': 'circle-11', 'icon-size': 0.4};
    expect(triggersAt(constant, 7.6)).toEqual(triggersAt(constant, 8.6));
    const zoomDependent = {
      'icon-image': 'circle-11',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 10, 1]
    };
    expect(triggersAt(zoomDependent, 7.6).getIcon).toEqual(triggersAt(zoomDependent, 8.6).getIcon);
    expect(triggersAt(zoomDependent, 7.6).getSize).not.toEqual(
      triggersAt(zoomDependent, 8.6).getSize
    );
    expect(triggersAt(zoomDependent, 7.6).getPixelOffset).not.toEqual(
      triggersAt(zoomDependent, 8.6).getPixelOffset
    );
  });

  test('icon update triggers change when a style value is edited', () => {
    const layout: Record<string, unknown> = {'icon-image': 'circle-11', 'icon-offset': [0, 0]};
    const layer = iconLayer(layout);
    const before = layer.getIconUpdateTriggers();
    layout['icon-offset'] = [4, 0];
    const after = layer.getIconUpdateTriggers();
    expect(after.getPixelOffset).not.toEqual(before.getPixelOffset);
    expect(after.getIcon).toEqual(before.getIcon);
  });
});

describe('text offset and anchor', () => {
  test('text-offset is in ems of text-size', () => {
    const layer = iconLayer({'text-field': 'A', 'text-size': 12, 'text-offset': [0.2, 0.5]});
    expect(layer.getLabelPixelOffset(feature({}))).toEqual([12 * 0.2, 12 * 0.5]);
  });

  test('text-anchor maps to the text layer anchor and baseline', () => {
    const layer = iconLayer({'text-field': 'A', 'text-anchor': 'right'});
    layer.state = {labelData: [{position: [0, 0]}]};
    layer.context = {} as any;
    layer.internalState = {subLayers: []} as any;
    const text = layer.renderLayers().find((sublayer: any) => sublayer.id.endsWith('text'));
    const info = {index: 0, data: [], target: []};
    expect(text.props.getTextAnchor({position: [0, 0]}, info)).toBe('end');
    expect(text.props.getAlignmentBaseline({position: [0, 0]}, info)).toBe('center');
  });
});

describe('sprite plumbing', () => {
  const style = {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [
      {
        id: 'places',
        type: 'symbol',
        source: 'tiles',
        'source-layer': 'place',
        layout: {'icon-image': 'circle-11'}
      }
    ]
  } as any;

  function render(spriteAtlases: SpriteAtlas[] | null) {
    const vectorLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 7,
      styleDefinition: style,
      spriteAtlases
    }).find(layer => layer.id === 'test-tiles');
    return vectorLayer;
  }

  test('the globe helper forwards the sprites', () => {
    const vectorLayer: any = getGlobeBaseLayers({
      idPrefix: 'globe',
      zoom: 6,
      styleDefinition: style,
      spriteAtlases: [DEFAULT_ATLAS],
      globe: {config: {atmosphere: false, basemap: true, labels: true}}
    } as any).find((layer: any) => layer.id === 'globe-tiles');
    const sublayers = vectorLayer.props
      .renderSubLayers({
        id: 'globe-tiles-tile',
        data: [feature({})],
        tile: {index: {x: 0, y: 0, z: 6}}
      })
      .filter(Boolean);
    const symbolLayer = sublayers.find(
      (sublayer: any) => sublayer.props.spriteAtlases !== undefined
    );
    expect(symbolLayer?.props.spriteAtlases).toEqual([DEFAULT_ATLAS]);
  });

  test('symbol sublayers receive the sprites', () => {
    const [labels] = render([DEFAULT_ATLAS]).props.renderSubLayers({
      id: 'test-tiles-tile',
      data: [feature({})],
      tile: {index: {x: 0, y: 0, z: 7}}
    });
    expect(labels.props.spriteAtlases).toEqual([DEFAULT_ATLAS]);
  });

  test('tiles regenerate when the sprites finish loading', () => {
    expect(render(null).props.updateTriggers.renderSubLayers).not.toEqual(
      render([DEFAULT_ATLAS]).props.updateTriggers.renderSubLayers
    );
  });
});
