// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PointSchema} from './point';
import {LineStringSchema} from './line-string';
import {PolygonSchema} from './polygon';
import {MultiPointSchema} from './multi-point';
import {MultiLineStringSchema} from './multi-line-string';
import {MultiPolygonSchema} from './multi-polygon';
import {GeometryCollectionSchema} from './geometry-collection';

/**
 * Union of all GeoJSON geometry types per RFC 7946 §3.1.
 *
 * Note: uses z.union rather than z.discriminatedUnion because GeometryCollectionSchema
 * is a z.lazy()-wrapped opaque ZodType (needed for recursive nesting), which is not
 * directly accepted by z.discriminatedUnion's type constraints. Functionally equivalent
 * for validation; z.union tries each variant in order.
 */
export const GeometrySchema = z.union([
  PointSchema,
  LineStringSchema,
  PolygonSchema,
  MultiPointSchema,
  MultiLineStringSchema,
  MultiPolygonSchema,
  GeometryCollectionSchema
]);

export type Geometry = z.infer<typeof GeometrySchema>;
