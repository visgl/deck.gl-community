// deck.gl-community
// SPDX-License-Identifier: MIT
import {describe, test, expect, expectTypeOf} from 'vitest';
import {z} from 'zod';
import Ajv2020 from 'ajv/dist/2020';
import {
  DeckGLLayerSchemas,
  DeckGLDocumentSchema,
  DeckGLViewSchema,
  DeckGLViewStateSchemas,
  DeckGLViewStateSchema,
  ScatterplotLayerPropsSchema,
  ScatterplotLayerSchema,
  createDeckGLDocumentSchema,
  createDeckGLJSONSchema,
  DeckGLLayerSchema,
  type DeckGLLayer
} from '../src/schemas/deckgl';

// A valid and an invalid layer-specific prop for every supported concrete layer.
const cases = {
  ArcLayer: [{widthUnits: 'pixels', getSourceColor: [1, 2, 3]}, {widthUnits: 'feet'}],
  BitmapLayer: [
    {
      bounds: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ]
    },
    {bounds: [0, 1, 2, 3, 4]}
  ],
  IconLayer: [{getIcon: '@@=icon', sizeBasis: 'width'}, {getPixelOffset: [1, 2, 3]}],
  LineLayer: [{getWidth: 2}, {getWidth: 'two'}],
  PointCloudLayer: [{getNormal: [0, 0, 1]}, {getNormal: [0, 1]}],
  ScatterplotLayer: [
    {getFillColor: [20, 30, 40], radiusUnits: 'common'},
    {getFillColor: [300, 0, 0]}
  ],
  ColumnLayer: [{diskResolution: 6, material: {shininess: 30}}, {diskResolution: 2}],
  GridCellLayer: [{cellSize: 100, getFillColor: '@@=color'}, {lineWidthUnits: 'feet'}],
  PathLayer: [{getPath: '@@=path', getWidth: [1, 2]}, {getWidth: [1, 'two']}],
  PolygonLayer: [{extruded: true, _windingOrder: 'CCW'}, {_windingOrder: 'clockwise'}],
  GeoJsonLayer: [
    {getText: '@@=properties.name', textWordBreak: 'break-word'},
    {textFontSettings: {fontSize: 'large'}}
  ],
  TextLayer: [{getText: '@@=label', getTextAnchor: 'middle'}, {getTextAnchor: 'left'}],
  SolidPolygonLayer: [{getPolygon: '@@=polygon', _full3d: true}, {extruded: 'yes'}],
  MultiIconLayer: [
    {getIconOffsets: '@@=offsets', contentAlignHorizontal: 'none'},
    {contentCutoffPixels: [1, 2, 3]}
  ],
  TextBackgroundLayer: [{getBoundingRect: [0, 0, 10, 10]}, {padding: [1, 2, 3]}],
  ScreenGridLayer: [{aggregation: 'COUNT', cellMarginPixels: 1}, {aggregation: 'MEDIAN'}],
  HexagonLayer: [
    {getElevationWeight: 2, elevationScaleType: 'linear'},
    {elevationScaleType: 'quantile'}
  ],
  ContourLayer: [
    {contours: [{threshold: [1, 2], color: [10, 20, 30]}]},
    {contours: [{threshold: [1, 2, 3]}]}
  ],
  GridLayer: [{colorAggregation: 'MAX', lowerPercentile: 5}, {lowerPercentile: 101}],
  HeatmapLayer: [{aggregation: 'MEAN'}, {aggregation: 'COUNT'}],
  A5Layer: [{getPentagon: '@@=cell'}, {getPentagon: 123}],
  WMSLayer: [{layers: ['temperature'], serviceType: 'auto'}, {layers: 'temperature'}],
  GreatCircleLayer: [{numSegments: 100, greatCircle: true}, {widthScale: -1}],
  S2Layer: [{getS2Token: '@@=token', extruded: true}, {getS2Token: false}],
  QuadkeyLayer: [{getQuadkey: '@@=quadkey'}, {getFillColor: [1, 2]}],
  TileLayer: [{maxZoom: null, refinementStrategy: 'no-overlap'}, {refinementStrategy: 'unknown'}],
  TripsLayer: [{getTimestamps: '@@=timestamps', widthUnits: 'pixels'}, {getWidth: false}],
  H3ClusterLayer: [{getHexagons: ['8928308280fffff']}, {getHexagons: [false]}],
  H3HexagonLayer: [{highPrecision: 'auto', coverage: 0.8}, {coverage: 1.1}],
  Tile3DLayer: [{getPointColor: [1, 2, 3]}, {pointSize: 'large'}],
  TerrainLayer: [
    {elevationDecoder: {rScaler: 1, gScaler: 1, bScaler: 1, offset: -100}},
    {elevationDecoder: {rScaler: 'bad'}}
  ],
  MVTLayer: [{binary: true, getTextSize: 12, maxZoom: 12}, {getTextSize: false}],
  GeohashLayer: [{getGeohash: '@@=hash'}, {getGeohash: []}],
  SimpleMeshLayer: [{getScale: [1, 2, 3]}, {getScale: [1, 2]}],
  ScenegraphLayer: [
    {_animations: {'*': {playing: true, speed: 2}}},
    {_animations: {'*': {playing: 'yes'}}}
  ]
} satisfies Record<keyof typeof DeckGLLayerSchemas, [object, object]>;

