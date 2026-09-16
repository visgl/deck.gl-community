// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {GeoJSONSchema, FeatureSchema} from '../geojson/index';
import {
  BaseLayerPropsSchema,
  CompositeLayerPropsSchema,
  CallbackSchema,
  ColorSchema,
  ColorAccessorSchema as color,
  NumberAccessorSchema as number,
  PositionAccessorSchema as position,
  Vector2AccessorSchema as offset,
  StringAccessorSchema as string,
  FunctionSchema,
  Vector2Schema,
  Vector3Schema,
  Vector4Schema,
  DeckGLPositionSchema,
  UnitSchema,
  MaterialSchema,
  SamplerSchema,
  ResourceSchema,
  CoordinateSystemSchema,
  createAccessorSchema,
  defineLayer
} from './common';

const nonnegative = z.number().nonnegative();
const widthProps = {
  widthUnits: UnitSchema.optional(),
  widthScale: nonnegative.optional(),
  widthMinPixels: nonnegative.optional(),
  widthMaxPixels: nonnegative.optional()
};
const lineWidthProps = {
  lineWidthUnits: UnitSchema.optional(),
  lineWidthScale: nonnegative.optional(),
  lineWidthMinPixels: nonnegative.optional(),
  lineWidthMaxPixels: nonnegative.optional()
};
const sizeProps = {
  sizeUnits: UnitSchema.optional(),
  sizeScale: nonnegative.optional(),
  sizeMinPixels: nonnegative.optional(),
  sizeMaxPixels: nonnegative.optional(),
  billboard: z.boolean().optional()
};
const path = z.union([z.array(DeckGLPositionSchema), z.array(z.number())]);
/** Nested rings, flat positions, or flat coordinates with hole offsets. */
export const PolygonGeometrySchema = z.union([
  path,
  z.array(z.array(DeckGLPositionSchema)),
  z.strictObject({
    positions: z.array(z.number()),
    holeIndices: z.array(z.number().int().nonnegative()).optional()
  })
]);
/** JSON-safe props for LineLayer; compose or extend with Zod. */
export const LineLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...widthProps,
  antialiasing: z.boolean().optional(),
  getSourcePosition: position.optional(),
  getTargetPosition: position.optional(),
  getColor: color.optional(),
  getWidth: number.optional()
});
/** JSON-safe props for ArcLayer; compose or extend with Zod. */
export const ArcLayerPropsSchema = LineLayerPropsSchema.omit({getColor: true}).extend({
  greatCircle: z.boolean().optional(),
  numSegments: z.number().int().min(1).optional(),
  getSourceColor: color.optional(),
  getTargetColor: color.optional(),
  getHeight: number.optional(),
  getTilt: number.optional()
});
/** JSON-safe props for ScatterplotLayer; compose or extend with Zod. */
export const ScatterplotLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...lineWidthProps,
  radiusUnits: UnitSchema.optional(),
  radiusScale: nonnegative.optional(),
  radiusMinPixels: nonnegative.optional(),
  radiusMaxPixels: nonnegative.optional(),
  stroked: z.boolean().optional(),
  filled: z.boolean().optional(),
  billboard: z.boolean().optional(),
  antialiasing: z.boolean().optional(),
  getPosition: position.optional(),
  getRadius: number.optional(),
  getFillColor: color.optional(),
  getLineColor: color.optional(),
  getLineWidth: number.optional(),
  getPixelOffset: offset.optional(),
  strokeWidth: z.number().optional(),
  outline: z.boolean().optional(),
  getColor: color.optional()
});
/** JSON-safe props for ColumnLayer; compose or extend with Zod. */
export const ColumnLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...lineWidthProps,
  diskResolution: z.number().int().min(4).optional(),
  radius: nonnegative.optional(),
  angle: z.number().optional(),
  vertices: z.array(DeckGLPositionSchema).nullable().optional(),
  offset: Vector2Schema.optional(),
  coverage: z.number().min(0).max(1).optional(),
  elevationScale: nonnegative.optional(),
  filled: z.boolean().optional(),
  stroked: z.boolean().optional(),
  extruded: z.boolean().optional(),
  wireframe: z.boolean().optional(),
  flatShading: z.boolean().optional(),
  radiusUnits: UnitSchema.optional(),
  material: MaterialSchema.optional(),
  getPosition: position.optional(),
  getColor: color.optional(),
  getFillColor: color.optional(),
  getLineColor: color.optional(),
  getElevation: number.optional(),
  getLineWidth: number.optional()
});
/** JSON-safe props for GridCellLayer; compose or extend with Zod. */
export const GridCellLayerPropsSchema = ColumnLayerPropsSchema.extend({
  cellSize: nonnegative.optional()
});
/** JSON-safe props for PathLayer; compose or extend with Zod. */
export const PathLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...widthProps,
  jointRounded: z.boolean().optional(),
  capRounded: z.boolean().optional(),
  miterLimit: nonnegative.optional(),
  antialiasing: z.boolean().optional(),
  billboard: z.boolean().optional(),
  _pathType: z.enum(['loop', 'open']).nullable().optional(),
  getPath: createAccessorSchema(path).optional(),
  getColor: createAccessorSchema(z.union([ColorSchema, z.array(ColorSchema)])).optional(),
  getWidth: createAccessorSchema(z.union([z.number(), z.array(z.number())])).optional(),
  rounded: z.boolean().optional()
});
/** JSON-safe props for SolidPolygonLayer; compose or extend with Zod. */
export const SolidPolygonLayerPropsSchema = BaseLayerPropsSchema.extend({
  filled: z.boolean().optional(),
  extruded: z.boolean().optional(),
  wireframe: z.boolean().optional(),
  _normalize: z.boolean().optional(),
  _windingOrder: z.enum(['CW', 'CCW']).optional(),
  _full3d: z.boolean().optional(),
  elevationScale: nonnegative.optional(),
  getPolygon: createAccessorSchema(PolygonGeometrySchema).optional(),
  getElevation: number.optional(),
  getFillColor: color.optional(),
  getLineColor: color.optional(),
  material: MaterialSchema.optional()
});
/** JSON-safe props for PolygonLayer; compose or extend with Zod. */
export const PolygonLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...SolidPolygonLayerPropsSchema.omit({_full3d: true}).shape,
  ...lineWidthProps,
  stroked: z.boolean().optional(),
  lineJointRounded: z.boolean().optional(),
  lineMiterLimit: nonnegative.optional(),
  lineAntialiasing: z.boolean().optional(),
  lineDashJustified: z.boolean().optional(),
  getLineWidth: number.optional(),
  getLineDashArray: number.nullable().optional()
});
/** JSON-safe props for PointCloudLayer; compose or extend with Zod. */
export const PointCloudLayerPropsSchema = BaseLayerPropsSchema.extend({
  sizeUnits: UnitSchema.optional(),
  pointSize: nonnegative.optional(),
  antialiasing: z.boolean().optional(),
  radiusPixels: z.number().optional(),
  material: MaterialSchema.optional(),
  getPosition: position.optional(),
  getNormal: createAccessorSchema(Vector3Schema).optional(),
  getColor: color.optional()
});
/** JSON-safe props for BitmapLayer; compose or extend with Zod. */
export const BitmapLayerPropsSchema = BaseLayerPropsSchema.omit({data: true}).extend({
  image: ResourceSchema.nullable().optional(),
  bounds: z
    .union([
      Vector4Schema,
      z.tuple([
        DeckGLPositionSchema,
        DeckGLPositionSchema,
        DeckGLPositionSchema,
        DeckGLPositionSchema
      ])
    ])
    .optional(),
  _imageCoordinateSystem: CoordinateSystemSchema.optional(),
  desaturate: z.number().min(0).max(1).optional(),
  transparentColor: ColorSchema.optional(),
  tintColor: ColorSchema.optional(),
  textureParameters: SamplerSchema.nullable().optional()
});
export const IconMappingEntrySchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: nonnegative,
  height: nonnegative,
  anchorX: z.number().optional(),
  anchorY: z.number().optional(),
  mask: z.boolean().optional()
});
export const UnpackedIconSchema = IconMappingEntrySchema.omit({x: true, y: true}).extend({
  url: z.string(),
  id: z.string().optional()
});
export const IconMappingSchema = z.union([
  z.string(),
  z.record(z.string(), IconMappingEntrySchema)
]);
/** JSON-safe props for IconLayer; compose or extend with Zod. */
export const IconLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...sizeProps,
  iconAtlas: ResourceSchema.optional(),
  iconMapping: IconMappingSchema.optional(),
  sizeBasis: z.enum(['height', 'width']).optional(),
  alphaCutoff: z.number().min(0).max(1).optional(),
  getPosition: position.optional(),
  getIcon: createAccessorSchema(z.union([z.string(), UnpackedIconSchema])).optional(),
  getColor: color.optional(),
  getSize: number.optional(),
  getAngle: number.optional(),
  getPixelOffset: offset.optional(),
  onIconError: CallbackSchema,
  textureParameters: SamplerSchema.nullable().optional()
});
export const FontSettingsSchema = z.strictObject({
  fontFamily: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  characterSet: z.union([z.string(), z.array(z.string())]).optional(),
  fontSize: z.number().positive().optional(),
  buffer: nonnegative.optional(),
  sdf: z.boolean().optional(),
  radius: nonnegative.optional(),
  cutoff: z.number().optional(),
  smoothing: z.number().optional()
});
const contentProps = {
  getContentBox: createAccessorSchema(Vector4Schema).optional(),
  contentCutoffPixels: Vector2Schema.optional(),
  contentAlignHorizontal: z.enum(['none', 'start', 'center', 'end']).optional(),
  contentAlignVertical: z.enum(['none', 'start', 'center', 'end']).optional()
};
const padding = z.union([Vector2Schema, Vector4Schema]);
/** JSON-safe props for TextLayer; compose or extend with Zod. */
export const TextLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...sizeProps,
  ...contentProps,
  background: z.boolean().optional(),
  getBackgroundColor: color.optional(),
  getBorderColor: color.optional(),
  getBorderWidth: number.optional(),
  backgroundBorderRadius: z.union([z.number(), Vector4Schema]).optional(),
  backgroundPadding: padding.optional(),
  characterSet: z.union([z.string(), z.array(z.string())]).optional(),
  fontFamily: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  lineHeight: z.number().optional(),
  outlineWidth: nonnegative.optional(),
  outlineColor: ColorSchema.optional(),
  fontSettings: FontSettingsSchema.optional(),
  wordBreak: z.enum(['break-word', 'break-all']).optional(),
  maxWidth: z.number().optional(),
  getText: string.optional(),
  getPosition: position.optional(),
  getColor: color.optional(),
  getSize: number.optional(),
  getAngle: number.optional(),
  getTextAnchor: createAccessorSchema(z.enum(['start', 'middle', 'end'])).optional(),
  getAlignmentBaseline: createAccessorSchema(z.enum(['top', 'center', 'bottom'])).optional(),
  getPixelOffset: offset.optional(),
  backgroundColor: ColorSchema.optional(),
  _getFontRenderer: FunctionSchema.optional()
});
/** JSON-safe props for MultiIconLayer; compose or extend with Zod. */
export const MultiIconLayerPropsSchema = IconLayerPropsSchema.extend({
  ...contentProps,
  getIconOffsets: createAccessorSchema(z.array(z.number())).optional(),
  fontSize: z.number().optional(),
  sdf: z.boolean().optional(),
  smoothing: z.number().optional(),
  outlineWidth: nonnegative.optional(),
  outlineColor: ColorSchema.optional()
});
/** JSON-safe props for TextBackgroundLayer; compose or extend with Zod. */
export const TextBackgroundLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...sizeProps,
  fontSize: z.number().optional(),
  borderRadius: z.union([z.number(), Vector4Schema]).optional(),
  padding: padding.optional(),
  getPosition: position.optional(),
  getSize: number.optional(),
  getAngle: number.optional(),
  getPixelOffset: offset.optional(),
  getBoundingRect: createAccessorSchema(Vector4Schema).optional(),
  getClipRect: createAccessorSchema(Vector4Schema).optional(),
  getFillColor: color.optional(),
  getLineColor: color.optional(),
  getLineWidth: number.optional()
});
/** JSON-safe props for GeoJsonLayer; compose or extend with Zod. */
export const GeoJsonLayerPropsSchema = CompositeLayerPropsSchema.extend({
  data: z.union([z.string(), GeoJSONSchema, z.array(FeatureSchema)]).optional(),
  pointType: z
    .string()
    .regex(/^(circle|icon|text)(\+(circle|icon|text))*$/)
    .optional(),
  filled: z.boolean().optional(),
  stroked: z.boolean().optional(),
  extruded: z.boolean().optional(),
  wireframe: z.boolean().optional(),
  _full3d: z.boolean().optional(),
  getFillColor: color.optional(),
  getLineColor: color.optional(),
  getLineWidth: number.optional(),
  ...lineWidthProps,
  lineJointRounded: z.boolean().optional(),
  lineMiterLimit: nonnegative.optional(),
  lineCapRounded: z.boolean().optional(),
  lineAntialiasing: z.boolean().optional(),
  lineBillboard: z.boolean().optional(),
  getElevation: number.optional(),
  elevationScale: nonnegative.optional(),
  material: MaterialSchema.optional(),
  getPointRadius: number.optional(),
  getRadius: number.optional(),
  pointRadiusUnits: UnitSchema.optional(),
  pointRadiusScale: nonnegative.optional(),
  pointRadiusMinPixels: nonnegative.optional(),
  pointRadiusMaxPixels: nonnegative.optional(),
  pointAntialiasing: z.boolean().optional(),
  pointBillboard: z.boolean().optional(),
  iconAtlas: ResourceSchema.optional(),
  iconMapping: IconMappingSchema.optional(),
  getIcon: IconLayerPropsSchema.shape.getIcon,
  getIconSize: number.optional(),
  getIconColor: color.optional(),
  getIconAngle: number.optional(),
  getIconPixelOffset: offset.optional(),
  iconSizeUnits: UnitSchema.optional(),
  iconSizeScale: nonnegative.optional(),
  iconSizeMinPixels: nonnegative.optional(),
  iconSizeMaxPixels: nonnegative.optional(),
  iconBillboard: z.boolean().optional(),
  iconAlphaCutoff: z.number().min(0).max(1).optional(),
  getText: string.optional(),
  getTextColor: color.optional(),
  getTextAngle: number.optional(),
  getTextSize: number.optional(),
  getTextAnchor: TextLayerPropsSchema.shape.getTextAnchor,
  getTextAlignmentBaseline: TextLayerPropsSchema.shape.getAlignmentBaseline,
  getTextPixelOffset: offset.optional(),
  getTextBackgroundColor: color.optional(),
  getTextBorderColor: color.optional(),
  getTextBorderWidth: number.optional(),
  textSizeUnits: UnitSchema.optional(),
  textSizeScale: nonnegative.optional(),
  textSizeMinPixels: nonnegative.optional(),
  textSizeMaxPixels: nonnegative.optional(),
  textCharacterSet: TextLayerPropsSchema.shape.characterSet,
  textFontFamily: z.string().optional(),
  textFontWeight: TextLayerPropsSchema.shape.fontWeight,
  textLineHeight: z.number().optional(),
  textMaxWidth: z.number().optional(),
  textWordBreak: TextLayerPropsSchema.shape.wordBreak,
  textBackground: z.boolean().optional(),
  textBackgroundPadding: padding.optional(),
  textOutlineColor: ColorSchema.optional(),
  textOutlineWidth: nonnegative.optional(),
  textBillboard: z.boolean().optional(),
  textFontSettings: FontSettingsSchema.optional()
});

