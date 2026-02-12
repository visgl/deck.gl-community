# GlobalGrid

## Purpose

`GlobalGrid` defines the shared interface that the `GlobalGridLayer` expects when it works with Discrete Global Grid System (DGGS) helpers. Implementations expose common capabilities—converting between string tokens and numeric cell identifiers, retrieving center coordinates, and generating boundary polygons—so different grid systems can be rendered with the same layer contract.

## Usage

Implement the `GlobalGrid` contract when wiring up a custom DGGS helper:

```ts
import type {GlobalGrid} from '@deck.gl/geo-layers';
import {GlobalGridLayer} from '@deck.gl/geo-layers';

const CustomGrid: GlobalGrid = {
  name: 'custom',
  hasNumericRepresentation: false,
  cellToLngLat: cell => lookupCenter(cell),
  cellToBoundary: cell => lookupBoundary(cell)
};

const layer = new GlobalGridLayer({
  id: 'custom-grid',
  data: dataset,
  globalGrid: CustomGrid,
  getCellId: d => d.cellId
});
```

Every optional method on the interface—such as `initialize`, `tokenToCell`, `cellToToken`, or `lngLatToCell`—can be supplied when a grid supports those operations. The layer automatically calls `globalGrid.initialize()` during `initializeState` and uses `cellToBoundary` to build the polygon geometry.

## Shared conventions

- `cellToLngLat` must return an array `[longitude, latitude]`.
- `cellToBoundary` must return an array of `[longitude, latitude]` vertices; the layer will append the first vertex to close the polygon.
- `hasNumericRepresentation` communicates whether a bigint representation is available alongside the string token.
- `GlobalGridLayer` reads the DGGS identifier through `getCellId` (defaulting to the `cellId` property) and forwards the value directly to the helper.

Refer to the specific helper pages below for grid-specific behavior and caveats.
