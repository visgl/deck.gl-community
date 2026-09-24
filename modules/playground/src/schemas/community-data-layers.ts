// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {FeatureCollectionSchema} from '../geojson/index';
import {
  CallbackSchema,
  ColorAccessorSchema,
  ColorSchema,
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
  ArcLayerPropsSchema,
  ColumnLayerPropsSchema,
  GeoJsonLayerPropsSchema,
  IconMappingSchema,
  LineLayerPropsSchema,
  PathLayerPropsSchema,
  PointCloudLayerPropsSchema,
  PolygonLayerPropsSchema,
  ScatterplotLayerPropsSchema,
  SolidPolygonLayerPropsSchema,
  TextLayerPropsSchema
} from './layers';
import {HeatmapLayerPropsSchema} from './aggregation-layers';
import {H3HexagonLayerPropsSchema, TripsLayerPropsSchema} from './geo-layers';

const arrowProps = {
  data: ConstantSchema.describe(
    'Host-owned Arrow Table. JSON/Arrow row imports are row arrays, not native GeoArrow tables.'
  ),
  _validate: z.boolean().optional(),
  _subLayerProps: CompositeLayerPropsSchema.shape._subLayerProps
};
const geometry = ConstantSchema.describe('Host-owned Arrow geometry Vector.');
const color = createAccessorSchema(z.union([ColorSchema, z.array(ColorSchema)])).optional();
const number = NumberAccessorSchema.optional();

/** Native GeoArrow Arc props; source and target Vectors must be registered constants. */
export const GeoArrowArcLayerPropsSchema = ArcLayerPropsSchema.extend({
  ...arrowProps,
  getSourcePosition: geometry,
  getTargetPosition: geometry,
  getSourceColor: color,
  getTargetColor: color
});
/** Native GeoArrow Column props; geometry may be inferred from Table metadata. */
export const GeoArrowColumnLayerPropsSchema = ColumnLayerPropsSchema.extend({
  ...arrowProps,
  getPosition: geometry.optional(),
  getFillColor: color,
  getLineColor: color
});
/** Native GeoArrow H3 props; cell IDs are supplied by a registered Arrow Vector. */
export const GeoArrowH3HexagonLayerPropsSchema = H3HexagonLayerPropsSchema.extend({
  ...arrowProps,
  getHexagon: ConstantSchema
});
/** Native GeoArrow Heatmap props; geometry may be inferred from Table metadata. */
export const GeoArrowHeatmapLayerPropsSchema = HeatmapLayerPropsSchema.extend({
  ...arrowProps,
  getPosition: geometry.optional()
});
/** Native GeoArrow Path props; geometry may be inferred from Table metadata. */
export const GeoArrowPathLayerPropsSchema = PathLayerPropsSchema.extend({
  ...arrowProps,
  getPath: geometry.optional(),
  getColor: color,
  getWidth: number
});
/** Native GeoArrow PointCloud props; geometry must contain three-dimensional points. */
export const GeoArrowPointCloudLayerPropsSchema = PointCloudLayerPropsSchema.extend({
  ...arrowProps,
  getPosition: geometry.optional(),
  getColor: color
});
/** Native GeoArrow Polygon props; geometry may be inferred from Table metadata. */
export const GeoArrowPolygonLayerPropsSchema = PolygonLayerPropsSchema.extend({
  ...arrowProps,
  getPolygon: geometry.optional(),
  getFillColor: color,
  getLineColor: color
});
/** Native GeoArrow Scatterplot props; geometry may be inferred from Table metadata. */
export const GeoArrowScatterplotLayerPropsSchema = ScatterplotLayerPropsSchema.extend({
  ...arrowProps,
  getPosition: geometry.optional(),
  getFillColor: color,
  getLineColor: color
});
/** Native GeoArrow SolidPolygon props, including optional triangulation worker settings. */
export const GeoArrowSolidPolygonLayerPropsSchema = SolidPolygonLayerPropsSchema.extend({
  ...arrowProps,
  getPolygon: geometry.optional(),
  getFillColor: color,
  getLineColor: color,
  earcutWorkerUrl: z.string().nullable().optional(),
  earcutWorkerPoolSize: z.number().int().positive().optional()
});
/** Native GeoArrow Text props; text requires an Arrow Vector and backgrounds are unsupported. */
export const GeoArrowTextLayerPropsSchema = TextLayerPropsSchema.omit({background: true}).extend({
  ...arrowProps,
  getPosition: geometry.optional(),
  getText: ConstantSchema,
  getColor: color,
  getBackgroundColor: color,
  getBorderColor: color,
  getTextAnchor: z.union([z.enum(['start', 'middle', 'end']), ConstantSchema]).optional(),
  getAlignmentBaseline: z.union([z.enum(['top', 'center', 'bottom']), ConstantSchema]).optional(),
  getPixelOffset: z.union([Vector2Schema, ConstantSchema]).optional()
});
/** Native GeoArrow Trips props; timestamps require a registered Arrow List Vector. */
export const GeoArrowTripsLayerPropsSchema = TripsLayerPropsSchema.extend({
  ...arrowProps,
  getPath: geometry.optional(),
  getTimestamps: ConstantSchema,
  getColor: color,
  getWidth: number
});

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

