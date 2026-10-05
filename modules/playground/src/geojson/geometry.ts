// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {GeometryCollectionSchema} from './geometry-collection';
import {LineStringSchema} from './line-string';
import {MultiLineStringSchema} from './multi-line-string';
import {MultiPointSchema} from './multi-point';
import {MultiPolygonSchema} from './multi-polygon';
import {PointSchema} from './point';
import {PolygonSchema} from './polygon';

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
