// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  featureIndex: z.number().int().nonnegative(),
  /** Clockwise rotation in degrees. */
  angle: z.number(),
  /** Optional pivot point [longitude, latitude]. Defaults to feature centroid. */
  pivot: z.tuple([z.number(), z.number()]).optional()
});

export function makeRotateFeature(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Rotate a feature around a pivot point (default: centroid) by the given angle in degrees. ' +
      'Positive = clockwise. Uses turf.transformRotate.',
    parameters: schema,

    async execute(_args) {
      // SCAFFOLD: full type contract defined; execution not yet implemented.
      return {ok: false as const, reason: 'not_implemented' as const};
    }
  };
}
