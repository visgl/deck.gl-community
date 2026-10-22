# SplatLayer

Anisotropic 3D Gaussians and native RAD scenes, instanced by owning data rows. `SplatLayer` is a `CompositeLayer` built on deck.gl, luma.gl and math.gl, with WebGL2 and WebGPU shaders. It accepts decoded Gaussian assets, URL/Blob scene assets, or owner rows whose assets are resolved by `getSource`. Prepared foliage uses weighted blending; scenes use shared global ordering and native source-page residency on the host deck/device. Training remains outside this API. Prepared assets support planar Cartesian and Web Mercator views; with wrapped world copies (`MapView.repeat`) Gaussians render in the primary world copy only, and `GlobeView` reports an explicit unsupported-projection error. Sorted scenes require Cartesian coordinates.

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
`transparency: 'auto'` (the default) selects weighted blending for prepared assets and sorted
rendering for file/RAD scenes. `sorted` uses the prepared compositor for direct prepared assets: it
orders individual selected Gaussians across prepared sources and owners for each viewport,
including their transforms and wind pose. Cartesian owner rows with prepared sources that do not
use `opticalDepths` use the scene renderer, so those rows can share one order with file/RAD scenes
and other compatible owner rows. Use `sortDomain` to coordinate scene layers. `weighted` explicitly
selects the approximate prepared-foliage path and rejects file scenes.
[`SelectionPulseExtension`](./selection-pulse-extension.md) pulses selected owners with weighted
transparency; sorted and scene rendering draw Gaussians without owner instances and do not pulse.

The legacy `data: objects, source, hierarchy` form remains supported. It conflicts with direct
asset data or an explicit `getSource`; place new hierarchies in the prepared descriptor instead.
Empty owner arrays render no implicit instance. Camera changes do not rerun `getSource`; use
`updateTriggers.getSource` when its result changes without replacing data.

## Scene assets and installation

```ts
import {COORDINATE_SYSTEM} from '@deck.gl/core';

new SplatLayer({data: 'https://example.com/scene.rad', coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, maxSplats: 1_000_000, maxResidentSplats: 4_000_000});
new SplatLayer({data: {type: 'splats', url: blob, format: 'splat'}, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN});
new SplatLayer({data: owners, getSource: d => d.asset, transparency: 'sorted', sortDomain: 'scene', coordinateSystem: COORDINATE_SYSTEM.CARTESIAN});
```

RAD URLs containing `.rad` and unmarked Blobs use native RAD decoding. For other URLs (including
signed URLs without a suffix), use `{type: 'rad', url}` or `{type: 'splats', url, format}` explicitly.
String asset URLs resolve against `document.baseURI` before crossing the worker boundary, including relative paths and a document `<base>` element. Blobs pass through unchanged.
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

Sorted scenes currently require Cartesian views. Unsupported coordinate systems report a layer
error and retire its scene children. Unsupported geospatial views report a layer error only when
the scene is eligible for that view/pass; unrelated layers keep rendering and the scene recovers
when a supported view returns. **Layers containing RAD assets require perspective Cartesian views**:
RAD's distance-based refinement cannot represent orthographic screen-space error. An eligible
orthographic view reports a recoverable layer error before source allocation or refinement;
other layers and supported sibling views keep rendering. Root filters can exclude a scene from
unrelated GlobeView or repeated MapView viewports without preventing Cartesian scene initialization. Static/prepared sorted layers support
both perspective and orthographic Cartesian views. Switching back to perspective recovers RAD.
The complete layer/owner affine transform is
included in covariance projection, and camera position is transformed to source space before SH.
Each viewport and `sortDomain` has one global ordering renderer. Owners retain original picking
identity even when source pages are shared. Multi-depth picking excludes complete owners for
the duration of the query and restores them for subsequent picks. **Place opaque layers before the sorted domain and
keep its layers contiguous**; the renderer draws once into deck's existing color/depth pass.
The host owns the canvas, device, render pass and presentation. Separate domains do not intersort.
The first visible layer in a domain supplies its shared `alphaCutoff`, `kernelVariance` and
`support`; keep these equal among domain members. Owner transforms, tint, opacity, coverage and
picking remain per owner. The domain leader supplies draw parameters to the combined color draw;
use separate domains when layers need different draw state, accepting that they will not intersort.
Picking uses the same appearance settings with its own depth state.
Sorted scene shaders output straight color and alpha. Their default draw parameters use
`blendColorSrcFactor: 'src-alpha'` and `depthWriteEnabled: false`; explicit layer `parameters`
override those defaults. Both backends apply blend factors together with their operations and
restore defaults when an override is removed.
Prepared hierarchies forced to sorted currently submit their finest source; weighted optical
hierarchy blending, wind/material lighting and deck.gl shadow casting and receiving remain on the
prepared path. Scene layers ignore `shadowEnabled` and draw no shadows.
Sorted rendering rejects finest sources with `opticalDepths`; use `transparency: 'weighted'`
for those assets. Converting density to a peak opacity would change the Gaussian's radial
transmission and is not an equivalent fallback.

