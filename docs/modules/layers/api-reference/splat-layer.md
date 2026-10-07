# SplatLayer

Anisotropic 3D Gaussians and native RAD scenes, instanced by owning data rows. `SplatLayer` is a `CompositeLayer` built on deck.gl, luma.gl and math.gl, with WebGL2 and WebGPU shaders. It accepts decoded Gaussian assets, URL/Blob scene assets, or owner rows whose assets are resolved by `getSource`. Prepared foliage uses weighted blending; scenes use shared global ordering and native source-page residency on the host deck/device. Training remains outside this API.

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
`transparency: 'auto'` selects weighted blending for prepared assets and sorted rendering for file/RAD scenes. Set `sorted` explicitly to combine static Gaussian assets with streamed scenes in the same ordering domain. Set `weighted` explicitly for procedural foliage; it rejects file scenes.

The legacy `data: objects, source, hierarchy` form remains supported. It conflicts with direct
asset data or an explicit `getSource`; place new hierarchies in the prepared descriptor instead.
Empty owner arrays render no implicit instance. Camera changes do not rerun `getSource`; use
`updateTriggers.getSource` when its result changes without replacing data.

## Scene assets and installation

```ts
new SplatLayer({data: 'https://example.com/scene.rad', coordinateSystem: 'cartesian', maxSplats: 1_000_000, maxResidentSplats: 4_000_000});
new SplatLayer({data: {type: 'splats', url: blob, format: 'splat'}, coordinateSystem: 'cartesian'});
new SplatLayer({data: owners, getSource: d => d.asset, transparency: 'sorted', sortDomain: 'scene', coordinateSystem: 'cartesian'});
```

RAD URLs containing `.rad` and unmarked Blobs use native RAD decoding. For other URLs (including
signed URLs without a suffix), use `{type: 'rad', url}` or `{type: 'splats', url, format}` explicitly.
Static SPLAT, KSPLAT and SPZ decoding runs in a worker. RAD metadata, HTTP ranges, selection and
retained camera refinement run off-thread; immutable decoded source pages upload once and are
borrowed by every owner/view. The fetch adapter preserves range headers and cancellation signals.
RAD retains native hierarchy row IDs, directional SH and floating-point radiance.

This repository carries a Yarn compatibility patch for `@luma.gl/splats@9.4.2` pending its upstream
9.4 host-pass release. A fresh root `yarn` install applies it automatically. **Publishing this
community package requires that compatible luma release and removal of the repository patch.**
An npm consumer does not inherit root Yarn resolutions. The default worker URLs require an ESM
browser bundler. `workerFactory(type)` supports CommonJS or custom hosts; return a module Worker
for `rad` or `static` from the package's bundled `dist/splat-layer/scene/*-source-worker.js` files.
The layer owns and terminates each returned worker. Coit requires WebGPU; the exact CPU sorted
WebGL2 path is intended for smaller static/selected frontiers.

Sorted scenes currently require Cartesian views. The complete layer/owner affine transform is
included in covariance projection, and camera position is transformed to source space before SH.
Each viewport and `sortDomain` has one global ordering renderer. Owners retain original picking
identity even when source pages are shared. **Place opaque layers before the sorted domain and
keep its layers contiguous**; the renderer draws once into deck's existing color/depth pass.
The host owns the canvas, device, render pass and presentation. Separate domains do not intersort.
The first layer in a domain supplies draw `parameters`, `alphaCutoff`, `kernelVariance` and
`support`; keep those settings consistent across layers sharing that domain. Picking uses the
same appearance settings with its own depth state.
Sorted scene shaders output straight color and alpha. Their default draw parameters use
`blendColorSrcFactor: 'src-alpha'` and `depthWriteEnabled: false`; explicit layer `parameters`
override those defaults. Both backends apply blend factors together with their operations and
restore defaults when an override is removed.
Prepared hierarchies forced to sorted currently submit their finest source; weighted optical
hierarchy blending, wind/material lighting and foliage shadow passes remain on the prepared path.

