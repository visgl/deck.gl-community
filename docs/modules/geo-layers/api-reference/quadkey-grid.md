# QuadkeyGrid

## Purpose

`QuadkeyGrid` turns Bing-style Quadkey tiles into the center coordinates and polygon outlines consumed by `GlobalGridLayer`. It provides a thin wrapper around quadkey-to-world math, exposing a unified API for string tiles and experimental bigint encodings.

## Usage

```ts
import {GlobalGridLayer, QuadkeyGrid} from '@deck.gl/geo-layers';

const layer = new GlobalGridLayer({
  id: 'quadkey-grid',
  data: dataset,
  globalGrid: QuadkeyGrid,
  getCellId: d => d.quadkey,
  opacity: 0.6
});
```

`QuadkeyGrid.cellToLngLat(token)` returns the tile center in `[longitude, latitude]` order, and `cellToBoundary(token)` produces a polygon suitable for deck.gl layers. Helpers such as `quadkeyCellToBounds` and `quadkeyToWorldBounds` remain available from the underlying module when you need additional metadata.

## Shared conventions

- `hasNumericRepresentation` is `true`; while the primary API works with strings, experimental bigint helpers (`quadKeyToBigint`, `bigintToQuadKey`) are exported alongside the grid.
- Boundaries are returned as `[longitude, latitude]` pairs and already include the closing vertex.
- All public helpers expect Quadkey strings; pass values such as `"0231"` that match the Web Mercator tile scheme.
