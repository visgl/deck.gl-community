# FlowPathLayer

`FlowPathLayer` extends Deck.gl's `LineLayer` to add instanced attributes for
flow animations. It introduces `getSpeed` and `getTailLength` accessors so custom
shaders can animate particle trails along each segment.

## Usage

```js
import {FlowPathLayer} from '@deck.gl-community/graph-layers';

const layer = new FlowPathLayer({
  id: 'flow-paths',
  data: edges,
  getSourcePosition: (edge) => edge.source,
  getTargetPosition: (edge) => edge.target,
  getColor: (edge) => edge.color,
  getWidth: (edge) => edge.width,
  getSpeed: (edge) => edge.speed,
  getTailLength: (edge) => edge.tailLength
});
```

The layer adds instanced `speeds` and `tailLengths` attributes on top of the
standard `LineLayer` attributes. Animation currently requires wiring transform
feedback manually; the built-in `setupTransformFeedback` and `draw` stubs throw a
`Not implemented` error.

## Properties

All [`LineLayer` props](https://deck.gl/docs/api-reference/layers/line-layer)
apply. Additional accessors include:

### `getSpeed` (function or number, optional)

Returns a scalar speed for each segment. Values are written to the instanced
`instanceSpeeds` attribute and default to `0`.

### `getTailLength` (function or number, optional)

Controls how long the animated tail should be. Written to the
`instanceTailLengths` attribute and defaults to `1`.

### `fp64` (boolean, optional)

When toggled, the layer reinitializes its model with 64-bit projection support so
long lines remain precise at high zoom levels.
