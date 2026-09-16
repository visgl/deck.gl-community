// deck.gl-community
// SPDX-License-Identifier: MIT

import {z} from 'zod';

/** JSON values accepted by deck.gl's declarative configuration format. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);

export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

/** A function encoded for a JSON document instead of a JavaScript function. */
export const JsonFunctionSchema = z.object({'@@function': z.string()}).passthrough();

export type JsonFunction = z.infer<typeof JsonFunctionSchema>;

/** Values that can be supplied to a JSON-encoded accessor. */
export const AccessorSchema = z.union([JsonValueSchema, JsonFunctionSchema]);
export type Accessor = z.infer<typeof AccessorSchema>;

export const DeckGLPositionSchema = z.array(z.number()).min(2).max(3);
export const ColorSchema = z.array(z.number().int().min(0).max(255)).min(3).max(4);
export const PaddingSchema = z
  .object({
    left: z.union([z.number(), z.string()]).optional(),
    right: z.union([z.number(), z.string()]).optional(),
    top: z.union([z.number(), z.string()]).optional(),
    bottom: z.union([z.number(), z.string()]).optional()
  })
  .passthrough();

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
const NumberAccessor = AccessorSchema;
const ColorAccessor = AccessorSchema;
const PositionAccessor = AccessorSchema;

/** Props shared by every JSON-encoded deck.gl layer. */
export const BaseLayerPropsSchema = z
  .object({
    id: z.string(),
    data: JsonValueSchema.optional(),
    visible: z.boolean().optional(),
    pickable: z.union([z.boolean(), z.literal('3d')]).optional(),
    opacity: z.number().min(0).max(1).optional(),
    coordinateSystem: z.union([z.string(), z.number()]).optional(),
    coordinateOrigin: DeckGLPositionSchema.optional(),
    modelMatrix: z.array(z.number()).length(16).optional(),
    wrapLongitude: z.boolean().optional(),
    positionFormat: z.enum(['XY', 'XYZ']).optional(),
    colorFormat: z.enum(['RGB', 'RGBA']).optional(),
    operation: z.string().optional(),
    parameters: JsonObjectSchema.optional(),
    transitions: JsonObjectSchema.nullable().optional(),
    updateTriggers: JsonObjectSchema.optional(),
    autoHighlight: z.boolean().optional(),
    highlightedObjectIndex: z.number().int().nullable().optional(),
    highlightColor: ColorAccessor.optional(),
    extensions: z.array(JsonValueSchema).optional(),
    loaders: z.array(JsonValueSchema).optional(),
    loadOptions: JsonObjectSchema.optional()
  })
  .passthrough();

type LayerSchema = z.ZodTypeAny;

function makeLayerSchema(name: string, properties: Record<string, z.ZodTypeAny> = {}): LayerSchema {
  return z
    .object({
      '@@type': z.literal(name),
      ...BaseLayerPropsSchema.shape,
      ...properties
    })
    .passthrough();
}

const sharedPositionProps = {
  getPosition: PositionAccessor.optional(),
  getColor: ColorAccessor.optional(),
  getRadius: NumberAccessor.optional(),
  getSize: NumberAccessor.optional(),
  getWidth: NumberAccessor.optional(),
  getElevation: NumberAccessor.optional(),
  getLineColor: ColorAccessor.optional(),
  getLineWidth: NumberAccessor.optional()
};

