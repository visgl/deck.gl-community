// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  /**
   * Bounding box as [minLon, minLat, maxLon, maxLat].
   * The resulting polygon will be an axis-aligned rectangle in geographic space.
   */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  properties: z.record(z.string(), z.unknown()).optional()
});

export function makeDrawRectangle(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Add a rectangular GeoJSON Polygon derived from a bounding box ' +
      '[minLon, minLat, maxLon, maxLat]. Equivalent to turf.bboxPolygon.',
    parameters: schema,

    async execute(_args) {
      // SCAFFOLD: full type contract defined; execution not yet implemented.
      return {ok: false as const, reason: 'not_implemented' as const};
    }
  };
}
