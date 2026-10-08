// deck.gl-community
// SPDX-License-Identifier: MIT
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import {expect, test} from 'vitest';
import {z} from 'zod';
import {CommunityGeoLayerSchemas} from '../src/schemas/community-geo-layers';

const cases = {
  TileSourceLayer: [
    {tileSource: '@@#tiles', showTileBorders: false},
    {tileSource: {url: '/tiles.json'}}
  ],
  SharedTile2DLayer: [
    {data: '@@#tileset', refinementStrategy: 'no-overlap', maxZoom: null},
    {data: [{url: '/tile.png'}]}
  ],
  TileGridLayer: [
    {tile: '@@#tile', getLabel: '@@=index.z', labelBackgroundColor: [0, 0, 0, 128]},
    {tile: '@@#tile', labelBackgroundColor: [0, 0]}
  ],
  DelaunayCoverLayer: [
    {windField: '@@#weather', elevationScale: 12, lowColor: [30, 60, 90]},
    {windField: '@@#weather', lowColor: [300, 0, 0]}
  ],
  ElevationLayer: [
    {elevationData: '/height.png', bounds: [-125, 24, -66, 50], elevationRange: [-100, 4000]},
    {elevationData: '/height.png', bounds: [0, 0, 1, 1], elevationRange: [0, 1, 2]}
  ],
  ParticleLayer: [
    {windField: '@@#weather', numParticles: 200, trailLength: 12},
    {windField: '@@#weather', numParticles: 2.5}
  ],
  WindLayer: [
    {windField: '@@#weather', gridWidth: 32, gridHeight: 16, time: 2.5},
    {windField: {stations: [], frames: []}}
  ],
  GlobalGridLayer: [
    {globalGrid: '@@#H3Grid', getCellId: '@@=cellId', extruded: true, getElevation: 10},
    {globalGrid: '@@#H3Grid', getCellId: '8928308280fffff'}
  ],
  BasemapLayer: [
    {style: '/style.json', mode: 'globe', globe: {config: {atmosphere: true}}},
    {style: '/style.json', globe: {config: {atmosphere: 'yes'}}}
  ],
  DataDrivenTile3DLayer: [
    {
      data: '/tileset.json',
      filtersByAttribute: {attributeName: 'height', value: 100},
      customizeColors: '@@#colorizeTile',
      colorsByAttribute: {
        attributeName: 'height',
        minValue: 0,
        maxValue: 100,
        minColor: [0, 0, 0, 255],
        maxColor: [255, 255, 255, 255],
        mode: 'replace'
      }
    },
    {data: '/tileset.json', filtersByAttribute: {attributeName: 'height', value: '100'}}
  ],
  SplatLayer: [
    {source: '@@#leaves', getScale: [2, 2, 3], maxSplats: 2000},
    {source: {positions: [0, 0, 0]}}
  ],
  WorldTreeLayer: [
    {
      getTileData: '@@#inventory',
      treeProps: {getTreeType: 'citrus', getHeight: 5},
      maxVisibleTiles: 16
    },
    {getTileData: '@@#inventory', treeProps: {getTreeType: 'maple'}}
  ],
  TreeLayer: [
    {getPosition: '@@=position', getTreeType: "@@='oak'", getHeight: '@@=10', sizeScale: 2},
    {getTreeType: 'maple'}
  ]
} satisfies Record<keyof typeof CommunityGeoLayerSchemas, [object, object]>;

for (const [name, schema] of Object.entries(CommunityGeoLayerSchemas)) {
  const validate = new Ajv2020({strict: false}).compile(
    z.toJSONSchema(schema, {
      override: ({jsonSchema, zodSchema}) => {
        delete jsonSchema.id;
        if (zodSchema instanceof z.ZodTuple && !zodSchema.def.rest) {
          jsonSchema.minItems = zodSchema.def.items.length;
          jsonSchema.maxItems = zodSchema.def.items.length;
          jsonSchema.items = false;
        }
      }
    })
  );
  test(`${name} validates its JSON props and rejects unknown keys in both schemas`, () => {
    const [valid, invalid] = cases[name as keyof typeof cases];
    const good = {id: 'layer', '@@type': name, ...valid};
    const bad = {id: 'layer', '@@type': name, ...invalid};
    expect(schema.safeParse(good).success).toBe(true);
    expect(validate(good), JSON.stringify(validate.errors)).toBe(true);
    expect(schema.safeParse(bad).success).toBe(false);
    expect(validate(bad)).toBe(false);
    expect(schema.safeParse({...good, typoProperty: true}).success).toBe(false);
    expect(validate({...good, typoProperty: true})).toBe(false);
    if (name === 'TreeLayer') {
      for (const detail of ['low', 'medium', 'high']) {
        expect(schema.safeParse({...good, detail}).success).toBe(false);
        expect(validate({...good, detail})).toBe(false);
      }
    }
  });
}

test('accepts the public static and RAD scene controls in SplatLayer documents', () => {
  const document = {
    id: 'scene',
    '@@type': 'SplatLayer',
    data: '/scene.rad',
    transparency: 'auto',
    maxActiveSplats: 1000,
    maxResidentSplats: 4000,
    maxConcurrentLoads: 4,
    workerFactory: '@@#workers',
    onStatusChange: '@@#status',
    sortDomain: 'scene'
  };
  expect(CommunityGeoLayerSchemas.SplatLayer.safeParse(document).success).toBe(true);
  expect(
    CommunityGeoLayerSchemas.SplatLayer.safeParse({...document, maxConcurrentLoads: -1}).success
  ).toBe(false);
});

