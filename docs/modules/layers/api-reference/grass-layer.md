---
title: GrassLayer
---

# GrassLayer

`GrassLayer` renders curved blades inside rectangular patches on WebGL2 and WebGPU. Each data row places a patch and controls its height, color, and coverage. The GPU generates a repeatable blade pattern from the patch's seed. Panning and zooming keep the blades in place.

```ts
import {GrassLayer} from '@deck.gl-community/layers';

new GrassLayer({
  id: 'meadow',
  data: [{position: [-122.43, 37.76, 0] as const, seed: 12}],
  getPosition: row => row.position,
  getSeed: row => row.seed,
  getSize: [4, 4],
  getHeight: 0.3,
  getDensity: 0.8,
  windDirection: 55,
  windStrength: 0.35
});
```

The layer accepts standard deck.gl layer props. With `pickable: true`, picking returns the patch row.

| Prop | Default | Description |
| --- | --- | --- |
| `getPosition` | `row => row.position` | Patch center in the layer's coordinate system. The supplied elevation sets the blade bases. |
| `getSize` | `[4, 4]` | Width east and length north in meters. |
| `getHeight` | `0.22` | Nominal blade height in meters. |
| `getBladeWidth` | `0.025` | Nominal blade width in meters. |
| `getColor` | `[86, 123, 49, 255]` | Base color as an sRGB byte tuple. |
| `getDensity` | `1` | Fraction of the patch's blade budget, from zero to one. |
| `getSeed` | `0` | Integer from 0 to 16,777,215. Change the seed to vary the blade pattern. |
| `bladesPerPatch` | `1024` | Blade budget per patch, from 1 to 4096. |
| `windDirection` | `90` | Bearing in degrees clockwise from north. |
| `windStrength` | `0` | Wind bend, from zero to one. |
| `windTime` | `null` | Clock in seconds. Set an explicit value to reproduce a pose, or use the deck.gl timeline. |

A patch represents a level surface. Use each patch's position to place it at the desired elevation. For large areas, submit patches near the camera and use smaller blade budgets as needed.

Try the [interactive example](/examples/layers/grass-layer).
