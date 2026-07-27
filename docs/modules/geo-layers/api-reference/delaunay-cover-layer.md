import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# DelaunayCoverLayer

:::caution Work in progress
The station-surface appearance and API may change. Its `SolidPolygonLayer` sublayer is not yet
fully portable to WebGPU.
:::

`DelaunayCoverLayer` renders one elevation-colored polygon for each triangle in a shared
[`WindField`](./wind-field.md). It visualizes the real station interpolation hull; it is not the
same as the smoothed image-based mountain surface rendered by
[`ElevationLayer`](./elevation-layer.md).

<LayerLiveExample highlight="delaunay-cover-layer" size="tall" />

## Import

```ts
import {DelaunayCoverLayer} from '@deck.gl-community/geo-layers';
```

## Example

```ts
const stationSurface = new DelaunayCoverLayer({
  id: 'wind-station-surface',
  windField,
  elevationScale: 24,
  lowColor: [17, 34, 49, 220],
  highColor: [102, 151, 127, 235],
  opacity: 0.32
});
```

## Properties

- `windField` (`WindField`, required): shared robust station triangulation and forecast.
- `elevationScale` (`number`, default `1`): station-height multiplier.
- `lowColor` (`Color`, default `[17, 34, 49, 220]`): fill color for the lowest stations.
- `highColor` (`Color`, default `[102, 151, 127, 235]`): fill color for the highest stations.
- Standard deck.gl `CompositeLayer` properties, including `opacity` and `visible`.

## Sub-layers

- `terrain`: a `SolidPolygonLayer` containing the station-index Delaunay triangles.

Use the example's **Delaunay station surface** control to inspect the triangulation independently
of the smoothed mountains. See the [wind showcase guide](../developer-guide/wind-showcase.md).
