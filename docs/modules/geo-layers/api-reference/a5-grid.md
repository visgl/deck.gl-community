# A5Grid

## Purpose

`A5Grid` wraps the [A5 discrete global grid system](https://www.ogc.org/standards/dggs) and exposes it through the shared `GlobalGrid` contract. It bridges the `a5-js` utilities used by deck.gl into a uniform API so the `GlobalGridLayer` can fetch cell centers and polygon boundaries for A5 indices.

## Usage

```ts
import {GlobalGridLayer, A5Grid} from '@deck.gl/geo-layers';

const layer = new GlobalGridLayer({
  id: 'a5-grid',
  data: dataset,
  globalGrid: A5Grid,
  getCellId: d => d.a5Token,
  extruded: true
});
```

Use `A5Grid.lngLatToCell(lngLat, resolution)` when you need to derive cell identifiers from coordinates. The helper accepts either a hexadecimal string or a bigint identifier, automatically performing conversions through `tokenToCell`/`cellToToken`.

## Shared conventions

- `hasNumericRepresentation` is `true`; bigint identifiers are supported alongside hexadecimal tokens.
- `tokenToCell` and `cellToToken` convert between hexadecimal string tokens and bigint IDs.
- `cellToLngLat` and `cellToBoundary` both accept either representation and dispatch through `a5-js` to return longitude/latitude values.
