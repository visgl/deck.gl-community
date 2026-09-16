// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import * as layers from './layers';
import * as aggregation from './aggregation-layers';
import * as geo from './geo-layers';
import * as mesh from './mesh-layers';
import {DeckGLViewSchema, DeckGLViewStateSchema, ControllerSchema} from './views';
import {
  ClassSchema,
  ConstantSchema,
  FunctionSchema,
  JsonValueSchema,
  ParametersSchema
} from './common';

export * from './common';
export * from './layers';
export * from './aggregation-layers';
export * from './geo-layers';
export * from './mesh-layers';
export * from './views';

/** Concrete official layers. Experimental discriminators match their upstream export names. */
export const DeckGLLayerSchemas = {
  ArcLayer: layers.ArcLayerSchema,
  BitmapLayer: layers.BitmapLayerSchema,
  IconLayer: layers.IconLayerSchema,
  LineLayer: layers.LineLayerSchema,
  PointCloudLayer: layers.PointCloudLayerSchema,
  ScatterplotLayer: layers.ScatterplotLayerSchema,
  ColumnLayer: layers.ColumnLayerSchema,
  GridCellLayer: layers.GridCellLayerSchema,
  PathLayer: layers.PathLayerSchema,
  PolygonLayer: layers.PolygonLayerSchema,
  GeoJsonLayer: layers.GeoJsonLayerSchema,
  TextLayer: layers.TextLayerSchema,
  SolidPolygonLayer: layers.SolidPolygonLayerSchema,
  MultiIconLayer: layers.MultiIconLayerSchema,
  TextBackgroundLayer: layers.TextBackgroundLayerSchema,
  ScreenGridLayer: aggregation.ScreenGridLayerSchema,
  HexagonLayer: aggregation.HexagonLayerSchema,
  ContourLayer: aggregation.ContourLayerSchema,
  GridLayer: aggregation.GridLayerSchema,
  HeatmapLayer: aggregation.HeatmapLayerSchema,
  A5Layer: geo.A5LayerSchema,
  WMSLayer: geo.WMSLayerSchema,
  GreatCircleLayer: geo.GreatCircleLayerSchema,
  S2Layer: geo.S2LayerSchema,
  QuadkeyLayer: geo.QuadkeyLayerSchema,
  TileLayer: geo.TileLayerSchema,
  TripsLayer: geo.TripsLayerSchema,
  H3ClusterLayer: geo.H3ClusterLayerSchema,
  H3HexagonLayer: geo.H3HexagonLayerSchema,
  Tile3DLayer: geo.Tile3DLayerSchema,
  TerrainLayer: geo.TerrainLayerSchema,
  MVTLayer: geo.MVTLayerSchema,
  GeohashLayer: geo.GeohashLayerSchema,
  SimpleMeshLayer: mesh.SimpleMeshLayerSchema,
  ScenegraphLayer: mesh.ScenegraphLayerSchema
};
const layerVariants = Object.values(DeckGLLayerSchemas);
export const DeckGLLayerSchema = z.discriminatedUnion('@@type', [
  layerVariants[0],
  ...layerVariants.slice(1)
]);
export type DeckGLLayerName = keyof typeof DeckGLLayerSchemas;
export type DeckGLLayer = z.infer<typeof DeckGLLayerSchema>;
/**
 * Creates an immutable document schema including application-owned layer/view schemas.
 * @param layerSchema - Accepted layer configurations.
 * @param viewSchema - Accepted view constructors.
 * @param stateSchema - Accepted camera states; defaults to the built-in state union.
 * Supply a union with DeckGLViewStateSchema to retain built-in states alongside custom states.
 */
export function createDeckGLDocumentSchema<
  L extends z.ZodType,
  V extends z.ZodType,
  S extends z.ZodType
>(layerSchema: L, viewSchema: V, stateSchema: S): ReturnType<typeof createDocumentSchema<L, V, S>>;
export function createDeckGLDocumentSchema<L extends z.ZodType, V extends z.ZodType>(
  layerSchema: L,
  viewSchema: V
): ReturnType<typeof createDocumentSchema<L, V, typeof DeckGLViewStateSchema>>;
export function createDeckGLDocumentSchema(
  layerSchema: z.ZodType,
  viewSchema: z.ZodType,
  stateSchema: z.ZodType = DeckGLViewStateSchema
) {
  return createDocumentSchema(layerSchema, viewSchema, stateSchema);
}

function createDocumentSchema<L extends z.ZodType, V extends z.ZodType, S extends z.ZodType>(
  layerSchema: L,
  viewSchema: V,
  stateSchema: S
) {
  const documentState = z.union([stateSchema, z.record(z.string(), stateSchema)]);
  return z.strictObject({
    layers: z.array(layerSchema).optional(),
    views: z.union([viewSchema, z.array(viewSchema)]).optional(),
    initialViewState: documentState.optional(),
    viewState: documentState.nullable().optional(),
    controller: ControllerSchema.optional(),
    effects: z.array(z.union([ClassSchema, ConstantSchema])).optional(),
    parameters: ParametersSchema.optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    useDevicePixels: z.union([z.boolean(), z.number()]).optional(),
    pickingRadius: z.number().nonnegative().optional(),
    onViewStateChange: FunctionSchema.optional(),
    onHover: FunctionSchema.optional(),
    onClick: FunctionSchema.optional(),
    mapStyle: JsonValueSchema.optional()
  });
}
/** JSON-safe configuration, not a validator for live Layer instances or every Deck constructor option. */
export const DeckGLDocumentSchema = createDeckGLDocumentSchema(DeckGLLayerSchema, DeckGLViewSchema);
export type DeckGLDocument = z.infer<typeof DeckGLDocumentSchema>;

/** Builds the standalone editor artifact from the same schemas used for runtime validation. */
export function createDeckGLJSONSchema() {
  const schema = z.toJSONSchema(DeckGLDocumentSchema, {
    target: 'draft-2020-12',
    reused: 'ref',
    // Zod 4.1 uses metadata IDs for $defs names but also emits legacy `id` keywords.
    // Keep the names and remove those keywords for standards-compliant draft 2020-12 validators.
    override: ({jsonSchema, zodSchema}) => {
      delete jsonSchema.id;
      // Zod 4.1 emits prefixItems without tuple length constraints for draft 2020-12.
      // All tuples in this catalog are fixed-length; preserve that validation in the artifact.
      if (zodSchema instanceof z.ZodTuple && !zodSchema.def.rest) {
        jsonSchema.minItems = zodSchema.def.items.length;
        jsonSchema.maxItems = zodSchema.def.items.length;
        jsonSchema.items = false;
      }
    }
  });
  return {
    ...schema,
    $id: 'urn:deck-gl-community:playground:deckgl-schema',
    title: 'deck.gl JSON configuration'
  };
}
