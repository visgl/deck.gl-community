// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {PositionSchema} from './position';

/** A GeoJSON linear ring has at least four positions and must be closed. */
export const LinearRingSchema = z
  .array(PositionSchema)
  .min(4)
  .refine(
    ring => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      return first.length === last.length && first.every((value, index) => value === last[index]);
    },
    {message: 'Linear ring must be closed: first and last position must be identical'}
  );

export const PolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(LinearRingSchema),
    bbox: BBoxSchema.optional()
  })
  .loose();

export type Polygon = z.infer<typeof PolygonSchema>;
