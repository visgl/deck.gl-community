// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {FeatureSchema} from './feature';
import {BBoxSchema} from './bbox';

/**
 * GeoJSON FeatureCollection per RFC 7946 §3.3.
 */
export const FeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(FeatureSchema),
  bbox: BBoxSchema.optional()
});

export type FeatureCollection = z.infer<typeof FeatureCollectionSchema>;