/** Schemas for all stable and experimental layer exports in the official deck.gl packages. */
export const DeckGLLayerSchemas = {
  ArcLayer: makeLayerSchema('ArcLayer', {
    getSourcePosition: PositionAccessor.optional(),
    getTargetPosition: PositionAccessor.optional(),
    getSourceColor: ColorAccessor.optional(),
    getTargetColor: ColorAccessor.optional(),
    getWidth: NumberAccessor.optional(),
    getHeight: NumberAccessor.optional(),
    getTilt: NumberAccessor.optional(),
    numSegments: z.number().int().min(1).optional(),
    widthScale: z.number().min(0).optional(),
    widthMinPixels: z.number().min(0).optional(),
    widthMaxPixels: z.number().min(0).optional()
  }),
  BitmapLayer: makeLayerSchema('BitmapLayer', {
    image: JsonValueSchema.optional(),
    bounds: z.array(z.number()).min(4).max(8).optional(),
    desaturate: z.number().min(0).max(1).optional(),
    transparentColor: ColorSchema.optional(),
    tintColor: ColorSchema.optional()
  }),
  IconLayer: makeLayerSchema('IconLayer', {
    ...sharedPositionProps,
    iconAtlas: JsonValueSchema.optional(),
    iconMapping: JsonValueSchema.optional(),
    getIcon: AccessorSchema.optional(),
    sizeScale: z.number().min(0).optional(),
    sizeMinPixels: z.number().min(0).optional(),
    sizeMaxPixels: z.number().min(0).optional(),
    alphaCutoff: z.number().min(0).max(1).optional(),
    getAngle: NumberAccessor.optional(),
    getPixelOffset: AccessorSchema.optional()
  }),
  LineLayer: makeLayerSchema('LineLayer', {
    getSourcePosition: PositionAccessor.optional(),
    getTargetPosition: PositionAccessor.optional(),
    getColor: ColorAccessor.optional(),
    getWidth: NumberAccessor.optional(),
    widthScale: z.number().min(0).optional(),
    widthMinPixels: z.number().min(0).optional(),
    widthMaxPixels: z.number().min(0).optional()
  }),
  PointCloudLayer: makeLayerSchema('PointCloudLayer', {
    ...sharedPositionProps,
    getNormal: AccessorSchema.optional(),
    pointSize: z.number().min(0).optional()
  }),
  ScatterplotLayer: makeLayerSchema('ScatterplotLayer', {
    ...sharedPositionProps,
    radiusScale: z.number().min(0).optional(),
    radiusMinPixels: z.number().min(0).optional(),
    radiusMaxPixels: z.number().min(0).optional(),
    lineWidthScale: z.number().min(0).optional(),
    lineWidthMinPixels: z.number().min(0).optional(),
    lineWidthMaxPixels: z.number().min(0).optional(),
    getPixelOffset: AccessorSchema.optional()
  }),
  ColumnLayer: makeLayerSchema('ColumnLayer', {
    ...sharedPositionProps,
    diskResolution: z.number().int().min(4).optional(),
    radius: z.number().min(0).optional(),
    angle: z.number().optional(),
    offset: z.array(z.number()).length(2).optional(),
    coverage: z.number().min(0).max(1).optional(),
    elevationScale: z.number().min(0).optional()
  }),
  GridCellLayer: makeLayerSchema('GridCellLayer', {cellSize: z.number().min(0).optional()}),
  PathLayer: makeLayerSchema('PathLayer', {
    getPath: AccessorSchema.optional(),
    getColor: ColorAccessor.optional(),
    getWidth: NumberAccessor.optional(),
    widthScale: z.number().min(0).optional(),
    widthMinPixels: z.number().min(0).optional(),
    widthMaxPixels: z.number().min(0).optional(),
    miterLimit: z.number().min(0).optional(),
    jointRounded: z.boolean().optional(),
    billboard: z.boolean().optional(),
    capRounded: z.boolean().optional()
  }),
  PolygonLayer: makeLayerSchema('PolygonLayer', {
    getPolygon: AccessorSchema.optional(),
    getFillColor: ColorAccessor.optional(),
    getLineColor: ColorAccessor.optional(),
    getLineWidth: NumberAccessor.optional(),
    getElevation: NumberAccessor.optional(),
    extruded: z.boolean().optional(),
    wireframe: z.boolean().optional(),
    filled: z.boolean().optional(),
    stroked: z.boolean().optional(),
    lineWidthScale: z.number().min(0).optional(),
    lineWidthMinPixels: z.number().min(0).optional(),
    lineWidthMaxPixels: z.number().min(0).optional()
  }),
  GeoJsonLayer: makeLayerSchema('GeoJsonLayer', {
    data: JsonValueSchema.optional(),
    stroked: z.boolean().optional(),
    filled: z.boolean().optional(),
    extruded: z.boolean().optional(),
    wireframe: z.boolean().optional(),
    getFillColor: ColorAccessor.optional(),
    getLineColor: ColorAccessor.optional(),
    getLineWidth: NumberAccessor.optional(),
    getPointRadius: NumberAccessor.optional(),
    getText: AccessorSchema.optional(),
    getIcon: AccessorSchema.optional()
  }),
  TextLayer: makeLayerSchema('TextLayer', {
    ...sharedPositionProps,
    getText: AccessorSchema.optional(),
    getAngle: NumberAccessor.optional(),
    getTextAnchor: AccessorSchema.optional(),
    getAlignmentBaseline: AccessorSchema.optional(),
    getPixelOffset: AccessorSchema.optional(),
    getBackgroundColor: ColorAccessor.optional(),
    getBorderColor: ColorAccessor.optional(),
    getBorderWidth: NumberAccessor.optional(),
    getSize: NumberAccessor.optional(),
    sizeScale: z.number().min(0).optional(),
    sizeMinPixels: z.number().min(0).optional(),
    sizeMaxPixels: z.number().min(0).optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.union([z.number(), z.string()]).optional()
  }),
  SolidPolygonLayer: makeLayerSchema('SolidPolygonLayer', {
    getPolygon: AccessorSchema.optional(),
    getElevation: NumberAccessor.optional(),
    getFillColor: ColorAccessor.optional(),
    getLineColor: ColorAccessor.optional(),
    getLineWidth: NumberAccessor.optional(),
    elevationScale: z.number().min(0).optional()
  }),
  ScreenGridLayer: makeLayerSchema('ScreenGridLayer', {
    cellSizePixels: z.number().min(1).optional(),
    colorDomain: z.array(z.number()).length(2).optional(),
    colorRange: z.array(ColorSchema).optional(),
    getPosition: PositionAccessor.optional(),
    getWeight: NumberAccessor.optional()
  }),
  HexagonLayer: makeLayerSchema('HexagonLayer', {
    radius: z.number().min(0).optional(),
    elevationScale: z.number().min(0).optional(),
    extruded: z.boolean().optional(),
    getPosition: PositionAccessor.optional(),
    getColorWeight: NumberAccessor.optional(),
    getElevationWeight: NumberAccessor.optional(),
    colorAggregation: z.string().optional(),
    elevationAggregation: z.string().optional()
  }),
  ContourLayer: makeLayerSchema('ContourLayer', {
    cellSize: z.number().min(0).optional(),
    contours: z.array(JsonValueSchema).optional(),
    getPosition: PositionAccessor.optional(),
    getWeight: NumberAccessor.optional()
  }),
  GridLayer: makeLayerSchema('GridLayer', {
    cellSize: z.number().min(0).optional(),
    elevationScale: z.number().min(0).optional(),
    extruded: z.boolean().optional(),
    getPosition: PositionAccessor.optional(),
    getColorWeight: NumberAccessor.optional(),
    getElevationWeight: NumberAccessor.optional()
  }),
  HeatmapLayer: makeLayerSchema('HeatmapLayer', {
    radiusPixels: z.number().min(0).optional(),
    intensity: z.number().min(0).optional(),
    threshold: z.number().min(0).max(1).optional(),
    getPosition: PositionAccessor.optional(),
    getWeight: NumberAccessor.optional()
  }),
  A5Layer: makeLayerSchema('A5Layer', {
    getHexagon: AccessorSchema.optional(),
    getFillColor: ColorAccessor.optional()
  }),
  WMSLayer: makeLayerSchema('WMSLayer', {
    data: JsonValueSchema.optional(),
    serviceType: z.enum(['wms', 'wmts']).optional(),
    layers: z.string().optional(),
    getTileData: AccessorSchema.optional()
  }),
  GreatCircleLayer: makeLayerSchema('GreatCircleLayer', {
    getSourcePosition: PositionAccessor.optional(),
    getTargetPosition: PositionAccessor.optional(),
    getSourceColor: ColorAccessor.optional(),
    getTargetColor: ColorAccessor.optional(),
    getWidth: NumberAccessor.optional()
  }),
  S2Layer: makeLayerSchema('S2Layer', {
    getS2Token: AccessorSchema.optional(),
    getFillColor: ColorAccessor.optional()
  }),
  QuadkeyLayer: makeLayerSchema('QuadkeyLayer', {
    getQuadkey: AccessorSchema.optional(),
    getFillColor: ColorAccessor.optional()
  }),
  TileLayer: makeLayerSchema('TileLayer', {
    tileSize: z.number().int().min(1).optional(),
    maxZoom: z.number().optional(),
    minZoom: z.number().optional()
  }),
  TripsLayer: makeLayerSchema('TripsLayer', {
    getPath: AccessorSchema.optional(),
    getTimestamps: AccessorSchema.optional(),
    getColor: ColorAccessor.optional(),
    trailLength: z.number().min(0).optional(),
    currentTime: z.number().optional()
  }),
  H3ClusterLayer: makeLayerSchema('H3ClusterLayer', {
    getHexagons: AccessorSchema.optional(),
    getFillColor: ColorAccessor.optional()
  }),
  H3HexagonLayer: makeLayerSchema('H3HexagonLayer', {
    getHexagon: AccessorSchema.optional(),
    getFillColor: ColorAccessor.optional()
  }),
  Tile3DLayer: makeLayerSchema('Tile3DLayer', {
    data: JsonValueSchema.optional(),
    loaders: z.array(JsonValueSchema).optional()
  }),
  TerrainLayer: makeLayerSchema('TerrainLayer', {
    elevationData: JsonValueSchema.optional(),
    texture: JsonValueSchema.optional(),
    bounds: z.array(z.number()).length(4).optional(),
    elevationDecoder: JsonObjectSchema.optional()
  }),
  MVTLayer: makeLayerSchema('MVTLayer', {
    data: JsonValueSchema.optional(),
    getFillColor: ColorAccessor.optional(),
    getLineColor: ColorAccessor.optional(),
    getLineWidth: NumberAccessor.optional(),
    binary: z.boolean().optional()
  }),
  GeohashLayer: makeLayerSchema('GeohashLayer', {
    getGeohash: AccessorSchema.optional(),
    getFillColor: ColorAccessor.optional()
  }),
  SimpleMeshLayer: makeLayerSchema('SimpleMeshLayer', {
    mesh: JsonValueSchema.optional(),
    getPosition: PositionAccessor.optional(),
    getColor: ColorAccessor.optional(),
    getScale: AccessorSchema.optional(),
    getOrientation: AccessorSchema.optional(),
    getTranslation: AccessorSchema.optional()
  }),
  ScenegraphLayer: makeLayerSchema('ScenegraphLayer', {
    scenegraph: JsonValueSchema.optional(),
    getPosition: PositionAccessor.optional(),
    getColor: ColorAccessor.optional(),
    getScale: AccessorSchema.optional(),
    getOrientation: AccessorSchema.optional(),
    getTranslation: AccessorSchema.optional(),
    _animations: JsonObjectSchema.optional()
  }),
  MultiIconLayer: makeLayerSchema('MultiIconLayer', {getIconOffsets: AccessorSchema.optional()}),
  TextBackgroundLayer: makeLayerSchema('TextBackgroundLayer', {
    getPosition: PositionAccessor.optional(),
    getFillColor: ColorAccessor.optional(),
    getLineColor: ColorAccessor.optional(),
    getLineWidth: NumberAccessor.optional()
  })
} as const;

