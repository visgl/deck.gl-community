// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  /** Array of [longitude, latitude] pairs defining the line. At least 2 points required. */
  coordinates: z.array(z.tuple([z.number(), z.number()])),
  properties: z.record(z.string(), z.unknown()).optional()
});

export function makeDrawLineString(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Add a GeoJSON LineString feature connecting the given sequence of ' +
      '[longitude, latitude] coordinates. At least 2 points required.',
    parameters: schema,

    async execute(_args) {
      // SCAFFOLD: full type contract defined; execution not yet implemented.
      return {ok: false as const, reason: 'not_implemented' as const};
    }
  };
}
