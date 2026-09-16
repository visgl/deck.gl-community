// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';

/** GeoJSON bounding box with an even number of coordinates for its corners. */
export const BBoxSchema = z
  .array(z.number())
  .min(4)
  .refine(values => values.length % 2 === 0, {
    message: 'Bounding box must have an even number of values'
  });

export type BBox = z.infer<typeof BBoxSchema>;