export type DeckGLLayerName = keyof typeof DeckGLLayerSchemas;
export type DeckGLLayer = z.infer<(typeof DeckGLLayerSchemas)[DeckGLLayerName]>;

const CommonViewProps = {
  id: z.string().optional(),
  canvasId: z.string().optional(),
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  padding: PaddingSchema.nullable().optional(),
  clear: z.boolean().optional(),
  clearColor: z.union([ColorSchema, z.literal(false)]).optional(),
  clearDepth: z.union([z.number(), z.literal(false)]).optional(),
  clearStencil: z.union([z.number(), z.literal(false)]).optional(),
  parameters: JsonObjectSchema.optional(),
  controller: z.union([z.boolean(), z.string(), JsonObjectSchema]).nullable().optional(),
  viewState: JsonObjectSchema.optional()
};

function makeViewSchema(name: string, properties: Record<string, z.ZodTypeAny> = {}) {
  return z.object({'@@type': z.literal(name), ...CommonViewProps, ...properties}).passthrough();
}

/** Schemas for all concrete core deck.gl views plus the abstract view shape. */
export const DeckGLViewSchemas = {
  View: makeViewSchema('View'),
  MapView: makeViewSchema('MapView', {
    longitude: z.number().optional(),
    latitude: z.number().optional(),
    zoom: z.number().optional(),
    bearing: z.number().optional(),
    pitch: z.number().optional(),
    maxZoom: z.number().optional(),
    minZoom: z.number().optional()
  }),
  FirstPersonView: makeViewSchema('FirstPersonView', {
    position: DeckGLPositionSchema.optional(),
    bearing: z.number().optional(),
    pitch: z.number().optional(),
    longitude: z.number().optional(),
    latitude: z.number().optional()
  }),
  OrbitView: makeViewSchema('OrbitView', {
    orbitAxis: z.enum(['Y', 'Z']).optional(),
    rotationOrbit: z.number().optional(),
    rotationX: z.number().optional(),
    target: DeckGLPositionSchema.optional(),
    zoom: z.number().optional()
  }),
  OrthographicView: makeViewSchema('OrthographicView', {
    target: DeckGLPositionSchema.optional(),
    zoom: z.number().optional(),
    flipY: z.boolean().optional()
  }),
  GlobeView: makeViewSchema('GlobeView', {
    longitude: z.number().optional(),
    latitude: z.number().optional(),
    zoom: z.number().optional(),
    bearing: z.number().optional(),
    pitch: z.number().optional()
  })
} as const;

export type DeckGLViewName = keyof typeof DeckGLViewSchemas;
export type DeckGLView = z.infer<(typeof DeckGLViewSchemas)[DeckGLViewName]>;

const LayerUnionSchema = z.union(
  Object.values(DeckGLLayerSchemas) as unknown as [LayerSchema, LayerSchema, ...LayerSchema[]]
);
const ViewUnionSchema = z.union(
  Object.values(DeckGLViewSchemas) as unknown as [LayerSchema, LayerSchema, ...LayerSchema[]]
);

/** A complete JSON document accepted by the playground's deck.gl schema. */
export const DeckGLDocumentSchema = z
  .object({
    layers: z.array(LayerUnionSchema).optional(),
    views: z.union([ViewUnionSchema, z.array(ViewUnionSchema)]).optional(),
    initialViewState: JsonObjectSchema.optional(),
    viewState: JsonObjectSchema.optional(),
    effects: z.array(JsonValueSchema).optional(),
    mapStyle: JsonValueSchema.optional()
  })
  .passthrough();

export type DeckGLDocument = z.infer<typeof DeckGLDocumentSchema>;