**`maxActiveSplats` is a compatibility alias for `maxSplats`, not an additional quota.**
Conflicting finite values fail.
`maxSplats` controls per-layer scene refinement and `maxTotalSplats` shares the strictest host
submission grant with prepared layers. `maxResidentSplats` bounds retained RAD source rows with
an additional active-frontier transition allowance. Source pages and coarsest coverage are
indivisible; a limit below coverage cannot be achieved by dropping arbitrary rows. Multi-view
selection shares the source grant, pins the union of visible pages, and retains each view's
coherent frontier. Hidden owners stop scheduling; finalized owners release their references, and
last-owner removal aborts workers and destroys source/ordering/picking resources. Resident limits
count source rows rather than a hard byte or frame-time limit.

`maxConcurrentLoads` controls RAD download admission and updates without recreating the source
worker or discarding resident pages. Shared sources use the lowest limit among visible owners.
Increasing it admits queued work; decreasing it lets existing downloads finish and delays new
admission until active requests fall below the limit. It does not change static-file decoding.

`onStatusChange(status)` reports loading, refinement, ready, budget-limited or error, including
active/source rows and pending/resident pages. A status notification describes the source asset;
multiple owners can share that asset. `splatStats.renderedSplats` reports the maximum submitted
count across viewports rather than summing repeated viewport presentation.

Hiding all owners settles completed refinement and discards cancelled decoded uploads without
publishing a hidden frontier. In-flight traversals retain their leases until they settle; the
last visible coverage remains available when owners return.

A terminal RAD source/worker error stops new downloads and uploads while retaining the last
coherent visible frontier. Outstanding view selections settle before unused traversal pages
are unpinned; reducing the resident budget can then reclaim those pages. Replace the source
or remount the layer to retry a failed asset.

## Source

Sources are immutable. Replace the source object when its arrays change. Positions and positive one-sigma scales contain XYZ triples. Rotations contain normalized WXYZ quaternions. Colors contain RGBA bytes or linear RGBA floats; float alpha and peak opacity must be in `[0, 1]`. Optional XYZ normals affect lighting, independently of covariance. Authored normals remain in the local foliage frame instead of flipping toward the camera at grazing angles. All arrays have the same Gaussian count. Invalid lengths, non-finite values, zero scales and non-unit quaternions fail before upload.

The source is local to each owner. `getPosition` uses the layer coordinate system. `getScale`, `getOrientation` (pitch/yaw/roll in degrees) and `getTranslation` transform the local template; translation follows scale and rotation and uses metres in geospatial views. Picking returns the source data object and original index, including after refinement and culling. A controlled `highlightedObjectIndex` likewise names the original row in every refinement level. Fragments below alpha `0.08` do not intercept picking.

## Properties

Inherits `CompositeLayer` properties. Accessors receive the original data object and accessor context. Use `updateTriggers` when an accessor's result changes without replacing data, following deck.gl conventions.

