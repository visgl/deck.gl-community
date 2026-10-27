# isGlobeViewport

`isGlobeViewport(viewport)` returns `true` when a deck.gl viewport draws a 3D globe. This is a `GlobeView` below zoom 12. Above zoom 12, `GlobeView` uses a Web Mercator viewport, and the function returns `false`.

```ts
import {isGlobeViewport} from '@deck.gl-community/geo-layers';

const geographic = isGlobeViewport(this.context.viewport);
```

## Why not `viewport.resolution`

In deck.gl 9.4, only `GlobeViewport` sets `resolution`. deck.gl v10 makes `resolution` the subdivision detail of every viewport and sets it to `0` by default, `GlobeView` included. A truthiness test of `resolution` then reads every globe as a flat map.

`isGlobeViewport` compares `viewport.projectionMode` with deck.gl's `PROJECTION_MODE.GLOBE` (`2`). Every deck.gl 9.4 and v10 viewport defines `projectionMode`. When an object has no numeric `projectionMode`, the function falls back to `instanceof GlobeViewport`.
