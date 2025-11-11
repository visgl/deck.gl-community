# PathMarkerLayer

Create directional markers along a path (arrows by default) while reusing the
[`PathOutlineLayer`](./path-outline-layer.md) halo renderer. The layer is useful
for visualizing traffic flow, transit routes, or any polyline where the travel
direction matters. Markers are positioned in screen space so they stay evenly
spaced regardless of map zoom level.

See the [Path outline and marker example](/examples/layers/path-outline-and-markers)
for a live walkthrough.

## Usage

```ts
import {PathMarkerLayer} from '@deck.gl-community/layers';

const layer = new PathMarkerLayer({
  id: 'transit-routes',
  data: routes,
  widthUnits: 'pixels',
  widthScale: 10,
  getPath: (d) => d.path,
  getColor: (d) => d.color,
  getDirection: () => ({forward: true, backward: false}),
  getMarkerColor: (d) => d.markerColor,
  getMarkerPercentages: (object, {lineLength}) =>
    lineLength > 800 ? [0.2, 0.5, 0.8] : [0.5]
});
```

`PathMarkerLayer` inherits every property from `PathOutlineLayer` (which itself
inherits from deck.gl's `PathLayer`) and adds the options below to control the
marker pass.

## Properties

### `getDirection` (`function`, optional)

Accessor that returns an object describing which direction(s) to render markers.
The object supports `forward` and `backward` boolean flags. When omitted the
layer reads `object.direction` or defaults to `{forward: true, backward: false}`.

### `getMarkerColor` (`function`, optional)

Accessor that returns the RGBA color of each marker. Defaults to `[0, 0, 0, 255]`.

### `getMarkerPercentages` (`function`, optional)

Controls where markers are placed along each path. The accessor receives the
object and a context object `{lineLength}` measured in screen pixels. Return an
array of numbers between `0` and `1`, representing the percentage along the
polyline from the start vertex. The default accessor places three markers at 25,
50, and 75 percent for longer paths and a single marker at the midpoint for
shorter ones.

### `highlightPoint` (`[number, number] | [number, number, number]`, optional)

Geographic position used to highlight the closest point on the selected path.
Requires `highlightIndex` to reference the matching object in `data`. When both
are provided the layer renders a small `ScatterplotLayer` dot at the nearest
point along the polyline. Defaults to `null`.

### `highlightIndex` (`number`, optional)

Index of the path to inspect when `highlightPoint` is provided. Defaults to `-1`
(no highlight).

### `MarkerLayer` (`Layer`, optional)

Layer class used to render each marker. Defaults to deck.gl's `SimpleMeshLayer`
with a 2D arrow mesh. Supply your own layer (for example, `IconLayer`) to change
the marker geometry.

### `markerLayerProps` (`object`, optional)

Static props merged into the `MarkerLayer` constructor. The defaults provide the
bundled arrow mesh. Override this to adjust orientation, lighting, or other
per-layer options. Dynamic props can also be supplied via `updateTriggers` on
the composite layer.

### `sizeScale` (`number`, optional)

Scale applied to the marker geometry. Defaults to `100`, matching the size range
of the arrow mesh used by the `SimpleMeshLayer`.

### `fp64` (`boolean`, optional)

Enable 64-bit precision for the underlying marker layer. Defaults to `false`.

### `nebulaLayer` (`Layer`, optional)

Legacy escape hatch carried over from the nebula.gl version of this layer. Most
applications can ignore it; when provided the instance will be reused instead of
creating a new `MarkerLayer`.

## Sublayers

`PathMarkerLayer` renders three sublayers:

1. A `PathOutlineLayer` to draw the base stroke and halo.
2. A marker layer (default `SimpleMeshLayer`) positioned at the percentages
   returned by `getMarkerPercentages`.
3. A `ScatterplotLayer` that marks the closest point to `highlightPoint` when
   highlighting is enabled.

Because the outline already renders the base path, disable picking on the marker
layer if you only want to interact with the path geometry. The composite layer's
`getPickingInfo` helper also forwards the picked object from the outline so tool
tips receive the original data object instead of the generated marker vertices.
