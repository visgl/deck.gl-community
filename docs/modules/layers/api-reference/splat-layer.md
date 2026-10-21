# SplatLayer

Prepared anisotropic 3D Gaussians, instanced by owning data rows. `SplatLayer` is a `CompositeLayer` built on deck.gl, luma.gl and math.gl, with WebGL2 and WebGPU shaders. It supports planar Cartesian and Web Mercator views in the unwrapped world; wrapped world copies (`MapView.repeat`) report an explicit error, and `GlobeView` reports an explicit unsupported-projection error. It accepts a direct prepared asset or instance rows whose assets are resolved by `getSource`, and shares immutable template buffers per device; file decoding, training, streaming and spherical harmonics are outside this API.

```ts
import {SplatLayer, createSplatHierarchy, type SplatSource} from '@deck.gl-community/layers';

const source: SplatSource = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([0.3, 0.12, 0.02]),
  rotations: new Float32Array([1, 0, 0, 0]), // WXYZ
  colors: new Uint8Array([80, 160, 50, 255]),
  opacities: new Float32Array([0.85])
};

new SplatLayer({
  data: objects,
  getSource: source,
  transparency: 'weighted',
  getPosition: object => object.position,
  getScale: object => object.scale,
  getColor: [255, 255, 255, 255],
  pickable: true
});
```

## Input forms

Supply one decoded asset directly, or use `data` for owner rows and `getSource` for their reusable
assets. `getSource` defaults to `d => d.splats`; it accepts a constant prepared asset or an accessor.
Repeated rows share the same immutable source upload while keeping distinct positions and picking.

```ts
// One asset, with one implicit owner {splats: source, position: [0, 0, 0]}.
new SplatLayer({data: source, getPosition: [longitude, latitude, altitude]});

// Several copies of the same asset.
new SplatLayer({data: objects, getSource: source, getPosition: d => d.position});

// Heterogeneous prepared assets, selected by the original owner row.
new SplatLayer({data: objects, getSource: d => templates[d.kind], getPosition: d => d.position});
```

Associate a supplied hierarchy with its asset using `PreparedSplatData`:

```ts
const asset = {type: 'prepared-splats' as const, source, hierarchy: createSplatHierarchy(source, [0.2, 0.5, 1])};
new SplatLayer({data: objects, getSource: asset});
```

Keep the descriptor stable with the source and hierarchy. A direct asset's function accessors and
picking receive its implicit owner; row accessors and picking receive the original row and index.
All supported forms accept `transparency: 'weighted'` (the default) or `'sorted'`. Sorted mode
orders individual selected Gaussians across prepared sources and owners for each viewport,
including their transforms and wind pose. Streaming RAD, file decoding and SH remain outside
this prepared API.

The legacy `data: objects, source, hierarchy` form remains supported. It conflicts with direct
asset data or an explicit `getSource`; place new hierarchies in the prepared descriptor instead.
Empty owner arrays render no implicit instance. Camera changes do not rerun `getSource`; use
`updateTriggers.getSource` when its result changes without replacing data.

## Source

Sources are immutable. Replace the source object when its arrays change. Positions and positive one-sigma scales contain XYZ triples. Rotations contain normalized WXYZ quaternions. Colors contain RGBA bytes or linear RGBA floats; float alpha and peak opacity must be in `[0, 1]`. Optional XYZ normals affect lighting, independently of covariance. Authored normals remain in the local foliage frame instead of flipping toward the camera at grazing angles. All arrays have the same Gaussian count. Invalid lengths, non-finite values, zero scales and non-unit quaternions fail before upload.

The source is local to each owner. `getPosition` uses the layer coordinate system. `getScale`, `getOrientation` (pitch/yaw/roll in degrees) and `getTranslation` transform the local template; translation follows scale and rotation and uses metres in geospatial views. Picking returns the source data object and original index, including after refinement and culling. Fragments below alpha `0.08` do not intercept picking.

## Properties

Inherits `CompositeLayer` properties. Accessors receive the original data object and accessor context. Use `updateTriggers` when an accessor's result changes without replacing data, following deck.gl conventions.