`maxActiveSplats` is a Coit compatibility alias for `maxSplats`; conflicting finite values fail.
`maxSplats` controls per-layer scene refinement and `maxTotalSplats` shares the strictest host
submission grant with prepared layers. `maxResidentSplats` bounds retained RAD source rows with
an additional active-frontier transition allowance. Source pages and coarsest coverage are
indivisible; a limit below coverage cannot be achieved by dropping arbitrary rows. Multi-view
selection shares the source grant, pins the union of visible pages, and retains each view's
coherent frontier. Hidden owners stop scheduling; finalized owners release their references, and
last-owner removal aborts workers and destroys source/ordering/picking resources. Resident limits
count source rows rather than a hard byte or frame-time limit.

`onStatusChange(status)` reports loading, refinement, ready, budget-limited or error, including
active/source rows and pending/resident pages. A status notification describes the source asset;
multiple owners can share that asset. `splatStats.renderedSplats` reports the maximum submitted
count across viewports rather than summing repeated viewport presentation.

## Source

Sources are immutable. Replace the source object when its arrays change. Positions and positive one-sigma scales contain XYZ triples. Rotations contain normalized WXYZ quaternions. Colors contain RGBA bytes or linear RGBA floats; float alpha and peak opacity must be in `[0, 1]`. Optional XYZ normals affect lighting, independently of covariance. Authored normals remain in the local foliage frame instead of flipping toward the camera at grazing angles. All arrays have the same Gaussian count. Invalid lengths, non-finite values, zero scales and non-unit quaternions fail before upload.

The source is local to each owner. `getPosition` uses the layer coordinate system. `getScale`, `getOrientation` (pitch/yaw/roll in degrees) and `getTranslation` transform the local template; translation follows scale and rotation and uses metres in geospatial views. Picking returns the source data object and original index, including after refinement and culling. Fragments below alpha `0.08` do not intercept picking.

## Properties

Inherits `CompositeLayer` properties. Accessors receive the original data object and accessor context. Use `updateTriggers` when an accessor's result changes without replacing data, following deck.gl conventions.

| Property | Default | Meaning |
| --- | --- | --- |
| `data` | `[]` | Direct Gaussian asset, URL/Blob, explicit file descriptor or original owner rows. |
| `getSource` | `d => d.splats` | Constant prepared asset or per-row accessor. |
| `source` | `null` | Compatibility template for owner rows without explicit `getSource`. |
| `transparency` | `auto` | Weighted prepared assets or sorted scenes; explicit `sorted`/`weighted` overrides. |
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
| `shadowEnabled` | `true` | Include this source in a host optical shadow pass. |

## Rendering and refinement

The shader transforms all three covariance axes and projects an oriented ellipse using the projection Jacobian. Pixel filtering broadens covariance and reduces peak alpha to conserve projected coverage. Wind combines a clamped cubic bending shape with a spatial crown mode. It transforms both the centre and covariance with the same analytic Jacobian used by the tree meshes; normals use the inverse transpose. This is a reduced animation field, not a structural dynamics solver.

A shared effect captures opaque depth, accumulates weighted Gaussian colors and logarithmic optical depth into two targets in one additive MRT geometry pass. It resolves premultiplied foliage in the ordinary draw pass, preserving mesh occlusion and downstream postprocessing. **Place opaque layers before Gaussian layers.** Weighted color blending is an order-independent approximation, not exact sorted alpha blending; layered colors can differ from a trained, depth-sorted splat renderer. Color accumulation requires renderable RGBA16F, and optical depth uses R16F. The extra opaque depth pass and Gaussian projection still cost more than opaque meshes for comparable geometry. The host light transmission pass uses RGBA8 and has quantization at very small contributions.

`createSplatHierarchy(source, increasingCellSizes)` builds spatial covariance aggregates once. Each level preserves weighted position, covariance, color and approximate orientation-averaged projected optical mass; its error bounds centre displacement, not every possible view-dependent silhouette. Coarse levels store nonnegative `opticalDepths`, so many opaque leaves do not collapse into a capped opacity and disappear. The original source remains available for close views. Adjacent levels crossfade in optical depth. Refinement mixtures advance once per draw and persist across camera and quota changes, with normalized easing and a bounded per-frame step, including when wind is off. Interrupted changes start from the current mixture. The perspective derivative is bounded off-axis and regularized where Gaussian support crosses the eye; near-plane coverage fades instead of cutting a large billboard abruptly. Owner transforms and a bounding-volume hierarchy are prepared once per data/accessor change. Camera updates traverse visible bounds and measure the perspective projection Jacobian at each surviving crown; they do not scan every owner or rebuild the spatial index. Multi-view visibility uses the union of viewport frusta, and light maps query the same spatial bounds with a separate refinement criterion. The hierarchy reduces far-field vertex work without a tree detail control. Mercator bounds use owner-local metre scales and survive changes to camera latitude. Frustum planes are extracted once per query. Unchanged owner lists retain their GPU attributes; changing LOD coverage updates only the coverage buffer. Changed membership uploads bounded contiguous ranges, avoiding excessive small driver writes. Finest sources with very many Gaussians still have substantial vertex and fill cost.

