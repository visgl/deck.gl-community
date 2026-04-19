// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PositionSchema} from './position';
import {BBoxSchema} from './bbox';

export const PointSchema = z.object({
  type: z.literal('Point'),
  coordinates: PositionSchema,
  bbox: BBoxSchema.optional()
});

export type Point = z.infer<typeof PointSchema>;
