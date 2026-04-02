// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Viewport} from '@deck.gl/core';
import {
  RequestScheduler,
  type TileSource,
  type TileSourceMetadata
} from '@loaders.gl/loader-utils';
import {Matrix4} from '@math.gl/core';
import {Stats} from '@probe.gl/stats';
import {Tile2DHeader2} from './tile-2d-header';
import {getTileIndices, tileToBoundingBox} from './utils';
import type {Bounds, TileIndex, TileLoadProps, ZRange} from './types';

export const STRATEGY_NEVER = 'never';
export const STRATEGY_REPLACE = 'no-overlap';
export const STRATEGY_DEFAULT = 'best-available';

/** Function form of a refinement strategy. */
export type RefinementStrategyFunction = (tiles: Tile2DHeader2[]) => void;
/** Strategy controlling how parent and child placeholder tiles are displayed while content loads. */
export type RefinementStrategy =
  | typeof STRATEGY_NEVER
  | typeof STRATEGY_REPLACE
  | typeof STRATEGY_DEFAULT
  | RefinementStrategyFunction;

/** Core configuration shared by all {@link Tile2DTileset} instances. */
export type Tileset2DProps<DataT = any> = {
  /** Callback used to load tile payloads. */
  getTileData: (props: TileLoadProps) => Promise<DataT | null> | DataT | null;
  /** Bounding box limiting tile generation. */
  extent?: number[] | null;
  /** Tile size in pixels. */
  tileSize?: number;
  /** Maximum zoom level to request. */
  maxZoom?: number | null;
  /** Minimum zoom level to request. */
  minZoom?: number | null;
  /** Maximum number of tiles kept in cache. */
  maxCacheSize?: number | null;
  /** Maximum bytes kept in cache. */
  maxCacheByteSize?: number | null;
  /** Placeholder refinement strategy. */
  refinementStrategy?: RefinementStrategy;
  /** Elevation range used by geospatial tile selection. */
  zRange?: ZRange | null;
  /** Maximum concurrent tile requests. */
  maxRequests?: number;
  /** Debounce interval applied before issuing queued requests. */
  debounceTime?: number;
  /** Integer zoom offset applied when choosing tile levels. */
  zoomOffset?: number;
  /** Callback fired when a tile loads successfully. */
  onTileLoad?: (tile: Tile2DHeader2<DataT>) => void;
  /** Callback fired when a tile is evicted from cache. */
  onTileUnload?: (tile: Tile2DHeader2<DataT>) => void;
  /** Callback fired when a tile request fails. */
  onTileError?: (err: any, tile: Tile2DHeader2<DataT>) => void;
};

export const DEFAULT_TILESET2D_PROPS: Omit<Required<Tileset2DProps>, 'getTileData'> = {
  extent: null,
  tileSize: 512,
  maxZoom: null,
  minZoom: null,
  maxCacheSize: 100,
  maxCacheByteSize: null,
  refinementStrategy: 'best-available',
  zRange: null,
  maxRequests: 6,
  debounceTime: 0,
  zoomOffset: 0,
  onTileLoad: () => {},
  onTileUnload: () => {},
  onTileError: () => {}
};

/** Subscription callbacks emitted by {@link Tile2DTileset}. */
type Tile2DListener<DataT = any> = {
  /** Fired after a tile loads successfully. */
  onTileLoad?: (tile: Tile2DHeader2<DataT>) => void;
  /** Fired after a tile request fails. */
  onTileError?: (error: any, tile: Tile2DHeader2<DataT>) => void;
  /** Fired after a tile is evicted from cache. */
  onTileUnload?: (tile: Tile2DHeader2<DataT>) => void;
  /** Fired when metadata or effective configuration changes. */
  onUpdate?: () => void;
  /** Fired when asynchronous metadata initialization fails. */
  onError?: (error: Error) => void;
  /** Fired after live tileset counters are recomputed. */
  onStatsChange?: (stats: Stats) => void;
};

