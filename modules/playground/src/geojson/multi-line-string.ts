// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {PositionSchema} from './position';

export const MultiLineStringSchema = z.object({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(PositionSchema).min(2)),
  bbox: BBoxSchema.optional()
});

export type MultiLineString = z.infer<typeof MultiLineStringSchema>;
