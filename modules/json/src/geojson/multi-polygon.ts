// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {LinearRingSchema} from './polygon';
import {BBoxSchema} from './bbox';

export const MultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(LinearRingSchema)),
  bbox: BBoxSchema.optional()
});

export type MultiPolygon = z.infer<typeof MultiPolygonSchema>;
