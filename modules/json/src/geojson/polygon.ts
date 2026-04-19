// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PositionSchema} from './position';
import {BBoxSchema} from './bbox';

/**
 * A linear ring for a Polygon:
 * - Must have ≥ 4 positions (RFC 7946 §3.1.6)
 * - First and last position must be identical (ring closure)
 */
const LinearRingSchema = z
  .array(PositionSchema)
  .min(4)
  .refine(
    (ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      // Compare all coordinate components
      return first.length === last.length && first.every((v, i) => v === last[i]);
    },
    {message: 'Linear ring must be closed: first and last position must be identical'}
  );

/**
 * GeoJSON Polygon — array of linear rings per RFC 7946 §3.1.6.
 * First ring is the exterior; subsequent rings are holes.
 */
export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(LinearRingSchema),
  bbox: BBoxSchema.optional()
});

export type Polygon = z.infer<typeof PolygonSchema>;

/** Exported for reuse in other schemas that need to validate individual rings. */
export {LinearRingSchema};
