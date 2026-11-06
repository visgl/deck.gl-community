# Wind Garden

One `WindEffect` bends a whole scene: a `TreeLayer` grove, and deck.gl's own `SimpleMeshLayer`,
`ColumnLayer`, `GridCellLayer` and `PointCloudLayer` through `WindExtension`. Every layer turns
with the wind direction and swells with its gusts on the same clock.

The **WindEffect** panel sets the scene's wind:

- **WindEffect**: the wind source, speed in m/s at 10 m, direction, gusts and turbulence, and a
  toggle that freezes the clock.
  - **Uniform**: one speed and direction everywhere. The bend follows `getWindStrength(speed)`.
  - **Stations**: five synthetic weather stations around the garden, a geo-layers `WindField`
    built with `createWindField`. The effect takes the central station's wind; each tree pins the
    strength sampled at its own position (`getLocalWindStrengths`), and the other layers scale
    their flex the same way. The calm southwest corner bends least. Hover an object to read its
    local speed. `station-wind.ts` converts geo-layers' directions to `WindEffect` bearings.
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
