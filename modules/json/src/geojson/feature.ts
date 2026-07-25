// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {GeometrySchema} from './geometry';
import {BBoxSchema} from './bbox';

/**
 * GeoJSON Feature per RFC 7946 §3.2.
 * - geometry may be null (to represent features without geometry)
 * - properties may be null
 * - id is optional, and may be a string or number
 */
export const FeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: GeometrySchema.nullable(),
  properties: z.record(z.string(), z.unknown()).nullable(),
  id: z.union([z.string(), z.number()]).optional(),
  bbox: BBoxSchema.optional()
});

export type Feature = z.infer<typeof FeatureSchema>;
