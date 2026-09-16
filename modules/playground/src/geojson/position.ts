// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';

/** GeoJSON position, represented as longitude/latitude with optional altitude. */
export const PositionSchema = z.union([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()])
]);

export type Position = z.infer<typeof PositionSchema>;
