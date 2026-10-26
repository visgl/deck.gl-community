# SplatLayer

`SplatLayer` renders prepared, anisotropic 3D Gaussians ("splats"), instanced per data row.
Rows can share one immutable source while keeping their own position, transform, color and
picking. Distant instances can use coarser levels of a hierarchy within a Gaussian budget. It
runs on WebGL2 and WebGPU, and [`TreeLayer`](./tree-layer.md) uses it for foliage.

`SplatLayer` draws decoded Gaussians only. File loading, training, streaming and spherical
harmonics are out of scope.

## Usage

```ts
import {SplatLayer, type SplatSource} from '@deck.gl-community/layers';

const source: SplatSource = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([0.3, 0.12, 0.02]),
  rotations: new Float32Array([1, 0, 0, 0]), // WXYZ
  colors: new Uint8Array([80, 160, 50, 255]),
  opacities: new Float32Array([0.85])
};

new SplatLayer({
  id: 'splats',
  data: objects,
  getSource: source,
  getPosition: d => d.position,
  getScale: d => d.scale,
  pickable: true
});
```

`data` can also be a single source, and `getSource` can select a source per row:

```ts
// One source at one position.
new SplatLayer({data: source, getPosition: [longitude, latitude, 0]});

// A different source per row.
new SplatLayer({data: objects, getSource: d => templates[d.kind]});
```

### Levels of detail

Build a hierarchy once with `createSplatHierarchy` and pass it alongside the source:

```ts
import {createSplatHierarchy} from '@deck.gl-community/layers';

const asset = {
  type: 'prepared-splats' as const,
  source,
  hierarchy: createSplatHierarchy(source, [0.2, 0.5, 1])
};

new SplatLayer({data: objects, getSource: asset, maxSplats: 50_000});
```

`createSplatHierarchy(source, cellSizes, minimumSplats = 1)` merges Gaussians into
increasingly coarse spatial cells. Each visible instance uses the coarsest level that stays
within `pixelError`. A finite `maxSplats` gives detail to the instances that gain the most, and
level changes crossfade.

## Properties

Inherits all [`CompositeLayer`](https://deck.gl/docs/api-reference/core/composite-layer)
properties. Picking and `highlightedObjectIndex` use the source row. Use `updateTriggers` when an
accessor's result changes without new `data`, and replace a source object instead of mutating its
arrays.

### Data

| Property | Default | Description |
| --- | --- | --- |
| `data` | `[]` | Instance rows, or one prepared source. |
| `getSource` | `d => d.splats` | A [`SplatSource`](#splatsource) or prepared asset, constant or per row. |
| `getPosition` | `d => d.position` | Instance position. |
| `getOrientation` | `[0, 0, 0]` | Pitch, yaw and roll in degrees. |
| `getScale` | `[1, 1, 1]` | XYZ scale. |
| `getTranslation` | `[0, 0, 0]` | Offset after orientation and scale. Metres in geospatial views. |
| `getTransformMatrix` | `null` | Affine 4×4 matrix. Replaces orientation, scale and translation. |
| `getColor` | white | RGBA tint. Alpha multiplies opacity. |
| `getCoverageWeight` | `1` | Opacity multiplier, for fading instances in and out. |

### Rendering

| Property | Default | Description |
| --- | --- | --- |
| `transparency` | `'weighted'` | Unsorted blending, or `'sorted'` for exact alpha blending at extra cost. |
| `material` | Phong | Lighting, using the source normals. |
| `kernelVariance` | `0.3` | Anti-aliasing blur added to each Gaussian, in pixels. |
| `support` | `3` | Gaussian extent in standard deviations, `1`–`6`. |
| `alphaCutoff` | `1/255` | Fragments below this opacity are discarded. |

### Level of detail

| Property | Default | Description |
| --- | --- | --- |
| `pixelError` | `0.75` | Allowed screen error in pixels when choosing a hierarchy level. |
| `maxSplats` | `Infinity` | Splat budget for this layer. Visible instances keep their coarsest level. |
| `maxTotalSplats` | `Infinity` | Budget shared by all SplatLayers in a deck. The strictest value wins. |
| `maxRenderPixels` | `Infinity` | Pixel cap for splat rendering. Lower values trade sharpness for speed. |
| `foveationStrength` | `0` | `0`–`1`. Under a budget, favors instances near the screen center. |

Budgets count submitted Gaussians, not GPU memory.

SplatLayer draws its Gaussians where the source and transforms put them. Motion such as wind
belongs to the layer that owns the objects: [`TreeLayer`](./tree-layer.md)'s canopy bends its
Gaussians with the [`WindEffect`](./wind-effect.md).

## Types

### SplatSource

All arrays describe the same number of Gaussians and are `Float32Array`s, except `colors`.
Invalid sources throw before upload.

| Field | Description |
| --- | --- |
| `positions` | XYZ centers. |
| `scales` | Positive XYZ one-sigma radii. |
| `rotations` | Unit WXYZ quaternions. |
| `colors` | RGBA bytes (`Uint8Array`) or linear RGBA floats. |
| `opacities` | Peak opacity, `0`–`1`. |
| `opticalDepths` | Optional optical density. Overrides `opacities` to keep dense aggregates opaque. |
| `normals` | Optional XYZ normals for lighting. |

## Statistics

After initialization, `layer.splatStats` reports `sourceCount`, `visibleInstances`,
`renderedSplats`, `coverageFloor` and `refiningInstances`.

## Limitations

- Supports `MapView`, `GlobeView` and Cartesian views. With `MapView.repeat`, splats render in
  the primary world copy only.
- On `GlobeView`, owner-local metres point east, north and up, so a pose is unchanged when the
  view switches to Web Mercator above zoom 12. Gaussians behind the sea-level horizon are hidden.
  Positions resolve about 0.4 m at the surface, like deck.gl's own globe layers.
- deck.gl 9.4 shadow maps do not fit `GlobeView`: a `_shadow: true` light darkens every layer on it.
- deck.gl `LightingEffect` shadows work on WebGL2 only.
- Place opaque layers before splat layers so that they occlude splats.
- Weighted transparency approximates alpha blending. Overlapping colors can differ from a
  depth-sorted renderer.
- Requires renderable `RGBA16F` and `R16F` textures.
- On WebGPU, `View.clear` is not supported.

## Source

[modules/layers/src/splat-layer](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/splat-layer)
