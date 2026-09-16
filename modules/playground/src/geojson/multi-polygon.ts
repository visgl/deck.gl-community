// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {LinearRingSchema} from './polygon';

export const MultiPolygonSchema = z
  .object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(LinearRingSchema)),
    bbox: BBoxSchema.optional()
  })
  .loose();

export type MultiPolygon = z.infer<typeof MultiPolygonSchema>;