/** JSON representation of GeoArrowArcLayer. */
export const GeoArrowArcLayerSchema = defineLayer('GeoArrowArcLayer', GeoArrowArcLayerPropsSchema);
/** JSON representation of GeoArrowColumnLayer. */
export const GeoArrowColumnLayerSchema = defineLayer(
  'GeoArrowColumnLayer',
  GeoArrowColumnLayerPropsSchema
);
/** JSON representation of the experimental GeoArrowH3HexagonLayer export. */
export const GeoArrowH3HexagonLayerSchema = defineLayer(
  '_GeoArrowH3HexagonLayer',
  GeoArrowH3HexagonLayerPropsSchema
);
/** JSON representation of GeoArrowHeatmapLayer. */
export const GeoArrowHeatmapLayerSchema = defineLayer(
  'GeoArrowHeatmapLayer',
  GeoArrowHeatmapLayerPropsSchema
);
/** JSON representation of GeoArrowPathLayer. */
export const GeoArrowPathLayerSchema = defineLayer(
  'GeoArrowPathLayer',
  GeoArrowPathLayerPropsSchema
);
/** JSON representation of GeoArrowPointCloudLayer. */
export const GeoArrowPointCloudLayerSchema = defineLayer(
  'GeoArrowPointCloudLayer',
  GeoArrowPointCloudLayerPropsSchema
);
/** JSON representation of GeoArrowPolygonLayer. */
export const GeoArrowPolygonLayerSchema = defineLayer(
  'GeoArrowPolygonLayer',
  GeoArrowPolygonLayerPropsSchema
);
/** JSON representation of GeoArrowScatterplotLayer. */
export const GeoArrowScatterplotLayerSchema = defineLayer(
  'GeoArrowScatterplotLayer',
  GeoArrowScatterplotLayerPropsSchema
);
/** JSON representation of GeoArrowSolidPolygonLayer. */
export const GeoArrowSolidPolygonLayerSchema = defineLayer(
  'GeoArrowSolidPolygonLayer',
  GeoArrowSolidPolygonLayerPropsSchema
);
/** JSON representation of the experimental GeoArrowTextLayer export. */
export const GeoArrowTextLayerSchema = defineLayer(
  '_GeoArrowTextLayer',
  GeoArrowTextLayerPropsSchema
);
/** JSON representation of GeoArrowTripsLayer. */
export const GeoArrowTripsLayerSchema = defineLayer(
  'GeoArrowTripsLayer',
  GeoArrowTripsLayerPropsSchema
);
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

/** Public Arrow and editable layer schemas, keyed by their package export names. */
export const CommunityDataLayerSchemas = {
  GeoArrowArcLayer: GeoArrowArcLayerSchema,
  GeoArrowColumnLayer: GeoArrowColumnLayerSchema,
  _GeoArrowH3HexagonLayer: GeoArrowH3HexagonLayerSchema,
  GeoArrowHeatmapLayer: GeoArrowHeatmapLayerSchema,
  GeoArrowPathLayer: GeoArrowPathLayerSchema,
  GeoArrowPointCloudLayer: GeoArrowPointCloudLayerSchema,
  GeoArrowPolygonLayer: GeoArrowPolygonLayerSchema,
  GeoArrowScatterplotLayer: GeoArrowScatterplotLayerSchema,
  GeoArrowSolidPolygonLayer: GeoArrowSolidPolygonLayerSchema,
  _GeoArrowTextLayer: GeoArrowTextLayerSchema,
  GeoArrowTripsLayer: GeoArrowTripsLayerSchema,
  EditableGeoJsonLayer: EditableGeoJsonLayerSchema,
  EditableH3ClusterLayer: EditableH3ClusterLayerSchema,
  SelectionLayer: SelectionLayerSchema,
  ElevatedEditHandleLayer: ElevatedEditHandleLayerSchema,
  JunctionScatterplotLayer: JunctionScatterplotLayerSchema
} as const;