const artifact = createDeckGLJSONSchema();
const validate = new Ajv2020({strict: false}).compile(artifact);

test('polygon dash accessors accept deferred values in Zod and JSON Schema', () => {
  for (const value of [2, null, '@@=dash', '@@#dash', {'@@function': 'getDash', size: 2}]) {
    const document = {layers: [{...base('PolygonLayer'), getLineDashArray: value}]};
    expect(DeckGLDocumentSchema.safeParse(document).success).toBe(true);
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  }
  for (const value of [false, [], {}, 'invalid']) {
    const document = {layers: [{...base('PolygonLayer'), getLineDashArray: value}]};
    expect(DeckGLDocumentSchema.safeParse(document).success).toBe(false);
    expect(validate(document)).toBe(false);
  }
});

test('custom views compose typed camera states for both document state properties', () => {
  const state = z.strictObject({distance: z.number()});
  const view = z.strictObject({'@@type': z.literal('CustomView')});
  const customOnly = createDeckGLDocumentSchema(DeckGLLayerSchema, view, state);
  expectTypeOf<z.infer<typeof customOnly>['initialViewState']>().toEqualTypeOf<
    {distance: number} | Record<string, {distance: number}> | undefined
  >();
  const schema = createDeckGLDocumentSchema(
    z.never(),
    z.union([DeckGLViewSchema, view]),
    z.union([DeckGLViewStateSchema, state])
  );
  const validateCustom = new Ajv2020({strict: false}).compile(
    z.toJSONSchema(schema, {
      override: ({jsonSchema}) => {
        delete jsonSchema.id;
      }
    })
  );
  for (const key of ['initialViewState', 'viewState']) {
    for (const value of [
      {distance: 10},
      {camera: {distance: 10}},
      {camera: {distance: 10}, map: {longitude: 0, latitude: 0, zoom: 1}}
    ]) {
      const document = {views: [{'@@type': 'CustomView'}], [key]: value};
      expect(schema.safeParse(document).success).toBe(true);
      expect(validateCustom(document), JSON.stringify(validateCustom.errors)).toBe(true);
      expect(DeckGLDocumentSchema.safeParse({[key]: value}).success).toBe(false);
    }
    for (const value of [{distance: 'bad'}, {camera: {distance: 'bad'}}, {distance: 1, typo: 2}]) {
      expect(schema.safeParse({[key]: value}).success).toBe(false);
      expect(validateCustom({[key]: value})).toBe(false);
    }
  }
  expect(customOnly.safeParse({viewState: null}).success).toBe(true);
});

