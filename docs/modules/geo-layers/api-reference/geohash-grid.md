# GeohashGrid

## Purpose

`GeohashGrid` decodes Geohash strings into the center points and boundary polygons required by `GlobalGridLayer`. It provides a lightweight bridge between Geohash tokens and deck.gl geometry without introducing bigint handling.

## Usage

```ts
import {GlobalGridLayer, GeohashGrid} from '@deck.gl/geo-layers';

const layer = new GlobalGridLayer({
  id: 'geohash-grid',
  data: dataset,
  globalGrid: GeohashGrid,
  getCellId: d => d.geohash,
  filled: true
});
```

Use `GeohashGrid.cellToLngLat(token)` or `GeohashGrid.cellToBoundary(token)` whenever you need to precompute values outside the layer. All helpers require a string token; bigint arguments throw an error to prevent ambiguous conversions.

## Shared conventions

- `hasNumericRepresentation` is `false`; only string Geohash tokens are supported.
- Boundaries are returned in longitude/latitude order and close the polygon by repeating the first vertex.
- The helper exposes a `getGeohashBounds` utility for computing bounding boxes when needed.