/** Per-consumer tile sets retained by the shared cache. */
type ConsumerState<DataT = any> = {
  /** Tiles selected for this consumer's most recent traversal. */
  selectedTiles: Set<Tile2DHeader2<DataT>>;
  /** Tiles currently marked render-visible for this consumer. */
  visibleTiles: Set<Tile2DHeader2<DataT>>;
};

/** Options for creating a shared tile cache that can be reused by multiple layers and views. */
export type Tile2DTilesetProps<DataT = any> = Omit<Tileset2DProps<DataT>, 'getTileData'> & {
  /** Optional tile loader used when not sourcing data from a loaders.gl TileSource. */
  getTileData?: (props: TileLoadProps) => Promise<DataT | null> | DataT | null;
  /** Optional loaders.gl TileSource backing this shared tileset. */
  tileSource?: TileSource;
};

/** Shared tile cache and loading engine for one or more {@link Tile2DLayer} instances. */
export class Tile2DTileset<DataT = any> {
  /** Live counters describing shared tileset state. */
  readonly stats: Stats;
  /** Effective runtime options after defaults and metadata overrides have been applied. */
  protected opts: Required<Tile2DTilesetProps<DataT>>;
  /** Cached metadata returned by the backing TileSource, if any. */
  protected sourceMetadata: TileSourceMetadata | null = null;
  /** Scheduler shared across all tile requests for this tileset. */
  private _requestScheduler: RequestScheduler;
  /** Shared tile cache keyed by tile id. */
  private _cache: Map<string, Tile2DHeader2<DataT>>;
  /** Tracks whether parent/child links need rebuilding. */
  private _dirty: boolean;
  /** Cached tiles sorted by zoom for traversal and rendering. */
  private _tiles: Tile2DHeader2<DataT>[];
  /** Running total of cached payload byte size. */
  private _cacheByteSize: number;
  /** Subscribers watching tileset lifecycle events. */
  private _listeners = new Set<Tile2DListener<DataT>>();
  /** Selected and visible tiles tracked per consumer. */
  private _consumers = new Map<symbol, ConsumerState<DataT>>();
  /** Option names explicitly set by the caller. */
  private _explicitOptionKeys = new Set<string>();
  /** Caller-provided options before metadata-derived overrides are applied. */
  private _baseOpts: Partial<Tile2DTilesetProps<DataT>> = {};
  /** Derived overrides sourced from TileSource metadata. */
  private _sourceMetadataOverrides: Partial<Tile2DTilesetProps<DataT>> = {};
  /** Resolved maximum zoom level used by traversal. */
  private _maxZoom?: number;
  /** Resolved minimum zoom level used by traversal. */
  private _minZoom?: number;
  /** Most recent viewport seen during tile selection. */
  private _lastViewport: Viewport | null = null;

  /** Creates a tileset from either `getTileData` or a loaders.gl `TileSource`. */
  constructor(opts: Tile2DTilesetProps<DataT>) {
    this.stats = new Stats({
      id: 'Tile2DTileset',
      stats: [
        {name: 'Tiles In Cache'},
        {name: 'Cache Size'},
        {name: 'Visible Tiles'},
        {name: 'Selected Tiles'},
        {name: 'Loading Tiles'},
        {name: 'Unloaded Tiles'},
        {name: 'Consumers'}
      ]
    });
    this.opts = {
      ...DEFAULT_TILESET2D_PROPS,
      ...opts,
      getTileData: opts.getTileData || (async () => null),
      tileSource: opts.tileSource
    } as Required<Tile2DTilesetProps<DataT>>;

    this._requestScheduler = new RequestScheduler({
      throttleRequests: this.opts.maxRequests > 0 || this.opts.debounceTime > 0,
      maxRequests: this.opts.maxRequests,
      debounceTime: this.opts.debounceTime
    });

    this._cache = new Map();
    this._tiles = [];
    this._dirty = false;
    this._cacheByteSize = 0;

    if (!this.opts.tileSource && !opts.getTileData) {
      throw new Error('Tile2DTileset requires either `getTileData` or `tileSource`.');
    }

    this.setOptions(opts);
    this._updateStats();

    if (this.opts.tileSource) {
      void this._initializeTileSource(this.opts.tileSource);
    }
  }

