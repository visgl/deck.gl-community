// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import kinks from '@turf/kinks';
import {polygon as turfPolygon} from '@turf/helpers';
import type {FeatureCollection, Feature, Polygon} from 'geojson';
import type {AiTool, EditToolsConfig, EditResult} from '../types';

const schema = z.object({
  /**
   * Polygon ring coordinates: outer ring first, then optional holes.
   * Each ring is an array of [longitude, latitude] pairs.
   * Rings do NOT need to be explicitly closed — this tool closes them automatically.
   */
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  properties: z.record(z.string(), z.unknown()).optional()
});

export function makeDrawPolygon(config: EditToolsConfig): AiTool<typeof schema> {
  return {
    description:
      'Add a GeoJSON Polygon feature. Provide coordinates as an array of rings: ' +
      'first ring is the outer boundary, subsequent rings are holes. ' +
      'Coordinates are [longitude, latitude] pairs; rings are auto-closed. ' +
      'Returns an error if the polygon self-intersects.',
    parameters: schema,

    async execute({coordinates, properties = {}}) {
      if (!coordinates || coordinates.length === 0) {
        return {ok: false as const, reason: 'invalid_geometry' as const};
      }

      // Close each ring if needed
      const closedCoords = coordinates.map((ring) => {
        if (ring.length < 3) return ring;
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] === last[0] && first[1] === last[1]) return ring;
        return [...ring, first];
      });

      // Self-intersection check using turf/kinks
      try {
        const turfPoly = turfPolygon(closedCoords as [number, number][][]);
        const selfIntersections = kinks(turfPoly);
        if (selfIntersections.features.length > 0) {
          return {ok: false as const, reason: 'self_intersecting' as const};
        }
      } catch {
        return {ok: false as const, reason: 'invalid_geometry' as const};
      }

      const fc = config.getFeatureCollection();

      const feature: Feature<Polygon> = {
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: closedCoords as [number, number][][]
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
      } satisfies EditResult;
    }
  };
}