**Budgets are submission targets, not GPU memory limits.** `maxSplats` and `maxTotalSplats` cap
settled selections when the coarsest visible coverage fits. Every visible owner
retains a coverage floor, and optical transitions may temporarily need bounded overlap above the
target. Immutable source buffers and cached assets have separate residency costs; these properties
do not bound allocated GPU bytes. See [Bounded refinement](#bounded-refinement) for the tradeoffs.

| Property | Default | Meaning |
| --- | --- | --- |
| `data` | `[]` | Direct prepared asset or original instance rows. |
| `getSource` | `d => d.splats` | Constant prepared asset or per-row accessor. |
| `source` | `null` | Compatibility template for owner rows without explicit `getSource`. |
| `transparency` | `weighted` | Approximate weighted optical blending, or `sorted` for back-to-front alpha blending across prepared Gaussians. |
| `getPosition` | `d => d.position` | Owner position in the layer coordinate system. |
| `getOrientation` | `[0, 0, 0]` | Pitch, yaw and roll in degrees. |
| `getScale` | `[1, 1, 1]` | Local XYZ scale. |
| `getTransformMatrix` | `null` | Finite affine column-major 4x4 source-local transform; overrides orientation, scale and translation. Includes covariance and culling bounds. |
| `getTranslation` | `[0, 0, 0]` | Translation after orientation and scale. |
| `getColor` | `[255, 255, 255, 255]` | Owner RGBA tint. Alpha multiplies template alpha and opacity once. |
| `material` | Ambient/diffuse | Phong material with supplied normals. |
| `kernelVariance` | `0.3` | Device-pixel variance added to projected covariance. Opacity is compensated by the covariance determinant ratio. |
| `support` | `3` | Gaussian support in standard deviations, between 1 and 6. |
| `alphaCutoff` | `1/255` | Minimum retained fragment contribution. |
| `hierarchy` | `null` | Finest source at error zero, followed by increasing finite local error bounds. |
| `maxTotalSplats` | `Infinity` | Aggregate settled submission cap across participating visible SplatLayers on one deck/device. The strictest supplied value wins. |
| `pixelError` | `0.75` | Device-pixel bound used to select a spatial aggregate. |
| `getDeformation` | `[1, 0, 0]` | Bend height, stable phase and flex multiplier. |
| `deformationStrength` | `0` | Bend amplitude as a fraction of owner height. |
| `deformationTime` | `null` | Seconds; null uses the shared deck timeline. |

## Rendering and refinement

The shader transforms all three covariance axes and projects an oriented ellipse using the projection Jacobian. Pixel filtering broadens covariance and reduces peak alpha to conserve projected coverage. Wind combines a clamped cubic bending shape with a spatial crown mode. It transforms both the centre and covariance with the same analytic Jacobian used by the tree meshes; normals use the inverse transpose. This is a reduced animation field, not a structural dynamics solver.

A shared effect isolates each view’s opaque depth and accumulation, including overlapping views. WebGL2 supports cleared overlays. On WebGPU, `View.clear` produces an explicit error because the current deck.gl path opens a nested render pass; overlapping views without clearing composite normally. It captures opaque depth. Sorted mode builds a shared selected working buffer and sorts Gaussian centers back to front each frame while retaining covariance, lighting, deformation and owner picking. It uses additional memory proportional to the selected Gaussian count and CPU sorting time. Sorted sources share one order across owners and layers. Compatible shading inputs share a draw even when sources use different opacity representations. Working buffers and models persist through refinement changes; optical fade weights update independently of geometry. If weighted and sorted sources are mixed, the sorted result composites over the weighted result. Weighted mode accumulates Gaussian colors and logarithmic optical depth. WebGL2 writes both targets in one additive MRT geometry pass; WebGPU uses an additive color pass plus a dedicated additive optical-depth pass because its current attachment blend mapping is single-target. It resolves premultiplied foliage in the ordinary draw pass, preserving mesh occlusion and downstream postprocessing. **Place opaque layers before Gaussian layers.** Weighted color blending is an order-independent approximation, not exact sorted alpha blending; layered colors can differ from a trained, depth-sorted splat renderer. Color accumulation requires renderable RGBA16F, and optical depth uses R16F. The extra opaque depth pass and Gaussian projection still cost more than opaque meshes for comparable geometry.

`createSplatHierarchy(source, increasingCellSizes, minimumSplats)` builds spatial covariance aggregates once. Each level preserves weighted position, covariance, color and approximate orientation-averaged projected optical mass; its error bounds centre displacement, not every possible view-dependent silhouette. `minimumSplats` defaults to one; a positive floor retains that many widest-axis spatial clusters at the terminal level instead of collapsing the complete source to one covariance proxy. Coarse levels store nonnegative `opticalDepths`, so many opaque leaves do not collapse into a capped opacity and disappear. The original source remains available for close views. Adjacent levels crossfade in optical depth. Refinement mixtures advance once per draw and persist across camera and quota changes, with normalized easing and a bounded per-frame step, including when wind is off. Interrupted changes start from the current mixture. The perspective derivative is bounded off-axis and regularized where Gaussian support crosses the eye; near-plane coverage fades instead of cutting a large billboard abruptly. Owner transforms and a bounding-volume hierarchy are prepared once per data/accessor change. Camera updates traverse visible bounds and measure the perspective projection Jacobian at each surviving crown; they do not scan every owner or rebuild the spatial index. Multi-view visibility uses the union of viewport frusta. The hierarchy reduces far-field vertex work without a tree detail control. Mercator bounds use owner-local metre scales and survive changes to camera latitude. Frustum planes include the pixel-filter footprint. Unchanged owner lists retain their GPU attributes; changing LOD coverage updates only the coverage buffer. Changed membership uploads bounded contiguous ranges, avoiding excessive small driver writes. Finest sources with very many Gaussians still have substantial vertex and fill cost.

## Bounded refinement

`maxSplats` defaults to `Infinity`, preserving the supplied screen-error selection. Finite budgets prioritize each owner's remaining projected error to its requested hierarchy target across all participating source and instance roots; added Gaussian count is a hard feasibility constraint, not a quality discount. Each visible owner competes independently, even when many owners share one source template, so near and far instances can use different hierarchy levels. Composing layers can share an internal parent quota across their prepared children, instead of dividing it by source row counts. The allocator reserves a tenth of a finite quota for optical transitions and favors retained detail within a 20% priority band. Promotions use the reserved overlap capacity. If every fade is blocked while its target fits, the smallest missing owner representation may temporarily exceed the quota until its old representation retires. Forced reductions use the same bounded overlap allowance. Optical coverage stays normalized throughout. The first shared-cap allocation may present its budgeted selection immediately; every later allocation, including a broad camera retarget, retains the prior optical weights until its fade completes. Settled selections use the remaining allocation. Every visible owner remains present. A budget below the coarsest coverage floor cannot be honored without source/spatial aggregation. These limits count Gaussian submissions, not fragments, GPU bytes or hardware time.

`maxRenderPixels` (default `Infinity`) limits aggregate accumulation-target pixels across views. The smallest limit among visible draw sources applies to the common pass. Its opaque occlusion capture uses the same target size, then the Gaussian result resolves at host resolution with linear sampling. Opaque drawing and picking retain host resolution. A tighter pixel limit can take one frame to apply while parent visibility expands to cover the broader filter. Lower target sizes soften foliage and reduce occlusion precision; this controls fragment work independently of Gaussian count.

Requested screen error is based on projected support that can occupy the viewport. A support centered in, or spanning, the viewport retains full detail; a crown that only clips a viewport corner cannot claim the same refinement budget. This does not alter conservative frustum visibility.

`foveationStrength` defaults to zero. A positive value only ranks otherwise requested refinements when a finite submission budget is active. At one, central weight is one and peripheral weight smoothly approaches 0.15. It does not lower the requested hierarchy for a visible owner, and it is screen-center foveation, not eye tracking.

Prepared `SplatSource.opticalDepths` optionally overrides peak `opacities`: transmission is `exp(-opticalDepth * Gaussian * coverageWeight)`. Color alpha scales this density once. This avoids saturation loss in dense aggregates and needs no additional vertex attribute. Authored sources without optical depths retain peak-alpha Gaussian semantics. Covariance aggregation preserves approximate projected mass averaged over orientation; it does not exactly reproduce every view of anisotropic leaves.

## Statistics

Read `layer.splatStats` after deck initializes the layer. It exposes `sourceCount`,
`visibleInstances`, `renderedSplats`, `coverageFloor`, and `refiningInstances`. Submission counts include optical transition
overlap. Source counts describe resolved source/hierarchy pairs, rather than GPU byte residency.
These counters do not establish a hard GPU memory cap. Sorted mode allocates an additional selected working buffer.
