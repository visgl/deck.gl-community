// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PositionSchema} from './position';
import {BBoxSchema} from './bbox';

/**
 * GeoJSON LineString — array of two or more positions per RFC 7946 §3.1.4.
 */
export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(PositionSchema).min(2),
  bbox: BBoxSchema.optional()
});

export type LineString = z.infer<typeof LineStringSchema>;
