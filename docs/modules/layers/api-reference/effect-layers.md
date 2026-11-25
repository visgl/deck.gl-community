# Effect layers

Import these visual layers from `@deck.gl-community/layers/effect-layers`.

| Layer | Input and purpose |
| --- | --- |
| `GlowPointLayer` | Borrowed GPU rows containing XYZ position, linear RGB tint, opacity, and a feature index. Draws additive point halos. |
| `FireflyLayer` | The same rows as GlowPointLayer, with wandering and pulsing enabled. |
| `SketchEdgeLayer` | Borrowed GPU rows containing XYZ endpoints, a feature index, and a stable seed. Draws sketch-style strokes. |
| `WeatherParticleLayer` | Rain or snow rendered around the camera, with optional fog. |
| `FlowParticleLayer` | Borrowed output from a luma.gl flow simulation. Draws streaks along the current particle motion. |
| `WaterSurfaceLayer` | Borrowed triangle positions in local east, north, and up metres. Applies water or river shading. |

```ts
import {FireflyLayer} from '@deck.gl-community/layers/effect-layers';

const layer = new FireflyLayer({
  id: 'fireflies',
  points: pointBuffer,
  pointCount,
  coordinateSystem: 'meter-offsets',
  coordinateOrigin: [longitude, latitude, 0],
  time: () => elapsedSeconds
});
```

Keep borrowed buffers alive while the layers render them and release them after the layers
are finalized. Install `@luma.gl/graph` when using the experimental flow simulation output.
The application advances that simulation and owns its buffers.

[Original implementations](https://github.com/visgl/deck.gl/tree/66542993e71b937f83cf07c81fda14e317075b10/modules/proposals/src/layers)

The [Sketch Edges example](https://github.com/visgl/deck.gl-community/tree/master/examples/layers/sketch-edges) renders an interactive riverfront with architectural outlines and PBR building materials.

## Scene effects

Import `SceneBufferEffect`, `ShaderPassEffect`, and `SceneShaderPassEffect` from
`@deck.gl-community/layers/effects`. Install the matching `@luma.gl/anari` peer
for scene capture. `SceneBufferEffect` captures per-view color, depth, normals,
and optional motion. `ShaderPassEffect` applies a luma.gl shader pass to the
frame. `SceneShaderPassEffect` supplies scene buffers and camera information
to a shader pass.

See [Scene Buffers](/examples/layers/scene-buffers), [Depth of Field](/examples/layers/depth-of-field),
and [Global Illumination](/examples/layers/global-illumination) for working configurations.
