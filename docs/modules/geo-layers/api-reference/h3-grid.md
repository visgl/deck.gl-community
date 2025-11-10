# H3Grid

## Purpose

`H3Grid` exposes deck.gl's bigint-aware integration with the H3 DGGS. It wraps the helper utilities that convert between H3 index strings, bigint identifiers, and polygon geometry so the `GlobalGridLayer` can render H3 cells without additional glue code.

## Usage

```ts
import {GlobalGridLayer, H3Grid} from '@deck.gl/geo-layers';

const layer = new GlobalGridLayer({
  id: 'h3-grid',
  data: dataset,
  globalGrid: H3Grid,
  getCellId: d => d.h3Index,
  stroked: false
});
```

`H3Grid` supports both string tokens and bigint IDs. Call `H3Grid.lngLatToCell([lng, lat], resolution)` to build indices from coordinates, or `H3Grid.lngLatToToken` when you specifically need the string representation. Its `cellsToBoundaryMultiPolygon` helper mirrors the upstream H3 multi-polygon utilities and is useful when combining multiple cells into a single outline.

## Shared conventions

- `hasNumericRepresentation` is `true`; bigint indices are derived through `h3IndexToBigInt`.
- `initialize` exists to make sure the `h3-js` bridge is loaded; the `GlobalGridLayer` invokes it automatically.
- `cellToLngLat` and `cellToBoundary` return `[longitude, latitude]` pairs compatible with deck.gl geometry helpers.
