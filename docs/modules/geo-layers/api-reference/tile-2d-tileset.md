# Tile2DTileset

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

`Tile2DTileset` is the shared cache and loading engine used by `Tile2DLayer`.

Its design goal is to separate:

- shared tile content, request scheduling, and cache eviction
- per-view selection and visibility state

This makes it possible to feed the same tileset to multiple layers and multiple views without duplicating tile requests or overwriting traversal state.

The tileset also owns the shared cache policy and the shared stats object used by the example infobox and other monitoring UIs.

See the [Tile2DLayer example](/examples/geo-layers/tile-2d-layer).

## Installation

```bash
npm install @deck.gl-community/geo-layers
```

```ts
import {Tile2DTileset} from '@deck.gl-community/geo-layers';
import type {Tile2DTilesetProps} from '@deck.gl-community/geo-layers';

const tileset = new Tile2DTileset<DataT>(props as Tile2DTilesetProps<DataT>);
```

## Construction

Create a tileset in one of two ways:

### From `getTileData`

```ts
const tileset = new Tile2DTileset({
  getTileData: async ({id, bbox}) => fetchTile(id, bbox),
  maxZoom: 14,
  maxCacheSize: 256
});
```

### From a loaders.gl `TileSource`

```ts
import type {TileSource} from '@loaders.gl/loader-utils';

const tileSource: TileSource = createTileSourceSomehow();
const tileset = Tile2DTileset.fromTileSource(tileSource, {
  maxCacheByteSize: 32 * 1024 * 1024
});
```

When backed by a `TileSource`, the tileset reads metadata once and adopts:

- `minZoom`
- `maxZoom`
- `boundingBox` mapped to `extent`

Explicitly provided options still win over source metadata.

## Properties and Methods

### Constructor Props

#### `getTileData` (`Function`, optional) {#gettiledata}

Tile payload loader used when not backing the tileset with a `TileSource`.

#### `tileSource` (`TileSource`, optional) {#tilesource}

loaders.gl tile source used for both metadata and tile loading.

#### `extent` (`number[4] | null`, optional) {#extent}

Bounding box limiting tile generation.

#### `tileSize` (`number`, optional) {#tilesize}

Tile size in pixels. Defaults to `512`.

#### `minZoom` / `maxZoom` (`number | null`, optional) {#zoom-bounds}

Zoom bounds used during tile selection.

#### `maxCacheSize` / `maxCacheByteSize` (`number | null`, optional) {#cache-bounds}

Cache limits for retained tiles.

- `maxCacheSize` defaults to `100`.
- `maxCacheSize` is a high-water mark, not a hard cap.
- Eviction uses least-recently-used order among tiles that are neither visible nor selected by any attached consumer.
- If every cached tile is still visible, the cache may temporarily remain above the high-water mark.

#### `maxRequests` / `debounceTime` (`number`, optional) {#request-options}

Request scheduling controls for tile loading.

#### `refinementStrategy` (`'best-available' | 'no-overlap' | 'never' | Function`, optional) {#refinementstrategy}

Placeholder strategy used by attached `Tile2DView` consumers.

### Instance Members

#### `tiles` {#tiles}

Current contents of the shared tile cache.

#### `cacheByteSize` {#cachebytesize}

Estimated byte size of loaded content currently retained in cache.

#### `visibleTiles` / `selectedTiles` {#shared-visible-selected-tiles}

Union views of tiles tracked across all attached consumers.

`visibleTiles` includes unloaded selected tiles so UI counters can reflect pending visibility as view state changes.

#### `loadingTiles` / `unloadedTiles` {#loading-unloaded-tiles}

Current subsets of cached tiles that are loading or not yet loaded.

#### `stats` {#stats}

Live [`Stats`](https://github.com/visgl/probe.gl/tree/master/modules/stats) object from `@probe.gl/stats`.

The shared tileset currently populates:

- `Tiles In Cache`
- `Cache Size`
- `Visible Tiles`
- `Selected Tiles`
- `Loading Tiles`
- `Unloaded Tiles`
- `Consumers`

#### `minZoom` / `maxZoom` {#resolved-zoom-bounds}

Resolved zoom bounds after metadata overrides are applied.

#### `subscribe(listener)` {#subscribe}

Subscribes to tile load, unload, error, stats-change, and metadata update notifications.

The listener may provide:

- `onTileLoad`
- `onTileUnload`
- `onTileError`
- `onUpdate`
- `onError`
- `onStatsChange`

#### `setOptions(opts)` {#setoptions}

Updates runtime configuration and reapplies `TileSource` metadata overrides.

#### `reloadAll()` {#reloadall}

Marks retained cached tiles stale so they reload on the next traversal.

#### `finalize()` {#finalize}

Aborts in-flight requests and clears the shared cache.

## Ownership

If a `Tile2DLayer` receives a `Tile2DTileset` instance through `data`, the tileset is treated as externally owned. You are responsible for calling `finalize()` when it is no longer needed.

## Source

[modules/geo-layers/src/tileset-2d-v2](https://github.com/visgl/deck.gl-community/tree/main/modules/geo-layers/src/tileset-2d-v2)
