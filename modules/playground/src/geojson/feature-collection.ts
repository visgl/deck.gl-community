// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {FeatureSchema} from './feature';

export const FeatureCollectionSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(FeatureSchema),
    bbox: BBoxSchema.optional()
  })
  .loose();

export type FeatureCollection = z.infer<typeof FeatureCollectionSchema>;
