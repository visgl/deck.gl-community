// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';

/** GeoJSON position with at least longitude and latitude coordinates. */
export const PositionSchema = z.array(z.number()).min(2);

export type Position = z.infer<typeof PositionSchema>;
