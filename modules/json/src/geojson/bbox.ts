// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';

/**
 * GeoJSON bounding box — either 4 values [minLon, minLat, maxLon, maxLat]
 * or 6 values [minLon, minLat, minAlt, maxLon, maxLat, maxAlt] per RFC 7946 §5.
 */
export const BBoxSchema = z.union([
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
]);

export type BBox = z.infer<typeof BBoxSchema>;
