# ZoomableTextLayer

`ZoomableTextLayer` wraps Deck.gl's `TextLayer` to optionally scale font sizes
with the current viewport zoom. It also maintains a minimal character set so the
text atlas only contains glyphs that appear in the rendered labels.

## Usage

```js
import {ZoomableTextLayer} from '@deck.gl-community/graph-layers';

const layer = new ZoomableTextLayer({
  id: 'zoomable-text',
  data: labels,
  getPosition: (label) => label.position,
  getText: (label) => label.text,
  getColor: (label) => label.color,
  getSize: (label) => label.size,
  scaleWithZoom: true
});
```

When `scaleWithZoom` is true, the layer multiplies `sizeScale` by
`2 ** (viewport.zoom - 1)` and includes the current zoom level in the size update
trigger. This keeps text readable across zoom levels while avoiding atlas
regeneration.

## Properties

All [Deck.gl `TextLayer` props](https://deck.gl/docs/api-reference/layers/text-layer)
apply. Additional options include:

### `scaleWithZoom` (boolean, optional)

When true, text size responds to viewport zoom and the layer re-evaluates when
the zoom changes.

### `getText` (function or string, required)

Accessor returning the label content. The layer builds a unique character set
from the resolved text values.

### `textMaxWidth` / `textWordBreak` / `textWordUnits` / `textSizeMinPixels` (optional)

Convenience props forwarded to the underlying `TextLayer` with defaults of `12`,
`'break-all'`, `'pixels'`, and `9` respectively.
