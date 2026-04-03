# SharedTile2DLayer

import {SharedTile2DLayerDemo} from '@site/src/doc-demos/geo-layers';

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

> This layer is community-maintained and still evolving. Expect API changes while the shared tileset workflow settles.

The `SharedTile2DLayer` is a `CompositeLayer` for tiled content that can reuse a shared `SharedTileset2D` across:

- multiple `SharedTile2DLayer` instances
- multiple views rendering the same layer

Unlike deck.gl core's `TileLayer`, this implementation keeps traversal state per view while sharing tile cache and loading state through `SharedTileset2D`.

See the [SharedTile2DLayer example](/examples/geo-layers/shared-tile-2d-layer).

<SharedTile2DLayerDemo />

This embedded demo shows:

- one shared loaders.gl `TileSource`
- one shared `SharedTileset2D`
- multiple `SharedTile2DLayer` consumers
- multiple views rendering from the same shared cache
- live shared-cache stats rendered from `SharedTileset2D.stats`

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="language">
  <TabItem value="ts" label="TypeScript">

```ts
import {Deck} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {SharedTile2DLayer} from '@deck.gl-community/geo-layers';
import {SharedTileset2D} from '@deck.gl-community/geo-layers/tileset';
import type {TileSource} from '@loaders.gl/loader-utils';

const tileSource: TileSource = {
  getMetadata: async () => ({
    minZoom: 0,
    maxZoom: 14,
    boundingBox: [[-180, -85], [180, 85]]
  }),
  getTile: async () => null,
  getTileData: async ({id}) => [{id, position: [0, 0]}]
};

const sharedTileset = SharedTileset2D.fromTileSource(tileSource);

new Deck({
  controller: true,
  initialViewState: {
    longitude: -122.43,
    latitude: 37.77,
    zoom: 11
  },
  layers: [
    new SharedTile2DLayer({
      id: 'points',
      data: sharedTileset,
      renderSubLayers: props =>
        new ScatterplotLayer(props, {
          data: props.data,
          getPosition: d => d.position,
          getRadius: 200,
          pickable: true
        })
    })
  ]
});
```

  </TabItem>
</Tabs>

## Installation

```bash
npm install @deck.gl-community/geo-layers
```

```ts
import {SharedTile2DLayer} from '@deck.gl-community/geo-layers';
import type {SharedTile2DLayerProps} from '@deck.gl-community/geo-layers';

new SharedTile2DLayer<DataT>(...props: SharedTile2DLayerProps<DataT>[]);
```

## Usage

`data` accepts one of three inputs:

- a URL template such as `'https://host/{z}/{x}/{y}.bin'`
- a shared `SharedTileset2D`
- a loaders.gl `TileSource`

If `data` is a `SharedTileset2D`, the layer treats it as externally owned and will not finalize it.

If `data` is a `TileSource`, the layer creates an internal `SharedTileset2D` wrapper and adopts `minZoom`, `maxZoom`, and `boundingBox` metadata from the source unless those options were explicitly set on the layer.

## Properties

Inherits all [base `Layer`](https://deck.gl/docs/api-reference/core/layer) and [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer) props, plus the following:

### Data Options

#### `data` (`URLTemplate | SharedTileset2D | TileSource`) {#data}

Tiled data source for the layer.

#### `TilesetClass` (`typeof SharedTileset2D`, optional) {#tilesetclass}

Tileset constructor used when the layer owns its tileset instance.

#### `getTileData` (`Function`, optional) {#gettiledata}

Tile loader used when `data` is a URL template.

#### `renderSubLayers` (`Function`, optional) {#rendersublayers}

Called for each loaded tile. Receives the loaded tile payload as `props.data` and the corresponding tile header as `props.tile`.

### Tile Selection Options

#### `extent` (`number[4] | null`, optional) {#extent}

Bounding box limiting generated tiles.

#### `tileSize` (`number`, optional) {#tilesize}

Tile size in pixels. Defaults to `512`.

#### `minZoom` (`number | null`, optional) {#minzoom}

Minimum zoom level to request.

#### `maxZoom` (`number | null`, optional) {#maxzoom}

Maximum zoom level to request.

#### `zoomOffset` (`number`, optional) {#zoomoffset}

Integer offset applied to the resolved tile zoom.

#### `zRange` (`[number, number] | null`, optional) {#zrange}

Elevation bounds used when selecting geospatial tiles.

#### `refinementStrategy` (`'best-available' | 'no-overlap' | 'never' | Function`, optional) {#refinementstrategy}

Controls how ancestor and descendant placeholders are shown while tile content is loading.

### Cache and Request Options

#### `maxCacheSize` (`number | null`, optional) {#maxcachesize}

High-water mark for the backing shared cache. Defaults to `100` when not explicitly set.

The cache only evicts least-recently-used tiles that are neither visible nor selected by any current consumer, so the retained cache can remain above this number while all cached tiles are still visible.

#### `maxCacheByteSize` (`number | null`, optional) {#maxcachebytesize}

Maximum approximate byte size retained by the backing tileset cache.

#### `maxRequests` (`number`, optional) {#maxrequests}

Maximum number of concurrent tile requests.

#### `debounceTime` (`number`, optional) {#debouncetime}

Milliseconds to wait before dispatching queued requests.

### Callbacks

#### `onViewportLoad` (`Function`, optional) {#onviewportload}

Called when the selected tiles for a viewport finish loading.

#### `onTileLoad` (`Function`, optional) {#ontileload}

Called when a tile payload loads successfully.

#### `onTileUnload` (`Function`, optional) {#ontileunload}

Called when a tile is evicted from the shared cache.

#### `onTileError` (`Function`, optional) {#ontileerror}

Called when a tile request fails.

## Multi-View Behavior

Each viewport gets its own traversal state. That means one `SharedTile2DLayer` can participate in multiple views without overwriting tile selection or visibility decisions for any other view.

## Shared Stats

When a layer uses a shared `SharedTileset2D`, cache and visibility stats live on the tileset rather than on the layer. See [SharedTileset2D](./shared-tileset-2d.md) for the shared stats object and subscription callbacks.

## Source

[modules/geo-layers/src/shared-tile-2d-layer](https://github.com/visgl/deck.gl-community/tree/main/modules/geo-layers/src/shared-tile-2d-layer)
