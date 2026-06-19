import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# AnimationLayer

<LayerLiveExample highlight="animation-layer" />

Runnable example: [Infovis layer primitives](/examples/infovis-layers/layer-primitives).

Animates one child deck.gl layer by cloning it with props resolved from a frame
schedule. Use it for simple pulse, reveal, and emphasis effects without placing
animation state inside each datum.

```ts
import {AnimationLayer} from '@deck.gl-community/infovis-layers';

const layer = new AnimationLayer({
  id: 'selected-block-pulse',
  layer: selectedBlockLayer,
  repeat: Number.POSITIVE_INFINITY,
  frames: {
    type: 'sequence',
    frames: [
      {duration: 900, props: {opacity: 0.35}},
      {duration: 900, props: {opacity: 1}}
    ]
  }
});
```

## Properties

Inherits from all [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer) properties.

### `layer` (`Layer`, required)

Base child layer cloned for each animation frame.

### `frames` (`AnimationFramesGroup`, required)

Frame schedule. Groups can run frames in `sequence`, `concurrence`, or `stagger`
mode, and each frame supplies destination props, duration, optional delay, and
optional easing.

### `repeat` (`number`, optional)

Number of additional iterations after the first animation pass. Default: `0`.
Use `Number.POSITIVE_INFINITY` for a continuous animation.

### `repeatType` (`'loop' | 'reverse'`, optional)

Whether repeated frames restart from the first frame or alternate in reverse.
Default: `'loop'`.

### `repeatDelay` (`number`, optional)

Delay in milliseconds before each repeated iteration. Default: `0`.

## Source

[modules/infovis-layers/src/layers/animation-layer/animation-layer.ts](https://github.com/visgl/deck.gl-community/tree/master/modules/infovis-layers/src/layers/animation-layer/animation-layer.ts)