test('accepts the unified TreeLayer inventory API with flat tree accessors', () => {
  const schema = CommunityGeoLayerSchemas.TreeLayer;
  const document = {
    id: 'inventory',
    '@@type': 'TreeLayer',
    getTileData: '@@#inventory',
    getTreeKey: '@@#key',
    getHeight: 12,
    getDistantCanopyColor: [10, 100, 30],
    transitionDuration: 600,
    maxVisibleTiles: 16,
    minZoom: 0,
    maxZoom: 20,
    maxRequests: 4
  };
  expect(schema.safeParse(document).success).toBe(true);
  expect(schema.safeParse({...document, treeProps: {getHeight: 12}}).success).toBe(false);
  expect(schema.safeParse({...document, _TreeLayerClass: '@@#internal'}).success).toBe(false);
});

test('the existing global-grid gallery document uses the strict community schema', () => {
  const example = JSON.parse(
    readFileSync(
      new URL('../../../examples/playground/examples/06-global-grid.json', import.meta.url),
      'utf8'
    )
  );
  for (const layer of example.layers) {
    expect(CommunityGeoLayerSchemas.GlobalGridLayer.safeParse(layer).success).toBe(true);
  }
});

test('basemap style documents retain JSON expressions without admitting executable values', () => {
  const style = {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['/tiles/{z}/{x}/{y}.pbf']}},
    layers: [
      {
        id: 'water',
        type: 'fill',
        source: 'tiles',
        'source-layer': 'water',
        paint: {'fill-color': ['case', ['==', ['get', 'class'], 'ocean'], '#126', '#369']}
      }
    ]
  };
  const schema = CommunityGeoLayerSchemas.BasemapLayer;
  const layer = {id: 'basemap', '@@type': 'BasemapLayer', style};
  expect(schema.safeParse(layer).success).toBe(true);
  expect(
    schema.safeParse({...layer, style: {...style, sources: {tiles: {tiles: [3]}}}}).success
  ).toBe(false);
  expect(
    schema.safeParse({
      ...layer,
      style: {...style, layers: [{...style.layers[0], paint: {'fill-color': () => '#126'}}]}
    }).success
  ).toBe(false);
});

test('prepared wind fields, tile sources, headers and grid adapters require host references', () => {
  for (const [schema, key] of [
    [CommunityGeoLayerSchemas.WindLayer, 'windField'],
    [CommunityGeoLayerSchemas.ParticleLayer, 'windField'],
    [CommunityGeoLayerSchemas.DelaunayCoverLayer, 'windField'],
    [CommunityGeoLayerSchemas.TileSourceLayer, 'tileSource'],
    [CommunityGeoLayerSchemas.TileGridLayer, 'tile'],
    [CommunityGeoLayerSchemas.GlobalGridLayer, 'globalGrid']
  ] as const) {
    for (const resource of [{}, '/resource.json', {'@@type': 'Resource'}, () => ({})]) {
      expect(
        schema.safeParse({id: 'layer', '@@type': schema.shape['@@type'].value, [key]: resource})
          .success
      ).toBe(false);
    }
  }
});

test('tree accessors accept typed constants and serialized functions', () => {
  const schema = CommunityGeoLayerSchemas.TreeLayer;
  const layer = {id: 'trees', '@@type': 'TreeLayer'};
  const constants = {
    getPosition: [1, 2, 3],
    getTreeType: 'citrus',
    getSeason: 'winter',
    getHeight: 12,
    getTrunkColor: null,
    getCanopyColor: [30, 120, 40],
    getCrop: {kind: 'lemon', color: [255, 220, 10], count: 4, radius: 0.1},
    getCoverageWeight: 0.5
  };
  expect(schema.safeParse({...layer, ...constants}).success).toBe(true);
  for (const key of Object.keys(schema.shape).filter(
    name => name.startsWith('get') && name !== 'getPolygonOffset'
  )) {
    for (const value of ['@@=value', '@@#accessor', {'@@function': 'createAccessor', value: 10}]) {
      expect(schema.safeParse({...layer, [key]: value}).success).toBe(true);
    }
  }
  for (const invalid of [
    {getTreeType: 'maple'},
    {getPosition: [1]},
    {getSeason: 'monsoon'},
    {getCrop: {kind: 'orange', color: [255, 0, 0], count: 4, radius: 0.1}},
    {foveationStrength: 2},
    {characteristics: {leafColor: 1}},
    {maxCanopyPixels: 0}
  ]) {
    expect(schema.safeParse({...layer, ...invalid}).success).toBe(false);
  }
});

test('supports unified authored traits without requiring renderer configuration', () => {
  const valid = {
    id: 'trees',
    '@@type': 'TreeLayer',
    getTree: {
      species: 'citrus',
      height: 5,
      crownRadius: 2,
      season: 'winter',
      wind: true,
      characteristics: {leafSize: 1.2}
    }
  };
  expect(CommunityGeoLayerSchemas.TreeLayer.safeParse(valid).success).toBe(true);
  expect(
    CommunityGeoLayerSchemas.TreeLayer.safeParse({...valid, getTree: {species: 'maple'}}).success
  ).toBe(false);
});

test('flat splat inputs accept host assets, typed affine transforms and explicit transparency', () => {
  const schema = CommunityGeoLayerSchemas.SplatLayer;
  const layer = {
    id: 'splats',
    '@@type': 'SplatLayer',
    getSource: '@@#asset',
    transparency: 'weighted',
    maxTotalSplats: 1000
  };
  expect(schema.safeParse(layer).success).toBe(true);
  expect(
    schema.safeParse({
      ...layer,
      getTransformMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    }).success
  ).toBe(true);
  expect(schema.safeParse({...layer, getTransformMatrix: [1, 2, 3]}).success).toBe(false);
  expect(schema.safeParse({...layer, transparency: 'automatic'}).success).toBe(false);
});