  /** Convenience factory for wrapping a loaders.gl `TileSource`. */
  static fromTileSource<DataT = any>(
    tileSource: TileSource,
    opts: Omit<Tile2DTilesetProps<DataT>, 'tileSource' | 'getTileData'> = {}
  ): Tile2DTileset<DataT> {
    return new Tile2DTileset<DataT>({...opts, tileSource});
  }

  /** All tiles currently present in the shared cache. */
  get tiles(): Tile2DHeader2<DataT>[] {
    return this._tiles;
  }

  /** Estimated byte size of all tile content currently retained in cache. */
  get cacheByteSize(): number {
    return this._cacheByteSize;
  }

  /** Union of tiles selected by all attached consumers. */
  get selectedTiles(): Tile2DHeader2<DataT>[] {
    return Array.from(this._getSelectedTilesUnion());
  }

  /** Union of tiles contributing to the visible result across all consumers and views, including unloaded selected tiles. */
  get visibleTiles(): Tile2DHeader2<DataT>[] {
    const union = this._getVisibleTilesUnion();
    for (const tile of this._getSelectedTilesUnion()) {
      union.add(tile);
    }
    return Array.from(union);
  }

  /** Tiles currently loading anywhere in the shared cache. */
  get loadingTiles(): Tile2DHeader2<DataT>[] {
    return Array.from(this._cache.values()).filter(tile => tile.isLoading);
  }

  /** Tiles retained in cache that do not currently have loaded content. */
  get unloadedTiles(): Tile2DHeader2<DataT>[] {
    return Array.from(this._cache.values()).filter(tile => !tile.isLoaded);
  }

  /** Maximum resolved zoom level after applying metadata and explicit options. */
  get maxZoom(): number | undefined {
    return this._maxZoom;
  }

  /** Minimum resolved zoom level after applying metadata and explicit options. */
  get minZoom(): number | undefined {
    return this._minZoom;
  }

  /** Active refinement strategy for placeholder handling. */
  get refinementStrategy(): RefinementStrategy {
    return this.opts.refinementStrategy || STRATEGY_DEFAULT;
  }

  /** Subscribes to tileset lifecycle events. */
  subscribe(listener: Tile2DListener<DataT>): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Registers a consumer so cache pruning can account for its selected tiles. */
  attachConsumer(id: symbol): void {
    this._consumers.set(id, {selectedTiles: new Set(), visibleTiles: new Set()});
    this._updateStats();
  }

  /** Unregisters a consumer and prunes unused requests and tiles. */
  detachConsumer(id: symbol): void {
    this._consumers.delete(id);
    this._pruneRequests();
    this._resizeCache();
    this._updateStats();
  }

  /** Updates tileset options and reapplies TileSource metadata overrides. */
  setOptions(opts: Tile2DTilesetProps<DataT>): void {
    this._rememberExplicitOptions(opts);
    this._baseOpts = {...this._baseOpts, ...opts};
    this._applyResolvedOptions();
  }

  /** Aborts in-flight requests and clears the shared cache. */
  finalize(): void {
    for (const tile of this._cache.values()) {
      if (tile.isLoading) {
        tile.abort();
      }
    }
    this._cache.clear();
    this._tiles = [];
    this._consumers.clear();
    this._cacheByteSize = 0;
    this._updateStats();
  }

  /** Marks all retained tiles stale and drops unused cached tiles. */
  reloadAll(): void {
    const selectedTiles = this._getSelectedTilesUnion();
    for (const id of this._cache.keys()) {
      const tile = this._cache.get(id) as Tile2DHeader2<DataT>;
      if (!selectedTiles.has(tile)) {
        this._cache.delete(id);
      } else {
        tile.setNeedsReload();
      }
    }
    this._cacheByteSize = this._getCacheByteSize();
    this.prepareTiles();
    this._updateStats();
  }

  /** Updates the selected and visible tile sets for one consumer. */
  updateConsumer(
    id: symbol,
    selectedTiles: Tile2DHeader2<DataT>[],
    visibleTiles: Tile2DHeader2<DataT>[]
  ): void {
    this._consumers.set(id, {
      selectedTiles: new Set(selectedTiles),
      visibleTiles: new Set(visibleTiles)
    });
    this._pruneRequests();
    this._resizeCache();
    this._updateStats();
  }

