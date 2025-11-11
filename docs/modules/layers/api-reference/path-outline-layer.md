# PathOutlineLayer

`PathOutlineLayer` extends deck.gl's [`PathLayer`](https://deck.gl/docs/api-reference/layers/path-layer)
to render crisp outlines around line work. The layer renders each path twice:
first into an offscreen framebuffer that stores depth ordering information and
then again with inflated widths to draw the halo. This lets you emphasize
overlapping paths (for example, trails or transit lines) without managing
multiple layers manually.

Use [`PathMarkerLayer`](./path-marker-layer.md) when you need arrows or other
markers along a path. The `PathOutlineLayer` is focused purely on the outline
pass and can be combined with any other overlays.

See the [Path outline and marker example](/examples/layers/path-outline-and-markers)
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
  getWidth: (d) => d.width,
  getDashArray: (d) => d.dashArray,
  getZLevel: (d) => d.zLevel
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

Forwarded to the outline shader to control how dash segments are distributed
along a path. When `true`, dash lengths are stretched so both the start and end
of the path line up with a dash segment. Defaults to `false`.

### `getZLevel` (`function`, optional)

Accessor that assigns an 8-bit z-order to each path. Higher values render on top
when outlines overlap. This value is stored in the outline framebuffer so it can
be evaluated during the second pass. Defaults to `() => 0`.

## Sublayers and rendering

`PathOutlineLayer` reuses the `PathLayer` model and injects the `outline`
shader module. During `draw` it:

1. Renders the path with a wider stroke into an offscreen framebuffer to capture
   relative depth ordering (`outlineShadowmap`).
2. Renders the regular path width, sampling the framebuffer to composite the
   halo and base stroke together.

The layer disables depth testing during both passes to avoid z-fighting between
paths rendered at similar heights. Use the `widthScale` and `getZLevel`
accessors to control which paths should visually sit on top of others.

## Tips

- Because the outline pass inflates the width, prefer `widthUnits: 'pixels'` for
  screen-space control.
- Combine `getZLevel` with translucent colors to keep complex networks legible.
- The layer renders on top of any base map. If you see clipping, ensure other
  layers respect the same view state.
