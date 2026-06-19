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
  getLineWidth: 1
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

### `widthMinPixels` / `heightMinPixels` / `sizeMaxPixels` (Number, optional)

Pixel clamps applied after projecting block size.

## Source

[modules/infovis-layers/src/layers/block-layer/block-layer.ts](https://github.com/visgl/deck.gl-community/tree/master/modules/infovis-layers/src/layers/block-layer/block-layer.ts)
