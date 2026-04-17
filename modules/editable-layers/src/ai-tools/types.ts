// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {FeatureCollection} from 'geojson';
import type {z} from 'zod';

/**
 * Uniform result type for all AI edit tools.
 * ok:true carries the updated FeatureCollection and the index of the affected feature.
 * ok:false carries a machine-readable reason for the failure.
 */
export type EditResult =
  | {ok: true; featureIndex: number; featureCollection: FeatureCollection}
  | {
      ok: false;
      reason:
        | 'self_intersecting'
        | 'out_of_bounds'
        | 'feature_not_found'
        | 'invalid_geometry'
        | 'crs_mismatch'
        | 'not_implemented';
    };

/**
 * Configuration for createEditTools.
 * Modelled after the Vercel AI SDK tool factory pattern — the factory
 * closes over these two functions and uses them in every execute().
 */
export interface EditToolsConfig {
  /** Return the current FeatureCollection. Called once per execute() invocation. */
  getFeatureCollection: () => FeatureCollection;
  /** Called with the immutably-updated FeatureCollection after a successful edit. */
  onFeatureCollectionChange: (fc: FeatureCollection) => void;
}

/**
 * Structural shape of a single AI tool — matches Vercel AI SDK v4 shape
 * without requiring the `ai` package at runtime.
 *
 * T is the Zod schema type for the tool's parameters.
 */
export interface AiTool<T extends z.ZodTypeAny> {
  description: string;
  parameters: T;
  execute: (args: z.infer<T>) => Promise<EditResult>;
}

/**
 * The object returned by createEditTools — keyed by tool name.
 */
export interface EditTools {
  draw_point: AiTool<
    z.ZodObject<{
      position: z.ZodTuple<[z.ZodNumber, z.ZodNumber]>;
      properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>
  >;
  draw_polygon: AiTool<
    z.ZodObject<{
      coordinates: z.ZodArray<z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>>;
      properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>
  >;
  delete_feature: AiTool<z.ZodObject<{featureIndex: z.ZodNumber}>>;
  translate_feature: AiTool<
    z.ZodObject<{
      featureIndex: z.ZodNumber;
      dx: z.ZodNumber;
      dy: z.ZodNumber;
      units: z.ZodOptional<z.ZodEnum<['meters', 'kilometers', 'miles']>>;
    }>
  >;
  draw_line_string: AiTool<
    z.ZodObject<{
      coordinates: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>;
      properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>
  >;
  draw_rectangle: AiTool<
    z.ZodObject<{
      bbox: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber]>;
      properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>
  >;
  modify_feature: AiTool<
    z.ZodObject<{
      featureIndex: z.ZodNumber;
      vertexEdits: z.ZodArray<
        z.ZodDiscriminatedUnion<
          'op',
          [
            z.ZodObject<{
              op: z.ZodLiteral<'move'>;
              positionIndexes: z.ZodArray<z.ZodNumber>;
              position: z.ZodTuple<[z.ZodNumber, z.ZodNumber]>;
            }>,
            z.ZodObject<{
              op: z.ZodLiteral<'add'>;
              positionIndexes: z.ZodArray<z.ZodNumber>;
              position: z.ZodTuple<[z.ZodNumber, z.ZodNumber]>;
            }>,
            z.ZodObject<{op: z.ZodLiteral<'remove'>; positionIndexes: z.ZodArray<z.ZodNumber>}>
          ]
        >
      >;
    }>
  >;
  rotate_feature: AiTool<
    z.ZodObject<{
      featureIndex: z.ZodNumber;
      angle: z.ZodNumber;
      pivot: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>;
    }>
  >;
  scale_feature: AiTool<
    z.ZodObject<{
      featureIndex: z.ZodNumber;
      factor: z.ZodNumber;
      origin: z.ZodOptional<z.ZodEnum<['centroid', 'center', 'bbox']>>;
    }>
  >;
  split_polygon: AiTool<
    z.ZodObject<{
      featureIndex: z.ZodNumber;
      splitterCoordinates: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>;
    }>
  >;
  duplicate_feature: AiTool<
    z.ZodObject<{
      featureIndex: z.ZodNumber;
      offsetMeters: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>;
    }>
  >;
}