  /** Rebuilds parent/child links if the cache changed since the last traversal. */
  prepareTiles(): void {
    if (this._dirty) {
      this._rebuildTree();
      this._syncTiles();
      this._dirty = false;
    }
  }

  /** Returns tile indices needed to cover a viewport. */
  getTileIndices({
    viewport,
    maxZoom,
    minZoom,
    zRange,
    modelMatrix,
    modelMatrixInverse
  }: {
    viewport: Viewport;
    maxZoom?: number;
    minZoom?: number;
    zRange: ZRange | null;
    tileSize?: number;
    modelMatrix?: Matrix4;
    modelMatrixInverse?: Matrix4;
    zoomOffset?: number;
  }): TileIndex[] {
    this._lastViewport = viewport;
    const {tileSize, extent, zoomOffset} = this.opts;
    return getTileIndices({
      viewport,
      maxZoom,
      minZoom,
      zRange,
      tileSize,
      extent: extent as Bounds | undefined,
      modelMatrix,
      modelMatrixInverse,
      zoomOffset
    });
  }

  /** Returns the stable cache id for a tile index. */
  getTileId(index: TileIndex): string {
    return `${index.x}-${index.y}-${index.z}`;
  }

  /** Returns the zoom level represented by a tile index. */
  getTileZoom(index: TileIndex): number {
    return index.z;
  }

  /** Returns derived metadata used to initialize a tile header. */
  getTileMetadata(index: TileIndex): Record<string, any> {
    const {tileSize} = this.opts;
    return {bbox: tileToBoundingBox(this._lastViewport!, index.x, index.y, index.z, tileSize)};
  }

  /** Returns the parent tile index in the quadtree. */
  getParentIndex(index: TileIndex): TileIndex {
    return {x: Math.floor(index.x / 2), y: Math.floor(index.y / 2), z: index.z - 1};
  }

  /** Returns a cached tile and optionally creates and loads it on demand. */
  getTile(index: TileIndex, create: true): Tile2DHeader2<DataT>;
  getTile(index: TileIndex, create?: false): Tile2DHeader2<DataT> | undefined;
  getTile(index: TileIndex, create?: boolean): Tile2DHeader2<DataT> | undefined {
    const id = this.getTileId(index);
    let tile = this._cache.get(id);
    let needsReload = false;

    if (!tile && create) {
      tile = new Tile2DHeader2(index);
      Object.assign(tile, this.getTileMetadata(tile.index));
      Object.assign(tile, {id, zoom: this.getTileZoom(tile.index)});
      needsReload = true;
      this._cache.set(id, tile);
      this._dirty = true;
      this._updateStats();
    } else if (tile && tile.needsReload) {
      needsReload = true;
    }

    if (tile) {
      this._touchTile(id, tile);
    }

    if (tile && needsReload) {
      void tile.loadData({
        getData: this.opts.getTileData as (props: TileLoadProps) => Promise<DataT | null> | DataT | null,
        requestScheduler: this._requestScheduler,
        onLoad: this._handleTileLoad.bind(this),
        onError: this._handleTileError.bind(this)
      });
      this._updateStats();
    }

    return tile;
  }

  /** Loads metadata from a TileSource and reapplies derived option overrides. */
  private async _initializeTileSource(tileSource: TileSource): Promise<void> {
    try {
      this.sourceMetadata = await tileSource.getMetadata();
      this._sourceMetadataOverrides = this._getMetadataOverrides(this.sourceMetadata);
      this._applyResolvedOptions();
      this._notifyUpdate();
    } catch (error: any) {
      const normalizedError =
        error instanceof Error ? error : new Error(`TileSource metadata error: ${String(error)}`);
      this._notifyError(normalizedError);
    }
  }

  /** Tracks which options were explicitly set by the caller. */
  private _rememberExplicitOptions(opts: Tile2DTilesetProps<DataT>): void {
    for (const key of Object.keys(opts)) {
      this._explicitOptionKeys.add(key);
    }
  }

