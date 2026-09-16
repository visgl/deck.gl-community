// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {PositionSchema} from './position';

export const MultiPointSchema = z
  .object({
    type: z.literal('MultiPoint'),
    coordinates: z.array(PositionSchema),
    bbox: BBoxSchema.optional()
  })
  .loose();

export type MultiPoint = z.infer<typeof MultiPointSchema>;
