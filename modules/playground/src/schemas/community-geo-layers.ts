// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {
  CallbackSchema,
  ColorSchema,
  CompositeLayerPropsSchema,
  ConstantSchema,
  FunctionSchema,
  JsonObjectSchema,
  JsonValueSchema,
  StringAccessorSchema,
  Vector2Schema,
  Vector4Schema,
  defineLayer
} from './common';
import {Tile3DLayerPropsSchema, TileLayerPropsSchema, URLTemplateSchema} from './geo-layers';
import {PolygonLayerPropsSchema} from './layers';

/** TileSource instances are supplied by the host, not constructed from editable JSON. */
export const TileSourceLayerPropsSchema = TileLayerPropsSchema.extend({
  tileSource: ConstantSchema,
  showTileBorders: z.boolean().optional()
});

/** Shared tilesets and TileSource instances use host constants; URL templates remain editable. */
export const SharedTile2DLayerPropsSchema = TileLayerPropsSchema.omit({
  visibleMinZoom: true,
  visibleMaxZoom: true
}).extend({data: URLTemplateSchema.nullable().optional()});

/** JSON props for a tile-header overlay; the tile header is a host-owned instance. */
export const TileGridLayerPropsSchema = CompositeLayerPropsSchema.extend({
  tile: ConstantSchema,
  showBorder: z.boolean().optional(),
  showLabel: z.boolean().optional(),
  getLabel: StringAccessorSchema.optional(),
  borderColor: ColorSchema.optional(),
  labelColor: ColorSchema.optional(),
  labelBackgroundColor: ColorSchema.optional(),
  borderWidthMinPixels: z.number().nonnegative().optional(),
  labelSize: z.number().nonnegative().optional()
});

const WindFieldPropsSchema = CompositeLayerPropsSchema.extend({
  windField: ConstantSchema.describe('A host-owned WindField prepared by createWindField.'),
  elevationScale: z.number().optional()
});
const WindColorPropsSchema = WindFieldPropsSchema.extend({
  lowColor: ColorSchema.optional(),
  highColor: ColorSchema.optional()
});

/** JSON props for station-triangulated terrain using a prepared WindField. */
export const DelaunayCoverLayerPropsSchema = WindColorPropsSchema;

/** JSON props for grayscale image terrain. */
export const ElevationLayerPropsSchema = CompositeLayerPropsSchema.extend({
  elevationData: z.string(),
  bounds: Vector4Schema,
  elevationRange: Vector2Schema.optional(),
  elevationScale: z.number().optional(),
  meshMaxError: z.number().nonnegative().optional(),
  color: ColorSchema.optional(),
  texture: z.string().optional()
});

/** JSON props for GPU wind particles using a prepared WindField. */
export const ParticleLayerPropsSchema = WindFieldPropsSchema.extend({
  time: z.number().optional(),
  numParticles: z.number().int().nonnegative().optional(),
  trailLength: z.number().int().nonnegative().optional(),
  speedScale: z.number().optional(),
  widthMinPixels: z.number().nonnegative().optional(),
  color: ColorSchema.optional(),
  surfaceOffset: z.number().optional(),
  pointRadiusPixels: z.number().nonnegative().optional()
});

/** JSON props for sampled wind arrows using a prepared WindField. */
export const WindLayerPropsSchema = WindColorPropsSchema.extend({
  time: z.number().optional(),
  gridWidth: z.number().int().nonnegative().optional(),
  gridHeight: z.number().int().nonnegative().optional(),
  speedScale: z.number().optional(),
  widthMinPixels: z.number().nonnegative().optional(),
  surfaceOffset: z.number().optional()
});

/** JSON props for a host-registered discrete global grid adapter. */
export const GlobalGridLayerPropsSchema = PolygonLayerPropsSchema.extend({
  globalGrid: ConstantSchema,
  getCellId: FunctionSchema.optional()
});

// Mirror the basemap loader's structural contract without duplicating the external style grammar.
// Extra style-spec fields remain JSON data; the layer's own props remain strict.
const BasemapSourceSchema = z
  .object({
    type: z.string().optional(),
    url: z.string().optional(),
    tiles: z.array(z.string()).optional(),
    minzoom: z.number().optional(),
    maxzoom: z.number().optional(),
    tileSize: z.number().optional()
  })
  .catchall(JsonValueSchema);
const BasemapStyleLayerSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    ref: z.string().optional(),
    source: z.string().optional(),
    'source-layer': z.string().optional(),
    minzoom: z.number().optional(),
    maxzoom: z.number().optional(),
    filter: z.array(JsonValueSchema).optional(),
    paint: JsonObjectSchema.optional(),
    layout: JsonObjectSchema.optional()
  })
  .catchall(JsonValueSchema);
const BasemapStyleSchema = z
  .object({
    version: z.number().optional(),
    metadata: JsonObjectSchema.optional(),
    sources: z.record(z.string(), BasemapSourceSchema).optional(),
    layers: z
      .array(
        z.union([
          BasemapStyleLayerSchema.extend({type: z.string()}),
          BasemapStyleLayerSchema.extend({ref: z.string()})
        ])
      )
      .optional()
  })
  .catchall(JsonValueSchema);