**Budgets are submission targets, not GPU memory limits.** `maxSplats` and `maxTotalSplats` cap
settled selections when the coarsest visible coverage fits. Every visible owner
retains a coverage floor, and optical transitions may temporarily need bounded overlap above the
target. Immutable source buffers and cached assets have separate residency costs; these properties
do not bound allocated GPU bytes. See [Bounded refinement](#bounded-refinement) for the tradeoffs.

| Property | Default | Meaning |
| --- | --- | --- |
| `data` | `[]` | Direct Gaussian asset, URL/Blob, explicit file descriptor or original owner rows. |
| `getSource` | `d => d.splats` | Constant prepared asset or per-row accessor. |
| `source` | `null` | Compatibility template for owner rows without explicit `getSource`. |
| `transparency` | `auto` | Weighted prepared assets or sorted scenes; `sorted` uses the prepared compositor for direct assets and the scene renderer for compatible Cartesian owner rows, while `weighted` rejects file scenes. |
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
| `maxSplats` | `Infinity` | Per-layer Gaussian submission budget. A finite value uses screen error and optional foveation to distribute detail independently across visible owners. |
| `maxTotalSplats` | `Infinity` | Aggregate settled submission cap across participating visible SplatLayers on one deck/device. The strictest supplied value wins. |
| `maxRenderPixels` | `Infinity` | Maximum shared accumulation-target pixels across views. Opaque drawing and picking stay at host resolution. |
| `pixelError` | `0.75` | Device-pixel bound used to select a spatial aggregate. |
| `foveationStrength` | `0` | Screen-center priority from 0 to 1 for a finite `maxSplats` budget; it does not lower an owner's requested screen error. |
| `getCoverageWeight` | `1` | Per-owner optical coverage multiplier. This is primarily for composing transitions; it multiplies owner opacity independently of `getColor`. |
| `getDeformation` | `[1, 0, 0]` | Bend height, stable phase and flex multiplier. |
| `deformationStrength` | `0` | Bend amplitude as a fraction of owner height. |
| `deformationTime` | `null` | Seconds; null uses the shared deck timeline. |
| `shadowEnabled` | `true` | Whether the Gaussians cast shadows from a `LightingEffect` light with `_shadow: true` (WebGL2). They receive shadows either way. |

## Rendering and refinement

The shader transforms all three covariance axes and projects an oriented ellipse using the projection Jacobian. Pixel filtering broadens covariance and reduces peak alpha to conserve projected coverage. Wind combines a clamped cubic bending shape with a spatial crown mode. It transforms both the centre and covariance with the same analytic Jacobian used by the tree meshes; normals use the inverse transpose. This is a reduced animation field, not a structural dynamics solver.

A shared effect isolates each view’s opaque depth and accumulation, including overlapping views. WebGL2 supports cleared overlays. On WebGPU, `View.clear` produces an explicit error because the current deck.gl path opens a nested render pass; overlapping views without clearing composite normally. It captures opaque depth. Sorted mode builds a shared selected working buffer and sorts Gaussian centers back to front each frame while retaining covariance, lighting, deformation and owner picking. It uses additional memory proportional to the selected Gaussian count and CPU sorting time. Sorted sources share one order across owners and layers. Compatible shading inputs share a draw even when sources use different opacity representations. Working buffers and models persist through refinement changes; optical fade weights update independently of geometry. If weighted and sorted sources are mixed, the sorted result composites over the weighted result. Weighted mode accumulates Gaussian colors and logarithmic optical depth. WebGL2 writes both targets in one additive MRT geometry pass; WebGPU uses an additive color pass plus a dedicated additive optical-depth pass because its current attachment blend mapping is single-target. It resolves premultiplied foliage in the ordinary draw pass, preserving mesh occlusion and downstream postprocessing. **Place opaque layers before Gaussian layers.** Weighted color blending is an order-independent approximation, not exact sorted alpha blending; layered colors can differ from a trained, depth-sorted splat renderer. Color accumulation requires renderable RGBA16F, and optical depth uses R16F. The extra opaque depth pass and Gaussian projection still cost more than opaque meshes for comparable geometry.

Under a `LightingEffect` light with `_shadow: true`, the Gaussians draw into deck.gl's shadow map on WebGL2. Each Gaussian projects its covariance with the light's orthographic matrix and keeps the fragments whose alpha exceeds one stable random threshold of its own. A fragment casts with a probability equal to its alpha, so the shadow's density follows the composited opacity `1 - Π(1 - alpha)` in both transparency modes, and coverage fades thin it smoothly. The threshold is fixed per Gaussian, so the pattern does not shimmer as the camera moves. A receiving Gaussian tests its shadow at the light-facing side of a sphere of 1.25 source units around its owner's origin, less one shadow-map texel, and darkens like an opaque surface however faint it is. Other owners and layers shadow it, and its own owner does not, because weighted transparency would average a self-shadowed interior into the sunlit side. Sources are assumed to fit that sphere, as TreeLayer crowns do; Gaussians outside it can shadow their own owner. deck.gl 9.4's shadow module has no WGSL, so WebGPU draws no shadows and skips the shadow pass. Owners culled from the camera view cast no shadow. See [TreeLayer shadows](./tree-layer.md#shadows) for interleaved-map and ground-plane notes.

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
These counters do not establish a hard GPU memory or frame-time cap. Sorted mode allocates a selected working buffer and CPU-sorts within each viewport/domain.
