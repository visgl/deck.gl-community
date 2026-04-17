// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import {PositionSchema} from '@deck.gl-community/json';
import type {AiTool, EditToolsConfig} from '../types';

/**
 * Vertex edit operations — discriminated union so the AI can express
 * move, add, and remove operations with type-safe args.
 */
const vertexEditSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('move'),
    /** Path to the vertex in the geometry coordinates tree. */
    positionIndexes: z.array(z.number()),
    /** New [longitude, latitude] or [longitude, latitude, altitude]. */
    position: PositionSchema
  }),
  z.object({
    op: z.literal('add'),
    /** Path at which to insert the new vertex. */
    positionIndexes: z.array(z.number()),
    /** New [longitude, latitude] or [longitude, latitude, altitude]. */
    position: PositionSchema
  }),
  z.object({
    op: z.literal('remove'),
    /** Path to the vertex to remove. */
    positionIndexes: z.array(z.number())
  })
]);

const schema = z.object({
  featureIndex: z.number().int().nonnegative(),
  /** One or more vertex edits to apply in sequence. */
  vertexEdits: z.array(vertexEditSchema)
});

export function makeModifyFeature(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Modify a feature by moving, adding, or removing individual vertices. ' +
      'positionIndexes is the path through the coordinates array tree ' +
      '(e.g. [0, 2] = outer ring, third vertex of a Polygon).',
    parameters: schema,

    async execute(_args) {
      // SCAFFOLD: VertexEdit union type is real; execution not yet implemented.
      return {ok: false as const, reason: 'not_implemented' as const};
    }
  };
}
