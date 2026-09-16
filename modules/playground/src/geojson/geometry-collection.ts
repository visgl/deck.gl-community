// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {BBoxSchema} from './bbox';
import {LineStringSchema} from './line-string';
import {MultiLineStringSchema} from './multi-line-string';
import {MultiPointSchema} from './multi-point';
import {MultiPolygonSchema} from './multi-polygon';
import {PointSchema} from './point';
import {PolygonSchema} from './polygon';

export type GeometryCollection = {
  type: 'GeometryCollection';
  geometries: Array<
    | z.infer<typeof PointSchema>
    | z.infer<typeof LineStringSchema>
    | z.infer<typeof PolygonSchema>
    | z.infer<typeof MultiPointSchema>
    | z.infer<typeof MultiLineStringSchema>
    | z.infer<typeof MultiPolygonSchema>
    | GeometryCollection
  >;
  bbox?: z.infer<typeof BBoxSchema>;
};

export const GeometryCollectionSchema: z.ZodType<GeometryCollection> = z.lazy(() =>
  z
    .object({
      type: z.literal('GeometryCollection'),
      geometries: z.array(
        z.union([
          PointSchema,
          LineStringSchema,
          PolygonSchema,
          MultiPointSchema,
          MultiLineStringSchema,
          MultiPolygonSchema,
          GeometryCollectionSchema
        ])
      ),
      bbox: BBoxSchema.optional()
    })
    .loose()
);
