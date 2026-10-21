// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Cutting GeoJSON into vector tiles with `@maplibre/geojson-vt`, and the transferable form a
 * tile's features take between the worker that cuts them and the main thread that draws them.
 * This module runs in both: it holds no state and imports nothing from the rest of the module.
 */

import {GeoJSONVT, type GeoJSONVTFeature, type GeoJSONVTOptions} from '@maplibre/geojson-vt';

/** The extent of MapLibre GL JS's tiles, in tile units: GeoJSON is tiled at this precision. */
export const GEOJSON_TILE_EXTENT = 8192;

/** The geometry types of a tile's features, by how deep their coordinates nest. */
const GEOMETRY_DEPTHS = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3
} as const;

type GeometryType = keyof typeof GEOMETRY_DEPTHS;

/** One feature of an encoded tile: its coordinates are in the tile's typed arrays. */
type EncodedFeature = {
  type: GeometryType;
  properties: Record<string, unknown>;
  id?: unknown;
};

/**
 * A tile's features in a form whose bulk can be transferred between threads: each feature's
 * coordinates, in tile units, follow one another in `positions` (x, y pairs), and `lengths` holds,
 * depth first, the length of each array above a position (the polygons of a multipolygon, the
 * rings of a polygon, the points of a ring). Tile units are integers: geojson-vt rounds them.
 */
export type EncodedTile = {
  features: EncodedFeature[];
  positions: Int32Array;
  lengths: Uint32Array;
};

/** Builds the tile index of a GeoJSON source's data. Throws if the data is not valid GeoJSON. */
export function createTileIndex(data: unknown, options: GeoJSONVTOptions): GeoJSONVT {
  return new GeoJSONVT(data as GeoJSON.GeoJSON, options);
}

/** A ring's signed area in tile units, as `@mapbox/vector-tile` computes it. */
function getSignedArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[i][1] + ring[j][1]);
  }
  return sum;
}

/**
 * Groups a polygon feature's rings into polygons, as MapLibre GL JS does for vector tiles: a ring
 * wound as the first one starts a polygon, and a ring wound the other way is a hole of the
 * polygon before it. Rings without area are dropped.
 */
function classifyRings(rings: [number, number][][]): [number, number][][][] {
  const polygons: [number, number][][][] = [];
  let polygon: [number, number][][] | undefined;
  let clockwise: boolean | undefined;
  for (const ring of rings) {
    const area = getSignedArea(ring);
    if (area === 0) {
      continue;
    }
    clockwise ??= area < 0;
    if (clockwise === area < 0) {
      polygon = [ring];
      polygons.push(polygon);
    } else {
      polygon?.push(ring);
    }
  }
  return polygons;
}

/** A geojson-vt tile feature's GeoJSON geometry, in tile units; `null` for a polygon without area. */
function getGeometry(feature: GeoJSONVTFeature): {type: GeometryType; coordinates: unknown} | null {
  if (feature.type === 1) {
    const points = feature.geometry;
    return points.length === 1
      ? {type: 'Point', coordinates: points[0]}
      : {type: 'MultiPoint', coordinates: points};
  }
  if (feature.type === 2) {
    const lines = feature.geometry;
    return lines.length === 1
      ? {type: 'LineString', coordinates: lines[0]}
      : {type: 'MultiLineString', coordinates: lines};
  }
  const polygons = classifyRings(feature.geometry);
  if (polygons.length === 0) {
    return null;
  }
  return polygons.length === 1
    ? {type: 'Polygon', coordinates: polygons[0]}
    : {type: 'MultiPolygon', coordinates: polygons};
}

/**
 * Cuts one tile from a tile index, as MapLibre GL JS cuts it, and encodes its features. Its typed
 * arrays' buffers can be transferred.
 */
export function cutTile(index: GeoJSONVT, z: number, x: number, y: number): EncodedTile {
  const features: EncodedFeature[] = [];
  const positions: number[] = [];
  const lengths: number[] = [];

  const writeCoordinates = (coordinates: any, depth: number) => {
    if (depth === 0) {
      positions.push(coordinates[0], coordinates[1]);
      return;
    }
    lengths.push(coordinates.length);
    for (const child of coordinates) {
      writeCoordinates(child, depth - 1);
    }
  };

  for (const feature of index.getTile(z, x, y)?.features || []) {
    const geometry = getGeometry(feature);
    if (!geometry) {
      continue;
    }
    writeCoordinates(geometry.coordinates, GEOMETRY_DEPTHS[geometry.type]);
    const encoded: EncodedFeature = {type: geometry.type, properties: feature.tags || {}};
    if (feature.id !== undefined) {
      encoded.id = feature.id;
    }
    features.push(encoded);
  }
  return {features, positions: Int32Array.from(positions), lengths: Uint32Array.from(lengths)};
}

/**
 * The GeoJSON features of an encoded tile, in the normalized tile-local coordinates of decoded
 * vector tiles: the vector tile path then draws them as it draws vector tiles.
 */
export function decodeTile(tile: EncodedTile): Record<string, unknown>[] {
  const {positions, lengths} = tile;
  let position = 0;
  let length = 0;

  const readCoordinates = (depth: number): unknown => {
    if (depth === 0) {
      const point = [
        positions[position] / GEOJSON_TILE_EXTENT,
        positions[position + 1] / GEOJSON_TILE_EXTENT
      ];
      position += 2;
      return point;
    }
    const count = lengths[length++];
    const children = new Array(count);
    for (let i = 0; i < count; i++) {
      children[i] = readCoordinates(depth - 1);
    }
    return children;
  };

  return tile.features.map(({type, properties, id}) => {
    const feature: Record<string, unknown> = {
      type: 'Feature',
      geometry: {type, coordinates: readCoordinates(GEOMETRY_DEPTHS[type])},
      properties
    };
    if (id !== undefined) {
      feature.id = id;
    }
    return feature;
  });
}
