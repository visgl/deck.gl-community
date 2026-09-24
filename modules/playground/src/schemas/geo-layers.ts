// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {
  PolygonLayerPropsSchema,
  ArcLayerPropsSchema,
  PathLayerPropsSchema,
  GeoJsonLayerPropsSchema
} from './layers';
import {
  CompositeLayerPropsSchema,
  FunctionSchema,
  ConstantSchema,
  CallbackSchema,
  Vector2Schema,
  Vector4Schema,
  ColorSchema,
  MaterialSchema,
  ColorAccessorSchema,
  StringAccessorSchema,
  createAccessorSchema,
  defineLayer
} from './common';

/** JSON-safe props for A5Layer; compose or extend with Zod. */
export const A5LayerPropsSchema = PolygonLayerPropsSchema.extend({
  getPentagon: StringAccessorSchema.optional()
});
/** JSON-safe props for S2Layer; compose or extend with Zod. */
export const S2LayerPropsSchema = PolygonLayerPropsSchema.extend({
  getS2Token: StringAccessorSchema.optional()
});
/** JSON-safe props for QuadkeyLayer; compose or extend with Zod. */
export const QuadkeyLayerPropsSchema = PolygonLayerPropsSchema.extend({
  getQuadkey: StringAccessorSchema.optional()
});
/** JSON-safe props for GeohashLayer; compose or extend with Zod. */
export const GeohashLayerPropsSchema = PolygonLayerPropsSchema.extend({
  getGeohash: StringAccessorSchema.optional()
});
/** JSON-safe props for H3HexagonLayer; compose or extend with Zod. */
export const H3HexagonLayerPropsSchema = PolygonLayerPropsSchema.extend({
  highPrecision: z.union([z.boolean(), z.literal('auto')]).optional(),
  coverage: z.number().min(0).max(1).optional(),
  centerHexagon: z.string().nullable().optional(),
  getHexagon: StringAccessorSchema.optional()
});
/** JSON-safe props for H3ClusterLayer; compose or extend with Zod. */
export const H3ClusterLayerPropsSchema = PolygonLayerPropsSchema.extend({
  getHexagons: createAccessorSchema(z.array(z.union([z.string(), Vector2Schema]))).optional()
});
/** JSON-safe props for GreatCircleLayer; compose or extend with Zod. */
export const GreatCircleLayerPropsSchema = ArcLayerPropsSchema;
/** JSON-safe props for TripsLayer; compose or extend with Zod. */
export const TripsLayerPropsSchema = PathLayerPropsSchema.extend({
  fadeTrail: z.boolean().optional(),
  trailLength: z.number().nonnegative().optional(),
  currentTime: z.number().nonnegative().optional(),
  getTimestamps: createAccessorSchema(z.array(z.number())).optional()
});
export const URLTemplateSchema = z.union([z.string(), z.array(z.string())]);
/** JSON-safe props for TileLayer; compose or extend with Zod. */
export const TileLayerPropsSchema = CompositeLayerPropsSchema.extend({
  data: URLTemplateSchema.optional(),
  TilesetClass: ConstantSchema.optional(),
  renderSubLayers: FunctionSchema.optional(),
  getTileData: CallbackSchema,
  onViewportLoad: CallbackSchema,
  onTileLoad: CallbackSchema,
  onTileUnload: CallbackSchema,
  onTileError: CallbackSchema,
  extent: Vector4Schema.nullable().optional(),
  tileSize: z.number().positive().optional(),
  maxZoom: z.number().nullable().optional(),
  minZoom: z.number().nullable().optional(),
  maxCacheSize: z.number().nonnegative().nullable().optional(),
  maxCacheByteSize: z.number().nonnegative().nullable().optional(),
  refinementStrategy: z
    .union([z.enum(['best-available', 'no-overlap', 'never']), FunctionSchema])
    .optional(),
  zRange: Vector2Schema.nullable().optional(),
  maxRequests: z.number().int().optional(),
  debounceTime: z.number().nonnegative().optional(),
  zoomOffset: z.number().optional(),
  visibleMinZoom: z.number().nullable().optional(),
  visibleMaxZoom: z.number().nullable().optional()
});
export const TileJSONSchema = z
  .object({
    tilejson: z.string().optional(),
    tiles: z.array(z.string()),
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    attribution: z.string().optional(),
    scheme: z.enum(['xyz', 'tms']).optional(),
    minzoom: z.number().optional(),
    maxzoom: z.number().optional(),
    bounds: Vector4Schema.optional(),
    center: z.array(z.number()).min(2).max(3).optional()
  })
  .catchall(z.json());