export const ArcLayerSchema = defineLayer('ArcLayer', ArcLayerPropsSchema);
export const BitmapLayerSchema = defineLayer('BitmapLayer', BitmapLayerPropsSchema);
export const IconLayerSchema = defineLayer('IconLayer', IconLayerPropsSchema);
export const LineLayerSchema = defineLayer('LineLayer', LineLayerPropsSchema);
export const PointCloudLayerSchema = defineLayer('PointCloudLayer', PointCloudLayerPropsSchema);
export const ScatterplotLayerSchema = defineLayer('ScatterplotLayer', ScatterplotLayerPropsSchema);
export const ColumnLayerSchema = defineLayer('ColumnLayer', ColumnLayerPropsSchema);
export const GridCellLayerSchema = defineLayer('GridCellLayer', GridCellLayerPropsSchema);
export const PathLayerSchema = defineLayer('PathLayer', PathLayerPropsSchema);
export const PolygonLayerSchema = defineLayer('PolygonLayer', PolygonLayerPropsSchema);
export const SolidPolygonLayerSchema = defineLayer(
  'SolidPolygonLayer',
  SolidPolygonLayerPropsSchema
);
export const GeoJsonLayerSchema = defineLayer('GeoJsonLayer', GeoJsonLayerPropsSchema);
export const TextLayerSchema = defineLayer('TextLayer', TextLayerPropsSchema);
export const MultiIconLayerSchema = defineLayer('_MultiIconLayer', MultiIconLayerPropsSchema);
export const TextBackgroundLayerSchema = defineLayer(
  '_TextBackgroundLayer',
  TextBackgroundLayerPropsSchema
);

