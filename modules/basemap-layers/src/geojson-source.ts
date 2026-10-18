import type {GeoJSONVT, GeoJSONVTOptions} from '@maplibre/geojson-vt';
import {createTileIndex, cutTile, decodeTile, GEOJSON_TILE_EXTENT} from './geojson-tiler';
import type {GeoJsonWorkerRequest, GeoJsonWorkerResponse} from './geojson-worker';
import type {BasemapSource} from './style-resolver';

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
  const maxzoom = getNumber(source.maxzoom, GEOJSON_DEFAULT_MAXZOOM);
  return Math.max(0, Math.min(Math.round(maxzoom), GEOJSON_VT_MAX_ZOOM));
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
    const clusterMaxZoom = getNumber(source.clusterMaxZoom, maxZoom - 1);
    options.cluster = true;
    options.clusterOptions = {
      // The cluster index holds a level per zoom: bounded by the source's tiled zooms, which
      // MapLibre GL JS only warns about, so that a style value cannot make it build millions.
      maxZoom: Math.max(0, Math.min(Math.round(clusterMaxZoom), maxZoom)),
      minPoints: Math.max(2, getNumber(source.clusterMinPoints, 2)),
      extent: GEOJSON_TILE_EXTENT,
      radius: getNumber(source.clusterRadius, 50) * TILE_UNITS_PER_PIXEL,
      log: false,
      generateId
    };
  }
  return options;
}

/**
 * How many coordinate positions of a FeatureCollection go to the worker in one message. Posting
 * copies the features on the main thread, so a large source goes in batches, with the main thread
 * free to draw between them.
 */
const POSITIONS_PER_BATCH = 100_000;

/** Whether GeoJSON sources are tiled in a worker where workers are available. For tests. */
let workerEnabled = true;

/**
 * Whether tiles requested from now on are cut in a worker, where one can start (`true`, the
 * default), or on the main thread. For tests.
 */
export function setGeoJsonWorkerEnabled(enabled: boolean): void {
  workerEnabled = enabled;
}

/** A tile request sent to the worker, and how to cut the tile here if the worker fails. */
type PendingTile = {
  source: BasemapSource;
  index: {x: number; y: number; z: number};
  resolve: (features: Record<string, unknown>[]) => void;
  reject: (error: unknown) => void;
};

/**
 * The worker that indexes GeoJSON sources and cuts their tiles, shared by all of them. If it
 * cannot start (a bundle that does not emit it, a content security policy without `worker-src`)
 * or fails, its requests, and every later one, are cut on the main thread instead.
 */
class GeoJsonWorker {
  failed = false;
  private worker: Worker;
  private nextId = 0;
  private sources = new WeakMap<BasemapSource, {id: number; sent: Promise<void>}>();
  private requests = new Map<number, PendingTile>();
  private registry = new FinalizationRegistry<number>(id =>
    this.post({type: 'remove', source: id})
  );

  constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = ({data}: MessageEvent<GeoJsonWorkerResponse>) => {
      const request = this.requests.get(data.request);
      this.requests.delete(data.request);
      if (!request) {
        return;
      }
      if ('error' in data) {
        request.reject(new Error(data.error));
      } else {
        request.resolve(decodeTile(data.tile));
      }
    };
    worker.onerror = event => {
      event.preventDefault?.();
      this.fail();
    };
    worker.onmessageerror = () => this.fail();
  }

  /** Cuts a tile of `source` in the worker, sending the source's data first if it is new. */
  async getTileFeatures(
    source: BasemapSource,
    index: {x: number; y: number; z: number}
  ): Promise<Record<string, unknown>[]> {
    let entry = this.sources.get(source);
    if (!entry) {
      const id = this.nextId++;
      entry = {id, sent: this.sendSource(id, source)};
      this.sources.set(source, entry);
      this.registry.register(source, id);
    }
    await entry.sent;
    if (this.failed) {
      return getMainThreadTileFeatures(source, index);
    }
    const request = this.nextId++;
    return new Promise((resolve, reject) => {
      this.requests.set(request, {source, index, resolve, reject});
      this.post({type: 'tile', source: entry.id, request, ...index});
    });
  }

  /**
   * Sends a source's data and options. A FeatureCollection's features go in batches, yielding to
   * the main thread between them; the worker builds the index when the last one arrives.
   */
  private async sendSource(id: number, source: BasemapSource): Promise<void> {
    const options = getGeoJsonVtOptions(source);
    const data = source.data as {type?: string; features?: unknown};
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      this.post({type: 'index', source: id, data, options});
      return;
    }
    let batch: unknown[] = [];
    let positions = 0;
    for (const feature of data.features) {
      batch.push(feature);
      positions += countPositions((feature as {geometry?: unknown})?.geometry);
      if (positions >= POSITIONS_PER_BATCH) {
        this.post({type: 'features', source: id, features: batch});
        batch = [];
        positions = 0;
        await yieldToMainThread();
        if (this.failed) {
          return;
        }
      }
    }
    this.post({type: 'features', source: id, features: batch});
    this.post({type: 'index', source: id, options});
  }

  private post(message: GeoJsonWorkerRequest): void {
    if (this.failed) {
      return;
    }
    try {
      this.worker.postMessage(message);
    } catch {
      // Data that cannot be cloned (a function in a property, say) is tiled on the main thread.
      this.fail();
    }
  }

  /** Stops using the worker, and cuts the tiles it still owes on the main thread. */
  private fail(): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.worker.terminate();
    const requests = [...this.requests.values()];
    this.requests.clear();
    for (const {source, index, resolve, reject} of requests) {
      try {
        resolve(getMainThreadTileFeatures(source, index));
      } catch (error) {
        reject(error);
      }
    }
  }
}