## Shadows

A Gaussian is translucent; an ordinary depth-only shadow map cannot represent its transmission. `SplatShadowPass` renders multiplicative light-space transmission from the same templates and wind pose. Supply a `SplatShadowProjection` with a common-space matrix, precision-preserving centre, width and height. Call each `SplatLayer.prepareShadow(projections, viewport)` before a shadow frame to select owners against the light volume rather than the camera. Selection is applied during the next layer update; schedule a redraw after a new light volume.

The pass accepts deck.gl layer-pass options and exposes `transmission`, a texture that a host combines with opaque shadow coverage. This API represents a planar receiver below all foliage. It does not provide volumetric self-shadowing or receiver-depth-dependent transmission on arbitrary terrain. A host must allocate bounded light maps and combine this transmission with opaque coverage. Ordinary `LightingEffect` still casts opaque tree wood and crop shadows, but needs this host integration to include translucent foliage. Optical shadow integration is WebGL-only; WebGPU foliage rendering and wind are supported.

See [TreeLayer](./tree-layer.md) for procedural leaf templates, connected branches and seasons.

### Bounded refinement

`maxSplats` and `maxShadowSplats` default to `Infinity`, preserving the supplied screen-error selection. Finite budgets prioritize hierarchy refinements by projected error reduction per added Gaussian across all participating source and instance roots. TreeLayer canopy groups and WorldTreeLayer near/distant crowns share their parent quota, instead of dividing it by species row counts. The allocator reserves a quarter of a finite quota for optical transitions and favors retained detail within a 20% priority band. Promotions use the reserved overlap capacity. If every fade is blocked while its target fits, the smallest missing owner representation may temporarily exceed the quota until its old representation retires. Forced reductions use the same bounded overlap allowance. Optical coverage stays normalized throughout. Settled selections return to the allocated quota. Every visible owner remains present. A budget below the coarsest coverage floor cannot be honored without source/spatial aggregation. These limits count Gaussian submissions, not fragments, GPU bytes or hardware time.

`maxRenderPixels` (default `Infinity`) limits the shared accumulation target. The smallest limit among visible draw sources applies to the common pass. Its opaque occlusion capture uses the same target size, then the Gaussian result resolves at host resolution with linear sampling. Opaque drawing and picking retain host resolution. Lower target sizes soften foliage and reduce occlusion precision; this controls fragment work independently of Gaussian count.

`foveationStrength` defaults to zero. A positive value weights each owner's projected source center when selecting screen-error refinement and allocating submissions. At one, central weight is one and peripheral weight smoothly approaches 0.15. Frustum visibility and independent light-space shadow selection are unchanged. It is screen-center foveation, not eye tracking.

Prepared `SplatSource.opticalDepths` optionally overrides peak `opacities`: transmission is `exp(-opticalDepth * Gaussian * coverageWeight)`. Color alpha scales this density once. This avoids saturation loss in dense aggregates and needs no additional vertex attribute. Authored sources without optical depths retain peak-alpha Gaussian semantics. Covariance aggregation preserves approximate projected mass averaged over orientation; it does not exactly reproduce every view of anisotropic leaves.

The [Tree Lab](/examples/layers/tree-lab) host demonstrates planar optical foliage shadows with `SplatShadowPass`.

## Statistics

Read `layer.splatStats` after deck initializes the layer. It exposes `sourceCount`,
`visibleInstances`, `shadowInstances`, `renderedSplats`, `shadowSplats`, `coverageFloor`,
`shadowCoverageFloor`, and `refiningInstances`. Submission counts include optical transition
overlap. Source counts describe resolved source/hierarchy pairs, rather than GPU byte residency.
Use TreeLayer's `streamingStats` for geographic inventory cache statistics. These counters
do not establish a hard GPU memory or frame-time cap. Sorted ordering applies within each viewport/domain.
