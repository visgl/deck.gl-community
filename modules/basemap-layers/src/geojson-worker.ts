// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The worker that indexes GeoJSON sources and cuts their tiles, as MapLibre GL JS's
 * `GeoJSONWorkerSource` does, so that a large source does not hold the main thread. See
 * `geojson-source.ts` for the other end of each message.
 */

import type {GeoJSONVT, GeoJSONVTOptions} from '@maplibre/geojson-vt';
import {createTileIndex, cutTile} from './geojson-tiler';

/** A message from the main thread. Messages of one source arrive in the order they are sent. */
export type GeoJsonWorkerRequest =
  /** Features of a FeatureCollection, sent in batches before its `index` message. */
  | {type: 'features'; source: number; features: unknown[]}
  /** Builds a source's index from `data`, or from the features sent before it. */
  | {type: 'index'; source: number; data?: unknown; options: GeoJSONVTOptions}
  | {type: 'tile'; source: number; request: number; z: number; x: number; y: number}
  | {type: 'remove'; source: number};

/** The answer to a `tile` request: the encoded tile, or why the source cannot be tiled. */
export type GeoJsonWorkerResponse = {request: number} & (
  | {tile: ReturnType<typeof cutTile>}
  | {error: string}
);

/** The features of each source whose index is not built yet. */
const pendingFeatures = new Map<number, unknown[]>();

/** Each source's index, or the error building it threw. */
const indexes = new Map<number, GeoJSONVT | Error>();

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<GeoJsonWorkerRequest>) => void) | null;
  postMessage: (message: GeoJsonWorkerResponse, transfer: Transferable[]) => void;
};

scope.onmessage = ({data: message}) => {
  switch (message.type) {
    case 'features': {
      const features = pendingFeatures.get(message.source);
      if (features) {
        for (const feature of message.features) {
          features.push(feature);
        }
      } else {
        pendingFeatures.set(message.source, message.features);
      }
      break;
    }
    case 'index': {
      const data = message.data ?? {
        type: 'FeatureCollection',
        features: pendingFeatures.get(message.source) || []
      };
      pendingFeatures.delete(message.source);
      try {
        indexes.set(message.source, createTileIndex(data, message.options));
      } catch (error) {
        indexes.set(message.source, error instanceof Error ? error : new Error(String(error)));
      }
      break;
    }
    case 'tile': {
      const index = indexes.get(message.source);
      try {
        if (!index) {
          throw new Error('GeoJSON source has no index');
        }
        if (index instanceof Error) {
          throw index;
        }
        const tile = cutTile(index, message.z, message.x, message.y);
        scope.postMessage({request: message.request, tile}, [
          tile.positions.buffer,
          tile.lengths.buffer
        ]);
      } catch (error) {
        scope.postMessage(
          {request: message.request, error: error instanceof Error ? error.message : String(error)},
          []
        );
      }
      break;
    }
    case 'remove':
      pendingFeatures.delete(message.source);
      indexes.delete(message.source);
      break;
    default:
  }
};
