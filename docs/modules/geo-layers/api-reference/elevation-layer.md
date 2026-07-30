import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# ElevationLayer

:::caution Work in progress
The terrain API, height-map smoothing, material, and exaggeration are experimental. WebGPU
compatibility depends on upstream `TerrainLayer` and loaders.gl support.
:::

`ElevationLayer` decodes a grayscale height map into illuminated, extruded mountain geometry.
Unlike [`DelaunayCoverLayer`](./delaunay-cover-layer.md), its mesh follows the original elevation
image rather than the sparse weather-station triangles.

<LayerLiveExample highlight="elevation-layer" size="tall" />

## Import

```ts
import {ElevationLayer} from '@deck.gl-community/geo-layers';
```

## Example

```ts
const terrain = new ElevationLayer({
  id: 'wind-mountain-terrain',
  elevationData:
    'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/wind/elevation.png',
  bounds: [-125, 24.4, -66.7, 49.6],
  elevationRange: [-100, 4126],
  elevationScale: 24,
  meshMaxError: 12,
  color: [35, 49, 64, 255]
});
```

For smoother relief, filter the grayscale image once before passing it as `elevationData`. Do not
recreate or decode the terrain mesh during particle animation.

Height-map rendering currently requires WebGL2 because upstream `TerrainLayer` uses a WebGL-only
mesh renderer. On WebGPU, `ElevationLayer` safely omits its terrain sub-layer; use
[`DelaunayCoverLayer`](/docs/modules/geo-layers/api-reference/delaunay-cover-layer) for a
WebGPU-compatible station-triangulated terrain surface. See the
[WebGPU support matrix](/docs/webgpu) for the current status.

## Properties

- `elevationData` (`string`, required): URL or data URL of a red-channel grayscale height map.
- `bounds` (`[number, number, number, number]`, required): geographic west, south, east, and north.
- `elevationRange` (`[number, number]`, default `[-100, 4126]`): source elevation range in meters.
- `elevationScale` (`number`, default `1`): vertical exaggeration of the decoded mesh.
- `meshMaxError` (`number`, default `80`): terrain simplification error; use approximately `12`
  for the smoothed wind showcase.
- `color` (`Color`, default `[42, 58, 72, 255]`): shaded mountain-surface color.
- `texture` (`string`, optional): image draped over the decoded terrain.

## Sub-layers

- `terrain-mesh`: a loaders.gl-backed `TerrainLayer`.

Terrain decoding runs in-process, so the example does not require a separately hosted terrain
worker. See the [wind showcase guide](../developer-guide/wind-showcase.md) and the
[Wind Map example](/examples/geo-layers/wind).
