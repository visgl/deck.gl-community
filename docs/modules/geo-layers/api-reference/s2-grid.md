# S2Grid

## Purpose

`S2Grid` adapts S2 cell utilities so that the `GlobalGridLayer` can consume S2 tokens and numeric cell IDs directly. It exposes conversion helpers for tokens, center coordinates, and polygon boundaries built from the math.gl S2 geometry utilities.

## Usage

```ts
import {GlobalGridLayer, S2Grid} from '@deck.gl/geo-layers';

const layer = new GlobalGridLayer({
  id: 's2-grid',
  data: dataset,
  globalGrid: S2Grid,
  getCellId: d => d.s2Token,
  pickable: true
});
```

You can convert between token strings and bigint IDs through `S2Grid.tokenToCell` and `S2Grid.cellToToken`. When you only have a bigint, `S2Grid.cellToLngLat` and `S2Grid.cellToBoundary` will still accept it, normalizing inputs internally.

## Shared conventions

- `hasNumericRepresentation` is `true`; tokens resolve to bigint IDs before further processing.
- Boundary polygons are returned as `[longitude, latitude]` points that include the starting vertex again to close the loop.
- Additional helpers such as `getS2Bounds` are available in the underlying module when you need bounding boxes for a cell.
