// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  featureIndex: z.number().int().nonnegative(),
  /** Scale factor. 2 = double size, 0.5 = half size. Must be > 0. */
  factor: z.number().positive(),
  /** Origin of scaling. Default 'centroid'. */
  origin: z.enum(['centroid', 'center', 'bbox']).optional()
});

export function makeScaleFeature(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Scale a feature by a factor around its centroid, center, or bbox origin. ' +
      'factor=2 doubles the size, factor=0.5 halves it. Uses turf.transformScale.',
    parameters: schema,

    async execute(_args) {
      // SCAFFOLD: full type contract defined; execution not yet implemented.
      return {ok: false as const, reason: 'not_implemented' as const};
    }
  };
}
