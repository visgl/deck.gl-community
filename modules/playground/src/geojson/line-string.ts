// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {PositionSchema} from './position';

export const LineStringSchema = z
  .object({
    type: z.literal('LineString'),
    coordinates: z.array(PositionSchema).min(2),
    bbox: BBoxSchema.optional()
  })
  .loose();

export type LineString = z.infer<typeof LineStringSchema>;
