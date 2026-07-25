// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PositionSchema} from './position';
import {BBoxSchema} from './bbox';

export const MultiPointSchema = z.object({
  type: z.literal('MultiPoint'),
  coordinates: z.array(PositionSchema),
  bbox: BBoxSchema.optional()
});

export type MultiPoint = z.infer<typeof MultiPointSchema>;
