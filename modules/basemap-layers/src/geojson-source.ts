import {GeoJSONVT, type GeoJSONVTFeature, type GeoJSONVTOptions} from '@maplibre/geojson-vt';
import type {BasemapSource} from './style-resolver';

/** The extent of MapLibre GL JS's tiles, in tile units: GeoJSON is tiled at this precision. */
const GEOJSON_TILE_EXTENT = 8192;

/** The size of a GeoJSON source's tiles in pixels, fixed in MapLibre GL JS. */
const GEOJSON_TILE_SIZE = 512;

/** The default `maxzoom` of a GeoJSON source, as in the style specification. */
const GEOJSON_DEFAULT_MAXZOOM = 18;

/** The highest zoom geojson-vt tiles at. */
const GEOJSON_VT_MAX_ZOOM = 24;

/** Tile units per pixel of a GeoJSON tile. */
const TILE_UNITS_PER_PIXEL = GEOJSON_TILE_EXTENT / GEOJSON_TILE_SIZE;

/** Whether a source is a GeoJSON source whose data has been resolved to a GeoJSON object. */
export function isGeoJsonSource(source: BasemapSource | undefined): boolean {
  return (
    source?.type === 'geojson' &&
    Boolean(source.data) &&
    typeof source.data === 'object' &&
    !Array.isArray(source.data)
  );
}

/** The deepest zoom a GeoJSON source is tiled at; deeper views overzoom its tiles. */
export function getGeoJsonMaxZoom(source: BasemapSource): number {
  return Math.min(getNumber(source.maxzoom, GEOJSON_DEFAULT_MAXZOOM), GEOJSON_VT_MAX_ZOOM);
}

/** A finite number, or `fallback`. */
function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * geojson-vt options for a GeoJSON source, as MapLibre GL JS 6 sets them: `buffer` and
 * `tolerance` are given in pixels of a 512 pixel tile, and the source's `maxzoom` is the deepest
 * zoom tiled. Clustering is supported without `clusterProperties`.
 */
export function getGeoJsonVtOptions(source: BasemapSource): GeoJSONVTOptions {
  const maxZoom = getGeoJsonMaxZoom(source);
  const generateId = Boolean(source.generateId);
  const promoteId = typeof source.promoteId === 'string' ? source.promoteId : undefined;
  const options: GeoJSONVTOptions = {
    maxZoom,
    extent: GEOJSON_TILE_EXTENT,
    buffer: getNumber(source.buffer, 128) * TILE_UNITS_PER_PIXEL,
    tolerance: getNumber(source.tolerance, 0.375) * TILE_UNITS_PER_PIXEL,
    generateId,
    // geojson-vt rejects `promoteId` together with `generateId`, which then wins, as in MapLibre.
    promoteId: generateId ? undefined : promoteId
  };
  if (source.cluster) {
    const clusterMaxZoom = getNumber(source.clusterMaxZoom, Number.NaN);
    options.cluster = true;
    options.clusterOptions = {
      maxZoom: Number.isNaN(clusterMaxZoom) ? maxZoom - 1 : Math.round(clusterMaxZoom),
      minPoints: Math.max(2, getNumber(source.clusterMinPoints, 2)),
      extent: GEOJSON_TILE_EXTENT,
      radius: getNumber(source.clusterRadius, 50) * TILE_UNITS_PER_PIXEL,
      log: false,
      generateId
    };
  }
  return options;
}

/** Each source's tile index, built when its first tile is requested. */
const tileIndexes = new WeakMap<BasemapSource, GeoJSONVT>();

function getTileIndex(source: BasemapSource): GeoJSONVT {
  let index = tileIndexes.get(source);
  if (!index) {
    index = new GeoJSONVT(source.data as GeoJSON.GeoJSON, getGeoJsonVtOptions(source));
    tileIndexes.set(source, index);
  }
  return index;
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

/** Converts tile units to the normalized tile-local coordinates of decoded vector tiles. */
function toLocal(points: [number, number][]): number[][] {
  return points.map(([x, y]) => [x / GEOJSON_TILE_EXTENT, y / GEOJSON_TILE_EXTENT]);
}

/** Converts a geojson-vt tile feature to a GeoJSON feature in tile-local coordinates. */
function toTileLocalFeature(feature: GeoJSONVTFeature): Record<string, unknown> | null {
  let geometry: {type: string; coordinates: unknown} | null = null;
  if (feature.type === 1) {
    const points = toLocal(feature.geometry);
    geometry =
      points.length === 1
        ? {type: 'Point', coordinates: points[0]}
        : {type: 'MultiPoint', coordinates: points};
  } else if (feature.type === 2) {
    const lines = feature.geometry.map(toLocal);
    geometry =
      lines.length === 1
        ? {type: 'LineString', coordinates: lines[0]}
        : {type: 'MultiLineString', coordinates: lines};
  } else {
    const polygons = classifyRings(feature.geometry).map(polygon => polygon.map(toLocal));
    if (polygons.length === 0) {
      return null;
    }
    geometry =
      polygons.length === 1
        ? {type: 'Polygon', coordinates: polygons[0]}
        : {type: 'MultiPolygon', coordinates: polygons};
  }
  const result: Record<string, unknown> = {
    type: 'Feature',
    geometry,
    properties: feature.tags || {}
  };
  if (feature.id !== undefined) {
    result.id = feature.id;
  }
  return result;
}

/**
 * The features of one tile of a GeoJSON source, cut by geojson-vt as MapLibre GL JS cuts them, in
 * the normalized tile-local coordinates of decoded vector tiles: the existing vector tile path
 * then draws them as it draws vector tiles. Throws if the source's data is not valid GeoJSON.
 */
export function getGeoJsonTileFeatures(
  source: BasemapSource,
  index: {x: number; y: number; z: number}
): Record<string, unknown>[] {
  const tile = getTileIndex(source).getTile(index.z, index.x, index.y);
  const features: Record<string, unknown>[] = [];
  for (const feature of tile?.features || []) {
    const converted = toTileLocalFeature(feature);
    if (converted) {
      features.push(converted);
    }
  }
  return features;
}
