# DelaunayCoverLayer

`DelaunayCoverLayer` renders a terrain surface from the same weather-station triangulation used to
interpolate a `WindField`. Each triangle follows measured station elevations and is colored by its
average height. It recreates the elevation surface in the original deck.gl wind showcase.

```ts
import {DelaunayCoverLayer} from '@deck.gl-community/geo-layers';

const layer = new DelaunayCoverLayer({
  id: 'wind-terrain',
  windField,
  elevationScale: 14,
  lowColor: [17, 34, 49, 220],
  highColor: [102, 151, 127, 235]
});
```

## Properties

- `windField`: A `WindField` returned by `createWindField`.
- `elevationScale`: Multiplier for each station elevation.
- `lowColor`, `highColor`: RGBA colors interpolated by average triangle elevation.

## Sub-layers

- `terrain`: A `SolidPolygonLayer` containing the station Delaunay triangles.

See the [Wind Map example](/examples/geo-layers/wind).