test('honors numeric bounds published in deck.gl defaultProps', async () => {
  const constructors = {
    ...(await import('@deck.gl/layers')),
    ...(await import('@deck.gl/aggregation-layers')),
    ...(await import('@deck.gl/geo-layers')),
    ...(await import('@deck.gl/mesh-layers'))
  };
  const mismatches: string[] = [];
  for (const schema of Object.values(DeckGLLayerSchemas)) {
    const name = schema.shape['@@type'].value;
    const shape: Record<string, z.ZodType> = schema.shape;
    const defaults = {};
    const chain = [];
    for (let ctor = constructors[name]; ctor?.defaultProps; ctor = Object.getPrototypeOf(ctor))
      chain.unshift(ctor);
    for (const ctor of chain) Object.assign(defaults, ctor.defaultProps);
    for (const [key, descriptor] of Object.entries(defaults)) {
      if (!descriptor || typeof descriptor !== 'object' || !shape[key]) continue;
      const constraints = descriptor as {type?: unknown; min?: unknown; max?: unknown};
      if (constraints.type !== 'number') continue;
      for (const bound of ['min', 'max'] as const) {
        const value = constraints[bound];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const invalid = value + (bound === 'min' ? -1 : 1);
        if (shape[key].safeParse(invalid).success)
          mismatches.push(`${name}.${key}: ${bound} ${value}`);
      }
    }
  }
  expect(mismatches).toEqual([]);
});
function base(name: string) {
  return {
    id: 'test',
    '@@type': DeckGLLayerSchemas[name as keyof typeof DeckGLLayerSchemas].shape['@@type'].value,
    ...(['WMSLayer', 'Tile3DLayer'].includes(name) ? {data: 'https://example.com/data'} : {}),
    ...(name === 'TerrainLayer' ? {elevationData: '/terrain/{z}/{x}/{y}.png'} : {}),
    ...(name === 'SimpleMeshLayer' ? {mesh: 'model.obj'} : {}),
    ...(name === 'ScenegraphLayer' ? {scenegraph: 'model.glb'} : {})
  };
}
describe('layer validation agrees with generated JSON Schema', () => {
  for (const [name, [valid, invalid]] of Object.entries(cases)) {
    test(name, () => {
      const good = {layers: [{...base(name), ...valid}]};
      const bad = {layers: [{...base(name), ...invalid}]};
      expect(DeckGLDocumentSchema.safeParse(good).success).toBe(true);
      expect(validate(good), JSON.stringify(validate.errors)).toBe(true);
      expect(DeckGLDocumentSchema.safeParse(bad).success).toBe(false);
      expect(validate(bad)).toBe(false);
      expect(
        DeckGLDocumentSchema.safeParse({layers: [{...base(name), typoProperty: true}]}).success
      ).toBe(false);
    });
  }
});
test('validates accessors without accepting arbitrary JSON or executing expressions', () => {
  for (const getRadius of [
    3,
    '@@=radius * 2',
    '@@#radius',
    {'@@function': 'calculateRadius', base: 2}
  ]) {
    expect(ScatterplotLayerPropsSchema.safeParse({id: 'a', getRadius}).success).toBe(true);
  }
  for (const getRadius of [false, null, [], {radius: 2}, () => 2, Promise.resolve(2), '@@=']) {
    expect(ScatterplotLayerPropsSchema.safeParse({id: 'a', getRadius}).success).toBe(false);
  }
});
test('validates view constructors separately from view state', () => {
  const views = [
    {'@@type': 'MapView', repeat: true, viewState: {longitude: 2}},
    {'@@type': '_GlobeView', resolution: 2, viewState: 'earth'},
    {'@@type': 'OrbitView', orbitAxis: 'Y', viewState: {target: [0, 0, 0]}},
    {'@@type': 'OrthographicView', flipY: false, viewState: {zoom: [1, 2]}},
    {'@@type': 'FirstPersonView', focalDistance: 10, viewState: {position: [0, 0, 2]}}
  ];
  for (const view of views) {
    expect(DeckGLViewSchema.safeParse(view).success).toBe(true);
    expect(validate({views: [view]}), JSON.stringify(validate.errors)).toBe(true);
    expect(
      DeckGLViewSchema.safeParse({...view, controller: {scrollZoom: {speed: 'fast'}}}).success
    ).toBe(false);
    expect(validate({views: [{...view, controller: {scrollZoom: {speed: 'fast'}}}]})).toBe(false);
  }
  expect(DeckGLViewSchema.safeParse({'@@type': 'View'}).success).toBe(false);
  expect(DeckGLViewSchema.safeParse({'@@type': 'MapView', longitude: 2}).success).toBe(false);
  expect(DeckGLViewStateSchemas.MapView.safeParse({longitude: 0, latitude: 0}).success).toBe(false);
  expect(
    DeckGLDocumentSchema.safeParse({initialViewState: {longitude: 'bad', latitude: 0, zoom: 2}})
      .success
  ).toBe(false);
  expect(
    DeckGLDocumentSchema.safeParse({
      initialViewState: {
        map: {longitude: 0, latitude: 0, zoom: 2},
        plot: {target: [0, 0], zoomX: 2}
      }
    }).success
  ).toBe(true);
});
test('custom layers extend a typed catalog without weakening built-in schemas', () => {
  const CustomLayer = ScatterplotLayerPropsSchema.extend({
    '@@type': z.literal('CustomLayer'),
    threshold: z.number()
  });
  const schema = createDeckGLDocumentSchema(
    z.union([DeckGLLayerSchema, CustomLayer]),
    DeckGLViewSchema
  );
  expect(
    schema.safeParse({layers: [{id: 'custom', '@@type': 'CustomLayer', threshold: 2}]}).success
  ).toBe(true);
  expect(
    schema.safeParse({layers: [{id: 'custom', '@@type': 'CustomLayer', threshold: 'two'}]}).success
  ).toBe(false);
});
test('retains discriminated TypeScript types and named JSON definitions', () => {
  type Scatterplot = z.infer<typeof ScatterplotLayerSchema>;
  expectTypeOf<Scatterplot['@@type']>().toEqualTypeOf<'ScatterplotLayer'>();
  expectTypeOf<Scatterplot['radiusScale']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<Extract<DeckGLLayer, {'@@type': 'ScatterplotLayer'}>>().toEqualTypeOf<Scatterplot>();
  expect(artifact.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(artifact.$id).toBe('urn:deck-gl-community:playground:deckgl-schema');
  for (const schema of Object.values(DeckGLLayerSchemas)) {
    expect(artifact.$defs).toHaveProperty(schema.meta()!.id!);
  }
});
