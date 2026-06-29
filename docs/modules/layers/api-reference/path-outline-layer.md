import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# PathOutlineLayer

<LayerLiveExample highlight="path-outline-layer" />

`PathOutlineLayer` wraps deck.gl's [`PathLayer`](https://deck.gl/docs/api-reference/layers/path-layer)
to render crisp outlines around line work. The layer renders each path with two
standard deck.gl sublayers: an inflated outline stroke and the normal path stroke
on top. This keeps the layer on the deck.gl/luma.gl v9 render path while letting
you emphasize overlapping paths (for example, trails or transit lines) without
managing multiple layers manually.

Use [`PathMarkerLayer`](./path-marker-layer.md) when you need arrows or other
markers along a path. The `PathOutlineLayer` is focused purely on the outline
pass and can be combined with any other overlays.

See the [path outline, marker, and dependency arrow example](/examples/layers/path-outline-and-markers)
for a live demonstration.

## Usage

```ts
import {PathOutlineLayer} from '@deck.gl-community/layers';

const trails = new PathOutlineLayer({
  id: 'trail-outlines',
  data: segments,
  widthUnits: 'pixels',
  widthScale: 8,
  getPath: (d) => d.path,
  getColor: (d) => d.color,
  getOutlineColor: [15, 23, 42, 180],
  getWidth: (d) => d.width,
  getDashArray: (d) => d.dashArray,
  outlineWidthScale: 1.24
});
```

`PathOutlineLayer` inherits every prop from `PathLayer`. The options below are
either added or reimplemented by the outline renderer.

## Properties

### `getDashArray` (`number[] | function`, optional)

Dash pattern for each path. Supply a two-element array `[dash, gap]` or a
callback that returns an array. The units match `widthUnits` (pixels by default).
Return `null` to render a solid stroke. Defaults to the upstream `PathLayer`
behavior.

### `dashJustified` (`boolean`, optional)

Forwarded through deck.gl's `PathStyleExtension` to control how dash segments
are distributed along a path. When `true`, dash lengths are stretched so both the
start and end of the path line up with a dash segment. Defaults to `false`.

### `getOutlineColor` (`number[] | function`, optional)

Color accessor used by the outline stroke rendered behind the path. Defaults to
`[15, 23, 42, 180]`.

### `outlineWidthScale` (`number`, optional)

Multiplier applied to `widthScale` for the outline stroke. Defaults to `1.2`.
For example, with `widthScale: 8`, the outline sublayer uses
`widthScale: 9.6`.

### `getZLevel` (`function`, optional)

Legacy accessor retained for callers that migrated from the nebula.gl-era layer.
The v9 implementation renders standard deck.gl sublayers in data order, so use
your data ordering when outlines overlap. Defaults to `() => 0`.

## Sublayers and rendering

`PathOutlineLayer` renders two `PathLayer` sublayers:

1. `outline`: rendered first with `getOutlineColor` and
   `widthScale * outlineWidthScale`.
2. `path`: rendered second with the original `getColor` and `widthScale`.

When `getDashArray` is supplied, the layer attaches
`PathStyleExtension({dash: true, highPrecisionDash: true})` unless a caller
already provided a path-style extension, so `getDashArray` and `dashJustified`
work on both sublayers. It also disables depth writes and uses
`depthCompare: 'always'` on both passes to avoid z-fighting between colocated
path strokes.

## Tips

- Because the outline pass inflates the width, prefer `widthUnits: 'pixels'` for
  screen-space control.
- Order data from lower-priority to higher-priority paths when overlaps need a
  consistent visual stacking order.
- The layer renders on top of any base map. If you see clipping, ensure other
  layers respect the same view state.