/** Inferred JSON props for LineLayer. */
export type LineLayerProps = z.infer<typeof LineLayerPropsSchema>;
/** Inferred JSON props for ArcLayer. */
export type ArcLayerProps = z.infer<typeof ArcLayerPropsSchema>;
/** Inferred JSON props for ScatterplotLayer. */
export type ScatterplotLayerProps = z.infer<typeof ScatterplotLayerPropsSchema>;
/** Inferred JSON props for ColumnLayer. */
export type ColumnLayerProps = z.infer<typeof ColumnLayerPropsSchema>;
/** Inferred JSON props for GridCellLayer. */
export type GridCellLayerProps = z.infer<typeof GridCellLayerPropsSchema>;
/** Inferred JSON props for PathLayer. */
export type PathLayerProps = z.infer<typeof PathLayerPropsSchema>;
/** Inferred JSON props for SolidPolygonLayer. */
export type SolidPolygonLayerProps = z.infer<typeof SolidPolygonLayerPropsSchema>;
/** Inferred JSON props for PolygonLayer. */
export type PolygonLayerProps = z.infer<typeof PolygonLayerPropsSchema>;
/** Inferred JSON props for PointCloudLayer. */
export type PointCloudLayerProps = z.infer<typeof PointCloudLayerPropsSchema>;
/** Inferred JSON props for BitmapLayer. */
export type BitmapLayerProps = z.infer<typeof BitmapLayerPropsSchema>;
/** Inferred JSON props for IconLayer. */
export type IconLayerProps = z.infer<typeof IconLayerPropsSchema>;
/** Inferred JSON props for TextLayer. */
export type TextLayerProps = z.infer<typeof TextLayerPropsSchema>;
/** Inferred JSON props for MultiIconLayer. */
export type MultiIconLayerProps = z.infer<typeof MultiIconLayerPropsSchema>;
/** Inferred JSON props for TextBackgroundLayer. */
export type TextBackgroundLayerProps = z.infer<typeof TextBackgroundLayerPropsSchema>;
/** Inferred JSON props for GeoJsonLayer. */
export type GeoJsonLayerProps = z.infer<typeof GeoJsonLayerPropsSchema>;
