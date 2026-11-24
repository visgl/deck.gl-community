# Wind Garden

One `WindEffect` bends a whole scene: a `TreeLayer` grove, and deck.gl's own `SimpleMeshLayer`,
`ColumnLayer`, `GridCellLayer` and `PointCloudLayer` through `WindExtension`. All five layer types
follow the same strength, bearing and clock. The grove uses its native spatial gusts.

The **WindEffect** panel sets the scene's wind:

- **WindEffect**: the wind source, speed in m/s at 10 m, direction, gusts and turbulence, and a
  toggle that freezes the clock.
  - **Uniform**: the Wind and Wind direction controls set the effect. The bend follows
    `getWindStrength(speed)`.
  - **Stations**: five synthetic weather stations around the garden, a geo-layers `WindField`
    built with `createWindField`. The effect takes the wind they report at the garden's centre,
    and the whole garden bends with it. `station-wind.ts` converts geo-layers' directions to
    `WindEffect` bearings.
- **Layers**: show or hide each layer kind.
- **Lighting**: a shadow-casting sun (WebGL2). Shadows bend with the geometry.

`WindExtension` uses the stock WebGL2 layer vertex hook. Trees bend on WebGL2 and WebGPU.

## Run

From the repository root:

```bash
yarn
cd examples/layers/wind-garden
yarn start
```
