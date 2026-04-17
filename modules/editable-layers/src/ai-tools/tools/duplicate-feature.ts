// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  featureIndex: z.number().int().nonnegative(),
  /**
   * Optional [dx, dy] offset in meters applied to the duplicate.
   * Defaults to [50, 50] (50m east, 50m north) so it's visible.
   */
  offsetMeters: z.tuple([z.number(), z.number()]).optional()
});

export function makeDuplicateFeature(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Duplicate a feature and optionally offset the copy by [dx, dy] in meters. ' +
      'The original is unchanged. Returns the index of the new duplicate.',
    parameters: schema,

    async execute(_args) {
      // SCAFFOLD: full type contract defined; execution not yet implemented.
      return {ok: false as const, reason: 'not_implemented' as const};
    }
  };
}