/** JSON props for a style document or URL; style expressions are checked by the basemap loader. */
export const BasemapLayerPropsSchema = CompositeLayerPropsSchema.extend({
  style: z.union([z.string(), BasemapStyleSchema]).nullable().meta({'x-playground-literal': true}),
  loadOptions: JsonObjectSchema.nullable().optional(),
  mode: z.enum(['map', 'globe']).optional(),
  globe: z
    .strictObject({
      config: z
        .strictObject({
          atmosphere: z.boolean().optional(),
          basemap: z.boolean().optional(),
          labels: z.boolean().optional()
        })
        .optional()
    })
    .optional()
});

/** JSON props for attribute-driven 3D tile coloring and filtering. */
export const DataDrivenTile3DLayerPropsSchema = Tile3DLayerPropsSchema.extend({
  onTraversalComplete: CallbackSchema,
  customizeColors: CallbackSchema,
  filterTile: CallbackSchema,
  colorsByAttribute: z
    .strictObject({
      attributeName: z.string(),
      minValue: z.number(),
      maxValue: z.number(),
      minColor: ColorSchema.options[1],
      maxColor: ColorSchema.options[1],
      mode: z.enum(['replace', 'multiply'])
    })
    .nullable()
    .optional(),
  filtersByAttribute: z
    .strictObject({attributeName: z.string(), value: z.number()})
    .nullable()
    .optional()
});

/** JSON props for procedural trees; accessors must be functions because TreeLayer calls them. */
export const TreeLayerPropsSchema = CompositeLayerPropsSchema.extend({
  getPosition: FunctionSchema.optional(),
  getElevation: FunctionSchema.optional(),
  getTreeType: FunctionSchema.optional(),
  getHeight: FunctionSchema.optional(),
  getTrunkHeightFraction: FunctionSchema.optional(),
  getTrunkRadius: FunctionSchema.optional(),
  getCanopyRadius: FunctionSchema.optional(),
  getTrunkColor: FunctionSchema.optional(),
  getCanopyColor: FunctionSchema.optional(),
  getSeason: FunctionSchema.optional(),
  getBranchLevels: FunctionSchema.optional(),
  getCrop: FunctionSchema.optional(),
  sizeScale: z.number().nonnegative().optional()
});

/** JSON representation of TileSourceLayer. */
export const TileSourceLayerSchema = defineLayer('TileSourceLayer', TileSourceLayerPropsSchema);
/** JSON representation of SharedTile2DLayer. */
export const SharedTile2DLayerSchema = defineLayer(
  'SharedTile2DLayer',
  SharedTile2DLayerPropsSchema
);
/** JSON representation of TileGridLayer. */
export const TileGridLayerSchema = defineLayer('TileGridLayer', TileGridLayerPropsSchema);
/** JSON representation of DelaunayCoverLayer. */
export const DelaunayCoverLayerSchema = defineLayer(
  'DelaunayCoverLayer',
  DelaunayCoverLayerPropsSchema
);
/** JSON representation of ElevationLayer. */
export const ElevationLayerSchema = defineLayer('ElevationLayer', ElevationLayerPropsSchema);
/** JSON representation of ParticleLayer. */
export const ParticleLayerSchema = defineLayer('ParticleLayer', ParticleLayerPropsSchema);
/** JSON representation of WindLayer. */
export const WindLayerSchema = defineLayer('WindLayer', WindLayerPropsSchema);
/** JSON representation of GlobalGridLayer. */
export const GlobalGridLayerSchema = defineLayer('GlobalGridLayer', GlobalGridLayerPropsSchema);
/** JSON representation of BasemapLayer. */
export const BasemapLayerSchema = defineLayer('BasemapLayer', BasemapLayerPropsSchema);
/** JSON representation of DataDrivenTile3DLayer. */
export const DataDrivenTile3DLayerSchema = defineLayer(
  'DataDrivenTile3DLayer',
  DataDrivenTile3DLayerPropsSchema
);
/** JSON representation of TreeLayer. */
export const TreeLayerSchema = defineLayer('TreeLayer', TreeLayerPropsSchema);

/** Schemas for public geo, basemap, experimental and procedural-tree layer constructors. */
export const CommunityGeoLayerSchemas = {
  TileSourceLayer: TileSourceLayerSchema,
  SharedTile2DLayer: SharedTile2DLayerSchema,
  TileGridLayer: TileGridLayerSchema,
  DelaunayCoverLayer: DelaunayCoverLayerSchema,
  ElevationLayer: ElevationLayerSchema,
  ParticleLayer: ParticleLayerSchema,
  WindLayer: WindLayerSchema,
  GlobalGridLayer: GlobalGridLayerSchema,
  BasemapLayer: BasemapLayerSchema,
  DataDrivenTile3DLayer: DataDrivenTile3DLayerSchema,
  TreeLayer: TreeLayerSchema
};
