// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';

/** GeoJSON bounding box with two or three coordinates per position. */
export const BBoxSchema = z.union([
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
]);

export type BBox = z.infer<typeof BBoxSchema>;
