// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PositionSchema} from '@deck.gl-community/json';
import type {AiTool, EditToolsConfig} from '../types';

const schema = z.object({
  featureIndex: z.number().int().nonnegative(),
  /**
   * LineString coordinates defining the splitter line.
   * Must cross the polygon boundary at two or more points.
   */
  splitterCoordinates: z.array(PositionSchema)
});

export function makeSplitPolygon(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Split a Polygon feature into two using a splitter LineString. ' +
      'The splitter must cross the polygon boundary. ' +
      'The original feature is replaced by two new polygon features.',
    parameters: schema,

    async execute(_args) {
      // SCAFFOLD: full type contract defined; execution not yet implemented.
      return {ok: false as const, reason: 'not_implemented' as const};
    }
  };
}
