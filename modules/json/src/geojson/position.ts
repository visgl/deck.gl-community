// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';

/**
 * GeoJSON Position — either [longitude, latitude] or [longitude, latitude, altitude].
 * RFC 7946 §3.1.1: "A position is an array of numbers. There MUST be two or more elements."
 * We support exactly 2D and 3D per the spec's normative wording.
 */
export const PositionSchema = z.union([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()])
]);

export type Position = z.infer<typeof PositionSchema>;