/** JSON-safe props for MVTLayer; compose or extend with Zod. */
export const MVTLayerPropsSchema = TileLayerPropsSchema.extend({
  ...GeoJsonLayerPropsSchema.shape,
  data: z.union([URLTemplateSchema, TileJSONSchema]).optional(),
  uniqueIdProperty: z.string().optional(),
  highlightedFeatureId: z.union([z.string(), z.number()]).nullable().optional(),
  binary: z.boolean().optional()
});
export const ElevationDecoderSchema = z.strictObject({
  rScaler: z.number(),
  gScaler: z.number(),
  bScaler: z.number(),
  offset: z.number()
});
/** JSON-safe props for TerrainLayer; compose or extend with Zod. */
export const TerrainLayerPropsSchema = TileLayerPropsSchema.extend({
  elevationData: URLTemplateSchema,
  texture: URLTemplateSchema.optional(),
  meshMaxError: z.number().nonnegative().optional(),
  bounds: Vector4Schema.nullable().optional(),
  color: ColorSchema.optional(),
  elevationDecoder: ElevationDecoderSchema.optional(),
  wireframe: z.boolean().optional(),
  material: MaterialSchema.optional(),
  workerUrl: z.string().optional()
});
/** JSON-safe props for Tile3DLayer; compose or extend with Zod. */
export const Tile3DLayerPropsSchema = CompositeLayerPropsSchema.extend({
  data: z.string(),
  getPointColor: ColorAccessorSchema.optional(),
  pointSize: z.number().nonnegative().optional(),
  loader: ConstantSchema.optional(),
  onTilesetLoad: CallbackSchema,
  onTileLoad: CallbackSchema,
  onTileUnload: CallbackSchema,
  onTileError: CallbackSchema,
  _getMeshColor: FunctionSchema.optional()
});
/** JSON-safe props for WMSLayer; compose or extend with Zod. */
export const WMSLayerPropsSchema = CompositeLayerPropsSchema.extend({
  data: z.string(),
  serviceType: z.enum(['wms', 'auto']).optional(),
  layers: z.array(z.string()).optional(),
  srs: z.enum(['EPSG:4326', 'EPSG:3857', 'auto']).optional(),
  onMetadataLoad: CallbackSchema,
  onMetadataLoadError: CallbackSchema,
  onImageLoadStart: CallbackSchema,
  onImageLoad: CallbackSchema,
  onImageLoadError: CallbackSchema
});
export const A5LayerSchema = defineLayer('A5Layer', A5LayerPropsSchema);
export const S2LayerSchema = defineLayer('S2Layer', S2LayerPropsSchema);
export const QuadkeyLayerSchema = defineLayer('QuadkeyLayer', QuadkeyLayerPropsSchema);
export const GeohashLayerSchema = defineLayer('GeohashLayer', GeohashLayerPropsSchema);
export const H3HexagonLayerSchema = defineLayer('H3HexagonLayer', H3HexagonLayerPropsSchema);
export const H3ClusterLayerSchema = defineLayer('H3ClusterLayer', H3ClusterLayerPropsSchema);
export const GreatCircleLayerSchema = defineLayer('GreatCircleLayer', GreatCircleLayerPropsSchema);
export const TripsLayerSchema = defineLayer('TripsLayer', TripsLayerPropsSchema);
export const TileLayerSchema = defineLayer('TileLayer', TileLayerPropsSchema);
export const MVTLayerSchema = defineLayer('MVTLayer', MVTLayerPropsSchema);
export const TerrainLayerSchema = defineLayer('TerrainLayer', TerrainLayerPropsSchema);
export const Tile3DLayerSchema = defineLayer('Tile3DLayer', Tile3DLayerPropsSchema);
export const WMSLayerSchema = defineLayer('_WMSLayer', WMSLayerPropsSchema);

/** Inferred JSON props for A5Layer. */
export type A5LayerProps = z.infer<typeof A5LayerPropsSchema>;
/** Inferred JSON props for S2Layer. */
export type S2LayerProps = z.infer<typeof S2LayerPropsSchema>;
/** Inferred JSON props for QuadkeyLayer. */
export type QuadkeyLayerProps = z.infer<typeof QuadkeyLayerPropsSchema>;
/** Inferred JSON props for GeohashLayer. */
export type GeohashLayerProps = z.infer<typeof GeohashLayerPropsSchema>;
/** Inferred JSON props for H3HexagonLayer. */
export type H3HexagonLayerProps = z.infer<typeof H3HexagonLayerPropsSchema>;
/** Inferred JSON props for H3ClusterLayer. */
export type H3ClusterLayerProps = z.infer<typeof H3ClusterLayerPropsSchema>;
/** Inferred JSON props for GreatCircleLayer. */
export type GreatCircleLayerProps = z.infer<typeof GreatCircleLayerPropsSchema>;
/** Inferred JSON props for TripsLayer. */
export type TripsLayerProps = z.infer<typeof TripsLayerPropsSchema>;
/** Inferred JSON props for TileLayer. */
export type TileLayerProps = z.infer<typeof TileLayerPropsSchema>;
/** Inferred JSON props for MVTLayer. */
export type MVTLayerProps = z.infer<typeof MVTLayerPropsSchema>;
/** Inferred JSON props for TerrainLayer. */
export type TerrainLayerProps = z.infer<typeof TerrainLayerPropsSchema>;
/** Inferred JSON props for Tile3DLayer. */
export type Tile3DLayerProps = z.infer<typeof Tile3DLayerPropsSchema>;
/** Inferred JSON props for WMSLayer. */
export type WMSLayerProps = z.infer<typeof WMSLayerPropsSchema>;