  /** Resolves defaults, metadata overrides, and caller options into runtime settings. */
  private _applyResolvedOptions(): void {
    const resolvedOpts = {
      ...DEFAULT_TILESET2D_PROPS,
      ...this._sourceMetadataOverrides,
      ...this._baseOpts
    } as Required<Tile2DTilesetProps<DataT>>;

    if (resolvedOpts.tileSource) {
      resolvedOpts.getTileData = (loadProps: TileLoadProps) =>
        resolvedOpts.tileSource!.getTileData(loadProps) as Promise<DataT | null> | DataT | null;
    }

    this.opts = resolvedOpts;
    this._maxZoom = Number.isFinite(this.opts.maxZoom) ? Math.floor(this.opts.maxZoom as number) : undefined;
    this._minZoom = Number.isFinite(this.opts.minZoom) ? Math.ceil(this.opts.minZoom as number) : undefined;
  }

  /** Maps TileSource metadata into supported tileset options. */
  private _getMetadataOverrides(metadata: TileSourceMetadata | null): Partial<Tile2DTilesetProps<DataT>> {
    if (!metadata) {
      return {};
    }
    const overrides: Partial<Tile2DTilesetProps<DataT>> = {};
    if (!this._explicitOptionKeys.has('minZoom') && Number.isFinite(metadata.minZoom)) {
      overrides.minZoom = metadata.minZoom;
    }
    if (!this._explicitOptionKeys.has('maxZoom') && Number.isFinite(metadata.maxZoom)) {
      overrides.maxZoom = metadata.maxZoom;
    }
    if (!this._explicitOptionKeys.has('extent') && metadata.boundingBox) {
      overrides.extent = [
        metadata.boundingBox[0][0],
        metadata.boundingBox[0][1],
        metadata.boundingBox[1][0],
        metadata.boundingBox[1][1]
      ];
    }
    return overrides;
  }

  /** Handles successful tile loads. */
  private _handleTileLoad(tile: Tile2DHeader2<DataT>): void {
    this.opts.onTileLoad?.(tile as never);
    this._cacheByteSize = this._getCacheByteSize();
    this._resizeCache();
    for (const listener of this._listeners) {
      listener.onTileLoad?.(tile);
    }
    this._updateStats();
  }

  /** Handles tile load failures. */
  private _handleTileError(error: any, tile: Tile2DHeader2<DataT>): void {
    this.opts.onTileError?.(error, tile as never);
    for (const listener of this._listeners) {
      listener.onTileError?.(error, tile);
    }
    this._updateStats();
  }

  /** Handles tile eviction from cache. */
  private _handleTileUnload(tile: Tile2DHeader2<DataT>): void {
    this.opts.onTileUnload?.(tile as never);
    for (const listener of this._listeners) {
      listener.onTileUnload?.(tile);
    }
    this._updateStats();
  }

  /** Notifies listeners that metadata or effective options changed. */
  private _notifyUpdate(): void {
    for (const listener of this._listeners) {
      listener.onUpdate?.();
    }
  }

  /** Notifies listeners about asynchronous metadata errors. */
  private _notifyError(error: Error): void {
    for (const listener of this._listeners) {
      listener.onError?.(error);
    }
  }

  /** Recomputes absolute counter stats and notifies listeners. */
  private _updateStats(): void {
    this._setStatCount('Tiles In Cache', this._cache.size);
    this._setStatCount('Cache Size', this.cacheByteSize);
    this._setStatCount('Visible Tiles', this.visibleTiles.length);
    this._setStatCount('Selected Tiles', this.selectedTiles.length);
    this._setStatCount('Loading Tiles', this.loadingTiles.length);
    this._setStatCount('Unloaded Tiles', this.unloadedTiles.length);
    this._setStatCount('Consumers', this._consumers.size);

    for (const listener of this._listeners) {
      listener.onStatsChange?.(this.stats);
    }
  }

  /** Writes an absolute count into a probe.gl stat. */
  private _setStatCount(name: string, value: number): void {
    this.stats.get(name).reset().addCount(value);
  }

