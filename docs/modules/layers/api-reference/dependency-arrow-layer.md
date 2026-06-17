import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# DependencyArrowLayer

<LayerLiveExample highlight="dependency-arrow-layer" />

Renders dependency links as paths, straight lines, or arcs with directional arrow markers.

See the [path outline, marker, and dependency arrow example](/examples/layers/path-outline-and-markers)
for routed links rendered beside `PathOutlineLayer` and `PathMarkerLayer`.

```ts
import {DependencyArrowLayer, PathDirection} from '@deck.gl-community/layers';

const layer = new DependencyArrowLayer({
  id: 'dependencies',
  data,
  positionFormat: 'XY',
  getPath: d => d.path,
  getColor: d => d.color,
  getOutlineColor: [255, 255, 255, 220],
  outlineWidthScale: 3,
  getDirection: d => (d.bidirectional ? PathDirection.BOTH : PathDirection.FORWARD),
  getMarkerPlacements: () => [0.5],
  getMarkerSize: [2, 1],
  markerSizeScale: 8,
  widthUnits: 'pixels',
  mode: 'arc',
  getArcTilt: 90,
  getArcHeight: 0.3
});
```

## Properties

Inherits from all [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer) properties.

### `mode` (`'path' | 'line' | 'arc'`, optional)

Routing mode for the dependency line. Default: `'path'`.

### `getPath` (`Accessor<Position[] | NumericArray>`, optional)

Path coordinates used by the dependency line and marker pass. Nested positions
and flat numeric arrays are accepted. Defaults to deck.gl `PathLayer` behavior.

### `getColor` / `getWidth` (`Accessor`, optional)

Line color and width forwarded to the path, line, or arc sublayer. Width units,
scale, and pixel clamps use the matching deck.gl line props.

### `getOutlineColor` (`Accessor<Color>`, optional)

Color accessor for the optional outline pass rendered underneath the dependency
line. Defaults to `[255, 255, 255, 220]`.

### `outlineWidthScale` (`number`, optional)

Multiplier applied to the optional outline pass relative to `widthScale`.
Defaults to `1`, which disables the outline. Set it above `1` when dependency
links need to sit visibly above route or trail strokes.

### `getDirection` (`Accessor<PathDirection>`, optional)

Marker direction for each dependency. Default: `PathDirection.FORWARD`.

### `getMarkerPlacements` (`Accessor<number[]>`, optional)

Ratios along the path where markers are rendered. Default: `[0.5]`.

### `getMarkerSize` (`Accessor<[number, number]>`, optional)

Marker size in marker-local units before `markerSizeScale` is applied. Default: `[1, 1]`.

### `markerSizeScale` (`number`, optional)

Marker size multiplier. Default: `10`.

### `getArcHeight` / `getArcTilt` (`Accessor<number>`, optional)

Arc routing controls forwarded to deck.gl's `ArcLayer` when `mode` is `'arc'`.

### `getMarkerColor` (`Accessor<Color>`, optional)

Marker color accessor. When omitted, arrow markers reuse `getColor`.

### `highlightPoint` / `highlightIndex` (optional)

Compatibility props carried for callers that keep dependency highlight state on
the same layer props object. The current marker renderer does not add a separate
highlight sublayer.

## Sublayers

- Optional `PathLayer`, `LineLayer`, or `ArcLayer` outline for the dependency line.
- `PathLayer`, `LineLayer`, or `ArcLayer` for the dependency line.
- Internal marker geometry layer for directional arrowheads.

## Source

[modules/layers/src/dependency-arrow-layer/dependency-arrow-layer.ts](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/dependency-arrow-layer/dependency-arrow-layer.ts)
