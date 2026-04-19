// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PositionSchema} from '@deck.gl-community/json';
import type {FeatureCollection, Feature, Point, Position} from 'geojson';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  /** [longitude, latitude] or [longitude, latitude, altitude] */
  position: PositionSchema,
  properties: z.record(z.string(), z.unknown()).optional()
});

export function makeDrawPoint(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Add a GeoJSON Point feature at the given [longitude, latitude] position. ' +
      'Returns the updated FeatureCollection and the index of the new point.',
    parameters: schema,

    async execute({position, properties = {}}) {
      const fc = config.getFeatureCollection();

      const feature: Feature<Point> = {
        type: 'Feature',
        properties,
        geometry: {
          type: 'Point',
          coordinates: position as Position
        }
      };

      const newFc: FeatureCollection = {
        ...fc,
        features: [...fc.features, feature]
      };

      config.onFeatureCollectionChange(newFc);

      return {
        ok: true as const,
        featureIndex: newFc.features.length - 1,
        featureCollection: newFc
      };
    }
  };
}
