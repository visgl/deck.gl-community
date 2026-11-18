---
title: FogExtension
---

# FogExtension

`FogExtension` blends a layer toward a fog color as the distance from the camera increases.
It works on WebGL2 layers that call deck.gl's projection and color shader hooks. Add it to each
layer that should be affected, and use the same color and density across those layers.

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {FogExtension, type FogExtensionProps} from '@deck.gl-community/layers';

const trees = new ScatterplotLayer<[number, number], FogExtensionProps>({
  id: 'forest-observations',
  data: [[-122.45, 37.76], [-122.43, 37.77]],
  getPosition: position => position,
  getRadius: 75,
  getFillColor: [38, 105, 56],
  extensions: [new FogExtension()],
  fogColor: [192, 206, 219],
  fogDensity: 0.001
});
```

Use a pitched view to see the distance change across the scene.

| Prop | Default | Meaning |
| --- | --- | --- |
| `fogColor` | `[192, 206, 219]` | RGB fog color, with channels from 0 to 255. |
| `fogDensity` | `0.001` | Extinction per meter. At the default density, the original color contributes about 37% at 1 km. Set it to zero for a clear view. |
