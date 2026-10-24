# Wind Garden

One `WindEffect` bends a whole scene: a `TreeLayer` grove, and deck.gl's own `SimpleMeshLayer`,
`ColumnLayer`, `GridCellLayer` and `PointCloudLayer` through `WindExtension`. Every layer turns
with the wind direction and swells with its gusts on the same clock.

The **WindEffect** panel sets the scene's wind:

- **WindEffect**: strength, direction, gusts and turbulence, and a toggle that freezes the clock.
- **Layers**: show or hide each layer kind.
- **Lighting**: a shadow-casting sun (WebGL2). Shadows bend with the geometry.

`WindExtension` is WebGL2 only: deck.gl 9.4's WGSL layers have no vertex filter hook. The tree
layer bends on WebGPU too.

## Run

From the repository root:

```bash
yarn
cd examples/layers/wind-garden
yarn start
```
