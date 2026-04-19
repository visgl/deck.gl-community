// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import type {FeatureCollection} from 'geojson';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  /** Zero-based index of the feature to delete. */
  featureIndex: z.number().int().nonnegative()
});

export function makeDeleteFeature(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Delete a feature from the FeatureCollection by its zero-based index. ' +
      'Returns feature_not_found if the index is out of range.',
    parameters: schema,

    async execute({featureIndex}) {
      const fc = config.getFeatureCollection();

      if (featureIndex >= fc.features.length || featureIndex < 0) {
        return {ok: false as const, reason: 'feature_not_found' as const};
      }

      const newFeatures = fc.features.filter((_, i) => i !== featureIndex);
      const newFc: FeatureCollection = {
        ...fc,
        features: newFeatures
      };

      config.onFeatureCollectionChange(newFc);

      return {
        ok: true as const,
        // Return the index of the first feature after deletion, clamped to valid range
        featureIndex: Math.min(featureIndex, newFc.features.length - 1),
        featureCollection: newFc
      };
    }
  };
}
