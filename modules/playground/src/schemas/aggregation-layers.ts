// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {
  CompositeLayerPropsSchema,
  Vector2Schema,
  ColorSchema,
  MaterialSchema,
  CallbackSchema,
  PositionAccessorSchema,
  NumberAccessorSchema,
  defineLayer
} from './common';

export const AggregationOperationSchema = z.enum(['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT']);
const percentile = z.number().min(0).max(100);
const weightProps = {
  getPosition: PositionAccessorSchema.optional(),
  getWeight: NumberAccessorSchema.optional()
};
const colorProps = {
  colorDomain: Vector2Schema.nullable().optional(),
  colorRange: z.array(ColorSchema).optional()
};
/** JSON-safe props for ScreenGridLayer; compose or extend with Zod. */
export const ScreenGridLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...weightProps,
  ...colorProps,
  cellSizePixels: z.number().min(1).optional(),
  cellMarginPixels: z.number().nonnegative().optional(),
  colorScaleType: z.enum(['linear', 'quantize']).optional(),
  gpuAggregation: z.boolean().optional(),
  aggregation: AggregationOperationSchema.optional()
});
/** JSON-safe props for HeatmapLayer; compose or extend with Zod. */
export const HeatmapLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...weightProps,
  ...colorProps,
  radiusPixels: z.number().min(1).max(100).optional(),
  intensity: z.number().nonnegative().optional(),
  threshold: z.number().min(0).max(1).optional(),
  aggregation: z.enum(['SUM', 'MEAN']).optional(),
  weightsTextureSize: z.number().int().min(128).max(2048).optional(),
  debounceTimeout: z.number().min(0).max(1000).optional()
});
export const ContourSchema = z.strictObject({
  threshold: z.union([z.number(), Vector2Schema]),
  color: ColorSchema.optional(),
  strokeWidth: z.number().optional(),
  zIndex: z.number().optional()
});
/** JSON-safe props for ContourLayer; compose or extend with Zod. */
export const ContourLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...weightProps,
  cellSize: z.number().min(1).optional(),
  gridOrigin: Vector2Schema.optional(),
  gpuAggregation: z.boolean().optional(),
  aggregation: AggregationOperationSchema.optional(),
  contours: z.array(ContourSchema).optional(),
  zOffset: z.number().optional()
});
const extrudedProps = {
  ...colorProps,
  coverage: z.number().min(0).max(1).optional(),
  elevationDomain: Vector2Schema.nullable().optional(),
  elevationRange: Vector2Schema.optional(),
  elevationScale: z.number().nonnegative().optional(),
  extruded: z.boolean().optional(),
  upperPercentile: percentile.optional(),
  lowerPercentile: percentile.optional(),
  elevationUpperPercentile: percentile.optional(),
  elevationLowerPercentile: percentile.optional(),
  colorScaleType: z.enum(['quantize', 'linear', 'quantile', 'ordinal']).optional(),
  material: MaterialSchema.optional(),
  colorAggregation: AggregationOperationSchema.optional(),
  elevationAggregation: AggregationOperationSchema.optional(),
  getPosition: PositionAccessorSchema.optional(),
  getColorWeight: NumberAccessorSchema.optional(),
  getElevationWeight: NumberAccessorSchema.optional(),
  getColorValue: CallbackSchema,
  getElevationValue: CallbackSchema,
  onSetColorDomain: CallbackSchema,
  onSetElevationDomain: CallbackSchema,
  gpuAggregation: z.boolean().optional()
};
/** JSON-safe props for GridLayer; compose or extend with Zod. */
export const GridLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...extrudedProps,
  cellSize: z.number().nonnegative().optional(),
  gridAggregator: CallbackSchema,
  elevationScaleType: z.enum(['linear', 'quantile']).optional()
});
/** JSON-safe props for HexagonLayer; compose or extend with Zod. */
export const HexagonLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...extrudedProps,
  radius: z.number().min(1).optional(),
  hexagonAggregator: CallbackSchema,
  elevationScaleType: z.literal('linear').optional()
});
export const ScreenGridLayerSchema = defineLayer('ScreenGridLayer', ScreenGridLayerPropsSchema);
export const HeatmapLayerSchema = defineLayer('HeatmapLayer', HeatmapLayerPropsSchema);
export const ContourLayerSchema = defineLayer('ContourLayer', ContourLayerPropsSchema);
export const GridLayerSchema = defineLayer('GridLayer', GridLayerPropsSchema);
export const HexagonLayerSchema = defineLayer('HexagonLayer', HexagonLayerPropsSchema);

/** Inferred JSON props for ScreenGridLayer. */
export type ScreenGridLayerProps = z.infer<typeof ScreenGridLayerPropsSchema>;
/** Inferred JSON props for HeatmapLayer. */
export type HeatmapLayerProps = z.infer<typeof HeatmapLayerPropsSchema>;
/** Inferred JSON props for ContourLayer. */
export type ContourLayerProps = z.infer<typeof ContourLayerPropsSchema>;
/** Inferred JSON props for GridLayer. */
export type GridLayerProps = z.infer<typeof GridLayerPropsSchema>;
/** Inferred JSON props for HexagonLayer. */
export type HexagonLayerProps = z.infer<typeof HexagonLayerPropsSchema>;
