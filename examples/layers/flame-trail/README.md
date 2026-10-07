# FlameTrailLayer

Two moving flame trails over shaded hills and a curved ridge. The shared example panel
contains only **Length**, **Width**, and **Color**. Drag to orbit; scroll to zoom.
No API keys or external data are required.

From the repository root:

```sh
yarn
yarn workspace @deck.gl-community/example-flame-trail start-local
```

Use the standard WebGL2 / WebGPU tabs to switch rendering devices. The two flame
heads travel half a circuit apart so one remains active when the other loops.
Width also controls flame height; color tints the flame palette. The example
advances the normal TripsLayer `currentTime` prop. Flame turbulence and embers
animate automatically inside the layer.

The shaded terrain makes peaks and gullies visible without a wireframe. Orbit
the view to inspect the flames following the slopes. TerrainExtension uses
`offset` to fit the flame footprint while preserving the rising volume.
WebGPU height maps require the unreleased
[upstream terrain port](https://github.com/visgl/deck.gl/pull/10751).
To preview that source on both backends:

```sh
DECK_GL_SOURCE=/path/to/deck.gl yarn workspace @deck.gl-community/example-flame-trail start-local
```

Without that override, WebGPU uses XYZ elevations sampled once from the mesh
triangles. XYZ fitting follows the centerline; the GPU height map also fits
across the full flame footprint. WebGPU texture `drape` mode is not supported.
