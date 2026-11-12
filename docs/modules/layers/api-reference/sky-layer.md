---
title: SkyLayer
---

# SkyLayer

`SkyLayer` renders a procedural clear-sky background with an adjustable sun and haze. It models Rayleigh and aerosol scattering with ozone absorption, follows the camera's orientation, and draws at the far plane without writing depth.

```ts
import {Deck, FirstPersonView} from '@deck.gl/core';
import {SkyLayer} from '@deck.gl-community/layers';

new Deck({
  views: new FirstPersonView(),
  controller: true,
  initialViewState: {position: [0, 0, 1.7], bearing: 0, pitch: -9},
  layers: [new SkyLayer({id: 'sky', sunDirection: [0, 1, 0.25], aerosolOpticalDepth: 0.18})]
});
```

| Prop | Default | Description |
| --- | --- | --- |
| `sunDirection` | `[0, 1, 0.35]` | Direction toward the sun in east, north, up order. The layer normalizes it. |
| `aerosolOpticalDepth` | `0.12` | Aerosol optical depth at 550 nm, from 0 to 2. Higher values increase haze. |
| `exposure` | `1` | Brightness multiplier before display mapping, from 0 to 32. |

For Z-up Cartesian views, the axes correspond to X, Y, Z. Y-up `OrbitView` uses X, −Z, Y. In `GlobeView`, directions use the local tangent frame at the viewport center. The sky models a view from the surface.

The layer provides background color on WebGL2 and WebGPU. Configure a deck.gl `LightingEffect` separately to light the foreground. Draw the sky before translucent scene layers so they blend against it.

Try the [SkyLayer example](/examples/layers/sky).
