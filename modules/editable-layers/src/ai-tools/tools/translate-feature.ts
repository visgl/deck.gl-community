// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import transformTranslate from '@turf/transform-translate';
import type {FeatureCollection, Feature} from 'geojson';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  /** Zero-based index of the feature to translate. */
  featureIndex: z.number().int().nonnegative(),
  /** Displacement east-west in meters (positive = east). */
  dx: z.number(),
  /** Displacement north-south in meters (positive = north). */
  dy: z.number(),
  units: z.enum(['meters', 'kilometers', 'miles']).optional()
});

export function makeTranslateFeature(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Translate (move) a feature by a displacement vector specified as dx (east-west) ' +
      'and dy (north-south) in meters. Uses turf.transformTranslate with great-circle math.',
    parameters: schema,

    async execute({featureIndex, dx, dy, units = 'meters'}) {
      const fc = config.getFeatureCollection();

      if (featureIndex >= fc.features.length || featureIndex < 0) {
        return {ok: false as const, reason: 'feature_not_found' as const};
      }

      const feature = fc.features[featureIndex];
      const distanceMagnitude = Math.sqrt(dx * dx + dy * dy);

      let translatedFeature: Feature;
      if (distanceMagnitude === 0) {
        translatedFeature = feature;
      } else {
        // Bearing from north: atan2(east, north) in degrees, range -180..180
        const bearingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;

        // Normalise all inputs to kilometers for turf
        const distKm =
          units === 'meters'
            ? distanceMagnitude / 1000
            : units === 'kilometers'
              ? distanceMagnitude
              : distanceMagnitude * 1.60934; // miles to km

        translatedFeature = transformTranslate(feature as any, distKm, bearingDeg, {
          units: 'kilometers',
          mutate: false
        }) as unknown as Feature;
      }

      const newFeatures = fc.features.map((f, i) => (i === featureIndex ? translatedFeature : f));
      const newFc: FeatureCollection = {
        ...fc,
        features: newFeatures
      };

      config.onFeatureCollectionChange(newFc);

      return {
        ok: true as const,
        featureIndex,
        featureCollection: newFc
      };
    }
  };
}
