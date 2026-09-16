// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {GeometrySchema} from './geometry';

export const FeatureSchema = z
  .object({
    type: z.literal('Feature'),
    geometry: GeometrySchema.nullable(),
    properties: z.record(z.string(), z.unknown()).nullable(),
    id: z.union([z.string(), z.number()]).optional(),
    bbox: BBoxSchema.optional()
  })
  .loose();

export type Feature = z.infer<typeof FeatureSchema>;
