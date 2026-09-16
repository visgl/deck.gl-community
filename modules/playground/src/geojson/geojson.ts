// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {FeatureCollectionSchema} from './feature-collection';
import {FeatureSchema} from './feature';
import {GeometrySchema} from './geometry';

/** Any GeoJSON geometry, feature, or feature collection document. */
export const GeoJSONSchema = z.union([GeometrySchema, FeatureSchema, FeatureCollectionSchema]);

export type GeoJSON = z.infer<typeof GeoJSONSchema>;
