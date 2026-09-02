import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# BlockLayer

<LayerLiveExample highlight="block-layer" />

Runnable example: [Infovis layer primitives](/examples/infovis-layers/layer-primitives).

Renders axis-aligned rectangular blocks with fill and outline colors. The layer
is intended for dense non-geospatial timelines and interval views where a
`PolygonLayer` would add unnecessary geometry work.

```ts
import {BlockLayer} from '@deck.gl-community/infovis-layers';

const layer = new BlockLayer({
  id: 'trace-blocks',
  data,
  sizeUnits: 'common',
  lineWidthUnits: 'pixels',
  getPosition: d => d.position,
  getSize: d => d.size,
  getFillColor: d => d.fillColor,
  getLineColor: d => d.lineColor,
  getLineWidth: 1,
  widthCutoffPixels: 0.5,
  getOpacity: d => d.opacity
});
```

## Properties

Inherits from all [Layer](https://deck.gl/docs/api-reference/core/layer) properties.

### `data` (`LayerDataSource`, required)

Data objects rendered as rectangular blocks.

### `sizeUnits` (`'meters' | 'common' | 'pixels'`, optional)

Units used by `getSize`. Default: `'meters'`.

### `getPosition` (`Accessor<Position>`, optional)

Bottom-left block position. Defaults to `object => object.position`.

### `getSize` (`Accessor<[number, number]>`, optional)

Block width and height. Default: `[10, 10]`.

### `getFillColor` / `getLineColor` (`Accessor<Color>`, optional)

Fill and outline colors. Both default to `[0, 0, 0, 255]`.

### `getLineWidth` (`Accessor<number>`, optional)

Outline width. Default: `1`.

### `lineWidthUnits` (`'meters' | 'common' | 'pixels'`, optional)

Units used by `getLineWidth`. Default: `'pixels'`.

### `widthMinPixels` / `widthMaxPixels` / `heightMinPixels` / `sizeMaxPixels` (Number, optional)

Pixel clamps applied after projecting block size.

### `widthCutoffPixels` (Number, optional)

Hides a block when its projected source width is below this threshold. The cutoff is applied before
`widthMinPixels`, so very small intervals can be omitted instead of expanded to the minimum width.
Default: `0`.

### `strokeOffset` (Number, optional)

Aligns the outline relative to the block bounds: `0` keeps the outline inside, `0.5` centers it on
the boundary, and `1` places it outside. Default: `0`.

### `getOpacity` (`Accessor<number>`, optional)

Per-block multiplier applied after the fill and outline alpha channels. Default: `1`.

### `overrideColor` / `getColorOverride` (`Color` / `Accessor<number>`, optional)

`getColorOverride` selects whether an instance keeps its original RGB colors (`0`) or uses
`overrideColor` (`1`). Fill and outline alpha channels are preserved. Defaults: `[0, 0, 0, 255]`
and `0`.

## Source

[modules/infovis-layers/src/layers/block-layer/block-layer.ts](https://github.com/visgl/deck.gl-community/tree/9.3-release/modules/infovis-layers/src/layers/block-layer/block-layer.ts)