  /** Returns the union of selected tiles across all consumers. */
  private _getSelectedTilesUnion(): Set<Tile2DHeader2<DataT>> {
    const union = new Set<Tile2DHeader2<DataT>>();
    for (const consumer of this._consumers.values()) {
      for (const tile of consumer.selectedTiles) {
        union.add(tile);
      }
    }
    return union;
  }

  /** Returns the union of visible tiles across all consumers. */
  private _getVisibleTilesUnion(): Set<Tile2DHeader2<DataT>> {
    const union = new Set<Tile2DHeader2<DataT>>();
    for (const consumer of this._consumers.values()) {
      for (const tile of consumer.visibleTiles) {
        union.add(tile);
      }
    }
    return union;
  }

  /** Moves a touched tile to the back of the cache map for LRU eviction ordering. */
  private _touchTile(id: string, tile: Tile2DHeader2<DataT>): void {
    this._cache.delete(id);
    this._cache.set(id, tile);
  }

  /** Computes the total byte size of all cached tile content. */
  private _getCacheByteSize(): number {
    let byteLength = 0;
    for (const tile of this._cache.values()) {
      byteLength += tile.byteLength;
    }
    return byteLength;
  }

  /** Cancels low-priority requests when consumers no longer need them. */
  private _pruneRequests(): void {
    const {maxRequests = 0} = this.opts;
    const selectedTiles = this._getSelectedTilesUnion();
    const visibleTiles = this._getVisibleTilesUnion();
    const abortCandidates: Tile2DHeader2<DataT>[] = [];
    let ongoingRequestCount = 0;

    for (const tile of this._cache.values()) {
      if (tile.isLoading) {
        ongoingRequestCount++;
        if (!selectedTiles.has(tile) && !visibleTiles.has(tile)) {
          abortCandidates.push(tile);
        }
      }
    }

    while (maxRequests > 0 && ongoingRequestCount > maxRequests && abortCandidates.length > 0) {
      abortCandidates.shift()!.abort();
      ongoingRequestCount--;
    }
  }

  /** Rebuilds parent and child links for all cached tiles. */
  private _rebuildTree(): void {
    for (const tile of this._cache.values()) {
      tile.parent = null;
      if (tile.children) {
        tile.children.length = 0;
      }
    }
    for (const tile of this._cache.values()) {
      const parent = this._getNearestAncestor(tile);
      tile.parent = parent;
      if (parent?.children) {
        parent.children.push(tile);
      }
    }
  }

  /** Updates the sorted tile list used by traversal and rendering. */
  private _syncTiles(): void {
    this._tiles = Array.from(this._cache.values()).sort((t1, t2) => t1.zoom - t2.zoom);
  }

  /** Evicts unused cached tiles when configured cache limits are exceeded. */
  private _resizeCache(): void {
    const maxCacheSize = this.opts.maxCacheSize ?? 100;
    const maxCacheByteSize = this.opts.maxCacheByteSize ?? Infinity;
    const visibleTiles = this._getVisibleTilesUnion();
    const selectedTiles = this._getSelectedTilesUnion();
    const overflown = this._cache.size > maxCacheSize || this._cacheByteSize > maxCacheByteSize;

    if (overflown) {
      for (const [id, tile] of this._cache) {
        if (!visibleTiles.has(tile) && !selectedTiles.has(tile)) {
          this._cache.delete(id);
          this._cacheByteSize = this._getCacheByteSize();
          this._handleTileUnload(tile);
        }
        if (this._cache.size <= maxCacheSize && this._cacheByteSize <= maxCacheByteSize) {
          break;
        }
      }
      this._dirty = true;
    }

    if (this._dirty) {
      this._rebuildTree();
      this._syncTiles();
      this._dirty = false;
    }
  }

  /** Finds the nearest cached ancestor tile for placeholder rendering. */
  private _getNearestAncestor(tile: Tile2DHeader2<DataT>): Tile2DHeader2<DataT> | null {
    const {_minZoom = 0} = this;
    let index = tile.index;
    while (this.getTileZoom(index) > _minZoom) {
      index = this.getParentIndex(index);
      const parent = this.getTile(index);
      if (parent) {
        return parent;
      }
    }
    return null;
  }
}