/** The number of positions in a GeoJSON geometry's coordinates, to size the batches sent. */
function countPositions(geometry: unknown): number {
  const {type, coordinates, geometries} = (geometry || {}) as {
    type?: string;
    coordinates?: unknown;
    geometries?: unknown[];
  };
  if (type === 'GeometryCollection') {
    return (geometries || []).reduce<number>((sum, child) => sum + countPositions(child), 0);
  }
  const count = (value: unknown): number => {
    if (!Array.isArray(value)) {
      return 0;
    }
    if (typeof value[0] === 'number') {
      return 1;
    }
    let sum = 0;
    for (const child of value) {
      sum += count(child);
    }
    return sum;
  };
  return count(coordinates);
}

/** Resolves after the browser has had a turn to run other tasks, without timer throttling. */
function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** The shared worker, once started; `null` where none can start. */
let geoJsonWorker: GeoJsonWorker | null | undefined;

/**
 * The shared worker, or `null` where GeoJSON is tiled on the main thread: where the platform has
 * no `Worker` (Node), where the worker could not be created or has failed, or when tests turned
 * workers off.
 */
function getGeoJsonWorker(): GeoJsonWorker | null {
  if (!workerEnabled || typeof Worker === 'undefined') {
    return null;
  }
  if (geoJsonWorker === undefined) {
    try {
      // Bundlers (Vite, webpack 5, esbuild with a plugin, Parcel) emit the worker and its imports
      // from this expression, which must stay literal. The CommonJS build has no `import.meta.url`
      // and throws here.
      geoJsonWorker = new GeoJsonWorker(
        new Worker(new URL('./geojson-worker.js', import.meta.url), {type: 'module'})
      );
    } catch {
      geoJsonWorker = null;
    }
  }
  return geoJsonWorker?.failed ? null : geoJsonWorker;
}

/** Each source's tile index on the main thread, built when its first tile is requested there. */
const tileIndexes = new WeakMap<BasemapSource, GeoJSONVT>();

/** Cuts a tile of a GeoJSON source on the main thread, building its index first if needed. */
function getMainThreadTileFeatures(
  source: BasemapSource,
  index: {x: number; y: number; z: number}
): Record<string, unknown>[] {
  let tileIndex = tileIndexes.get(source);
  if (!tileIndex) {
    tileIndex = createTileIndex(source.data, getGeoJsonVtOptions(source));
    tileIndexes.set(source, tileIndex);
  }
  return decodeTile(cutTile(tileIndex, index.z, index.x, index.y));
}

/**
 * The features of one tile of a GeoJSON source, cut by geojson-vt as MapLibre GL JS cuts them, in
 * the normalized tile-local coordinates of decoded vector tiles: the existing vector tile path
 * then draws them as it draws vector tiles. The source is indexed, and its tiles cut, in a worker
 * where one can start, and on the main thread otherwise. Rejects if the source's data is not
 * valid GeoJSON.
 */
export async function getGeoJsonTileFeatures(
  source: BasemapSource,
  index: {x: number; y: number; z: number}
): Promise<Record<string, unknown>[]> {
  const worker = getGeoJsonWorker();
  return worker ? worker.getTileFeatures(source, index) : getMainThreadTileFeatures(source, index);
}
