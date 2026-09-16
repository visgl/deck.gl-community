// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {PositionSchema} from './position';

export const PointSchema = z
  .object({
    type: z.literal('Point'),
    coordinates: PositionSchema,
    bbox: BBoxSchema.optional()
  })
  .loose();

export type Point = z.infer<typeof PointSchema>;
