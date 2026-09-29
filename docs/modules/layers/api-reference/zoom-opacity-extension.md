# ZoomOpacityExtension

<p class="badges">
  <img src="https://img.shields.io/badge/From-v9.4-blue.svg?style=flat-square" alt="From v9.4" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="Experimental" />
</p>

`ZoomOpacityExtension` makes a layer's opacity a function of the viewport zoom. It works like a
MapLibre `["interpolate", ["linear"], ["zoom"], ...]` expression on a `*-opacity` paint property.

Use it to show a layer only within a zoom range, or to crossfade between layers as the user
zooms. For example, a stack of aggregation layers at finer resolutions can hand off to a raw
`ScatterplotLayer`.

Opacity is evaluated on the CPU each time the layer is drawn into a viewport. That means:

- Multi-view setups use each view's own zoom.
- There is no per-frame cost while the camera is idle.
- Data is never re-uploaded or re-aggregated when the zoom changes.

## Usage

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {HexagonLayer} from '@deck.gl/aggregation-layers';
import {ZoomOpacityExtension, zoomBand} from '@deck.gl-community/layers';

const zoomOpacity = new ZoomOpacityExtension();

const layers = [
  // Aggregated overview, fading out around zoom 12
  new HexagonLayer({
    id: 'hexagons',
    data,
    getPosition: (d) => d.position,
    radius: 500,
    gpuAggregation: true,
    extensions: [zoomOpacity],
    zoomOpacity: zoomBand({maxZoom: 12, fadeWidth: 2})
  }),
  // Raw points, fading in around zoom 12
  new ScatterplotLayer({
    id: 'points',
    data,
    getPosition: (d) => d.position,
    radiusMinPixels: 2,
    extensions: [zoomOpacity],
    zoomOpacity: zoomBand({minZoom: 12, fadeWidth: 2})
  })
];
```

Stops can also be written by hand:

```ts
new ScatterplotLayer({
  // ...
  extensions: [new ZoomOpacityExtension()],
  // Hidden below zoom 9, fades in until 10, fully visible to 12, fades out by 13
  zoomOpacity: [
    [9, 0],
    [10, 1],
    [12, 1],
    [13, 0]
  ]
});
```

Stops are plain arrays, so they serialize directly to `@deck.gl/json` and pydeck configurations.

## Constructor

```ts
new ZoomOpacityExtension();
```

The extension has no options.

## Layer Properties

When added to a layer through the `extensions` prop, the following prop is added to the layer.

### `zoomOpacity` (`[zoom: number, opacity: number][]`, optional)

- Default: `null`

A list of `[zoom, opacity]` stops, sorted by ascending zoom.

- Between stops, the value is interpolated linearly. Beyond the first and last stop, it is
  clamped to that stop's value. Stop values are clamped to `[0, 1]`.
- Two consecutive stops at the same zoom make a hard step. At exactly that zoom, the later stop
  wins. For example, `[[5, 0], [5, 1]]` means "visible from zoom 5".
- `null` or `[]` leaves the layer at its regular opacity.

The result multiplies the layer's [`opacity`](https://deck.gl/docs/api-reference/core/layer#opacity)
prop. To avoid confusion with deck.gl's own `minZoom`/`maxZoom` props (on `TileLayer` and view
states), the extension does not add props with those names.

## Helpers

### `zoomBand(options)`

Builds stops for a layer that is visible within a zoom band and fades in and out at its edges.

```ts
zoomBand({minZoom: 8, maxZoom: 11, fadeWidth: 1});
// [[7.5, 0], [8.5, 1], [10.5, 1], [11.5, 0]]
```

- `minZoom` (`number`, optional): the zoom where the band fades in. Omit it for no lower bound.
- `maxZoom` (`number`, optional): the zoom where the band fades out. Omit it for no upper bound.
- `fadeWidth` (`number`, optional): the width of each fade ramp, in zoom levels. Default `1`.

Each fade ramp is centered on its band edge, so opacity is exactly `0.5` at `minZoom` and
`maxZoom`. Two bands that share an edge and a `fadeWidth` therefore crossfade, and their
opacities sum to `1` throughout the transition.

With `fadeWidth: 0`, the band has hard cutoffs that match MapLibre's `minzoom` (inclusive) and
`maxzoom` (exclusive). If a band is narrower than `fadeWidth`, the ramps are shortened so the
stops stay sorted. `zoomBand` throws if `maxZoom < minZoom`.

### `interpolateZoom(zoom, stops)`

Evaluates `stops` at `zoom` using the same rules as the `zoomOpacity` prop. It returns `1` when
`stops` is empty or missing, or when `zoom` is not a finite number. This is useful to drive other
props, such as `pickable` or `visible`, from the same stops.

## Remarks

### Opacity and gamma

Stop values scale the `opacity` prop before deck.gl's gamma correction. deck.gl renders
`opacity: o` with an alpha of `o ** (1 / 2.2)`. So a stop value of `0.5` on a layer with
`opacity: 1` looks exactly the same as `opacity: 0.5` without the extension, and `opacity: 0.8`
with a stop value of `0.5` looks the same as `opacity: 0.4`.

Crossfade values from `zoomBand` sum to `1` before gamma. At the midpoint of a crossfade, each
layer renders with an alpha of about `0.73`, so two overlapping layers together cover about 93%
of the background. This matches what you get when you animate the `opacity` prop yourself.

### Picking and fully faded layers

- When the zoom-derived opacity is exactly `0`, the layer produces no fragments. It is not drawn
  and cannot be picked. It keeps its GPU resources and aggregation state, so fading back in is
  instant.
- While a layer is partially faded (opacity above `0`), it remains pickable. Use
  `interpolateZoom` to set `pickable` if you want to disable picking earlier:

```ts
const pickable = interpolateZoom(viewState.zoom, stops) > 0.5;
```

### Composite and aggregation layers

- The extension can be added to composite layers. The stops are passed to sublayers.
- Aggregation layers such as `HexagonLayer`, `GridLayer` and `ScreenGridLayer` render their
  cells with their own sublayer. The extension fades that sublayer directly.
- CPU and GPU aggregation are not affected. Changing the zoom never triggers re-aggregation.

### Views and zoom

The zoom comes from the viewport that the layer is being drawn into. For viewports with a
per-axis zoom (`[zoomX, zoomY]`), the smaller of the two is used, which matches
`OrthographicViewport`.

### WebGPU

Fading and hiding at opacity `0` both work on WebGPU. On WebGL, fully faded geometry is collapsed
in the vertex shader. On WebGPU, where the extension's GLSL shader module cannot be used, the
layer's draw call is skipped instead. The visible and picking behavior is the same on both.

## Source

[modules/layers/src/zoom-opacity-extension](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/zoom-opacity-extension)
