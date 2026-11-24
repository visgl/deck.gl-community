// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {FeatureCollectionSchema} from '../geojson/index';
import {
  CallbackSchema,
  ColorAccessorSchema,
  CompositeLayerPropsSchema,
  ConstantSchema,
  DataSchema,
  FunctionSchema,
  JsonObjectSchema,
  NumberAccessorSchema,
  UnitSchema,
  Vector2Schema,
  createAccessorSchema,
  defineLayer
} from './common';
import {
  GeoJsonLayerPropsSchema,
  IconMappingSchema,
  LineLayerPropsSchema,
  ScatterplotLayerPropsSchema
} from './layers';

const number = NumberAccessorSchema.optional();

const nonnegative = z.number().nonnegative().optional();
const indexes = z.array(z.number().int().nonnegative()).optional();
const editingStyleProps = GeoJsonLayerPropsSchema.pick({
  filled: true,
  stroked: true,
  lineWidthScale: true,
  lineWidthMinPixels: true,
  lineWidthMaxPixels: true,
  lineWidthUnits: true,
  lineJointRounded: true,
  lineCapRounded: true,
  lineMiterLimit: true,
  pointRadiusScale: true,
  pointRadiusMinPixels: true,
  pointRadiusMaxPixels: true,
  getLineColor: true,
  getFillColor: true,
  getRadius: true,
  getLineWidth: true
}).extend({
  getTentativeLineColor: ColorAccessorSchema.optional(),
  getTentativeFillColor: ColorAccessorSchema.optional(),
  getTentativeLineWidth: number
});
const mode = z
  .union([
    ConstantSchema,
    z.enum([
      'view',
      'modify',
      'translate',
      'transform',
      'scale',
      'rotate',
      'duplicate',
      'split',
      'extrude',
      'elevation',
      'delete',
      'drawPoint',
      'drawLineString',
      'drawPolygon',
      'drawRectangle',
      'drawSquare',
      'drawRectangleFromCenter',
      'drawSquareFromCenter',
      'drawCircleFromCenter',
      'drawCircleByBoundingBox',
      'drawEllipseByBoundingBox',
      'drawRectangleUsing3Points',
      'drawEllipseUsing3Points',
      'draw90DegreePolygon',
      'drawPolygonByDragging'
    ])
  ])
  .describe('Registered edit-mode constructor or instance; legacy mode names are also accepted.');

/** Editable GeoJSON props; mode configuration belongs to the selected edit-mode implementation. */
export const EditableGeoJsonLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...editingStyleProps.shape,
  data: z.union([z.string(), FeatureCollectionSchema]),
  mode: mode.optional(),
  modeConfig: JsonObjectSchema.optional(),
  selectedFeatureIndexes: indexes,
  onEdit: CallbackSchema,
  onCancelPan: CallbackSchema,
  pickingRadius: nonnegative,
  pickingDepth: z.number().int().nonnegative().optional(),
  pickingLineWidthExtraPixels: nonnegative,
  fp64: z.boolean().optional(),
  editHandleType: z.enum(['point', 'icon']).optional(),
  editHandlePointRadiusScale: nonnegative,
  editHandlePointOutline: z.boolean().optional(),
  editHandlePointStrokeWidth: nonnegative,
  editHandlePointRadiusUnits: UnitSchema.optional(),
  editHandlePointRadiusMinPixels: nonnegative,
  editHandlePointRadiusMaxPixels: nonnegative,
  getEditHandlePointColor: ColorAccessorSchema.optional(),
  getEditHandlePointOutlineColor: ColorAccessorSchema.optional(),
  getEditHandlePointRadius: number,
  editHandleIconAtlas: z.string().nullable().optional(),
  editHandleIconMapping: IconMappingSchema.nullable().optional(),
  editHandleIconSizeScale: nonnegative,
  editHandleIconSizeUnits: UnitSchema.optional(),
  getEditHandleIcon: createAccessorSchema(z.string()).optional(),
  getEditHandleIconSize: number,
  getEditHandleIconColor: ColorAccessorSchema.optional(),
  getEditHandleIconAngle: number,
  billboard: z.boolean().optional()
});
/** Editable H3 cluster props; cell selection indexes refer to the input row array. */
export const EditableH3ClusterLayerPropsSchema = EditableGeoJsonLayerPropsSchema.extend({
  data: DataSchema.optional(),
  resolution: z.number().int().min(0).max(15).optional(),
  selectedIndexes: indexes,
  getEditedCluster: FunctionSchema.optional(),
  getHexagons: FunctionSchema.optional()
});
/** Selection overlay props, including the styling forwarded to its editable geometry. */
export const SelectionLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...editingStyleProps.shape,
  layerIds: z.array(z.string()).optional(),
  onSelect: CallbackSchema,
  selectionType: z.enum(['rectangle', 'polygon']).nullable().optional(),
  lineDashJustified: z.boolean().optional(),
  getLineDashArray: createAccessorSchema(Vector2Schema).optional(),
  getTentativeLineDashArray: createAccessorSchema(Vector2Schema).optional()
});
/** Elevated edit handles share Scatterplot and Line style props. */
export const ElevatedEditHandleLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...LineLayerPropsSchema.shape,
  ...ScatterplotLayerPropsSchema.shape
});
/** Junction markers extend Scatterplot styling with an inner circle and stroke accessor. */
export const JunctionScatterplotLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...ScatterplotLayerPropsSchema.shape,
  getStrokeColor: ColorAccessorSchema.optional(),
  getInnerRadius: number
});

/** JSON representation of EditableGeoJsonLayer. */
export const EditableGeoJsonLayerSchema = defineLayer(
  'EditableGeoJsonLayer',
  EditableGeoJsonLayerPropsSchema
);
/** JSON representation of EditableH3ClusterLayer. */
export const EditableH3ClusterLayerSchema = defineLayer(
  'EditableH3ClusterLayer',
  EditableH3ClusterLayerPropsSchema
);
/** JSON representation of SelectionLayer. */
export const SelectionLayerSchema = defineLayer('SelectionLayer', SelectionLayerPropsSchema);
/** JSON representation of ElevatedEditHandleLayer. */
export const ElevatedEditHandleLayerSchema = defineLayer(
  'ElevatedEditHandleLayer',
  ElevatedEditHandleLayerPropsSchema
);
/** JSON representation of JunctionScatterplotLayer. */
export const JunctionScatterplotLayerSchema = defineLayer(
  'JunctionScatterplotLayer',
  JunctionScatterplotLayerPropsSchema
);

/** Public editable layer schemas, keyed by their package export names. */
export const CommunityDataLayerSchemas = {
  EditableGeoJsonLayer: EditableGeoJsonLayerSchema,
  EditableH3ClusterLayer: EditableH3ClusterLayerSchema,
  SelectionLayer: SelectionLayerSchema,
  ElevatedEditHandleLayer: ElevatedEditHandleLayerSchema,
  JunctionScatterplotLayer: JunctionScatterplotLayerSchema
} as const;
