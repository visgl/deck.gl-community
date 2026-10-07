# Composite SplatLayer design and TreeLayer stack revision

Status: target architecture and migration contract, revised October 7, 2026. The API examples below describe the target;
the implementation record below separates supported behavior from remaining acceptance limits.

## Objective

Make `SplatLayer` a flat deck.gl API for streamed Gaussian scenes, prepared procedural templates,
and repeated instances of either. Carry forward the Coit prototype and standalone template layer.
Use Spark 2.0's composition, selection, and paging concepts while keeping file decoding in
loaders.gl, rendering infrastructure in luma.gl, and the host lifecycle in deck.gl.

The canonical public input is `data`. It carries the splat asset directly, or instance rows whose
assets are resolved by `getSource`. The accessor can read references inside rows, select assets
from their traits, or provide one constant asset. A separate top-level `source` prop is retained
only for compatibility with #807's existing template callers; it is not required by the new API.

WebGL2 and WebGPU must accept the same sources and placement accessors. Backend selection follows
the device supplied by deck; applications do not construct another renderer, camera, canvas, or
animation loop. Performance targets are measured separately for each backend.


## Implementation across the TreeLayer stack

The existing tree PRs retain their order. Shared scene support sits below both TreeLayer and the
independent Coit branch; Coit has no TreeLayer prerequisite. The source contract in this
specification uses `data` for an asset or owner rows and `getSource` for per-owner asset resolution.
The implementation now includes a generic sorted scene runtime and the migrated Coit example,
with the prepared TreeLayer path retaining weighted optical blending. The stack adds a luma 9.4
host-pass prerequisite and two community PRs: shared scene runtime #814 immediately above #807,
and independent Coit #815 directly above #814. The tree chain starts at #794 above #814 and ends
with #809's deprecated-workspace cleanup above #808. Neither tip depends on the other.

| Stage | Responsibility |
| --- | --- |
| luma #3398 | Borrowed passes and source pages, affine instance uniforms, 32-bit camera depth ordering, native RAD retained refinement |
| #807 | Prepared CompositeLayer inputs, heterogeneous source roots, affine covariance, shared budgets and statistics |
| #814 | URL/Blob/static/RAD workers, shared deck/device residency and per-view/domain ordering, source-frame SH/HDR, owner picking and cleanup |
| #794 | Native TreeLayer traits, wood, crops and explicitly weighted canopies |
| #806 | Unified TreeLayer supplied rows/inventory streaming and parent quotas; deprecated WorldTreeLayer compatibility wrapper |
| #808 | Tree Lab, Citrus, forest/world examples and historical evidence |
| #815 | Independent public community SplatLayer Coit example, authored FirstPerson camera, native RAD ranges, diagnostics and website wiring |
| #809 | Seasonal Farm migration and removal of the deprecated three workspace |

The sorted scene path is Cartesian, requires contiguous domains after opaque layers, and submits
finest prepared sources when forced to sorted. It does not yet provide sorted geospatial/globe
projection or Tree wind/material/shadow semantics. Those remain target acceptance limits; they
are not silently substituted. WebGL2 exact CPU ordering serves small frontiers; Coit uses the
WebGPU graph. Source loading and RAD traversal run off-thread on both backends. The root Yarn
compatibility patch permits reproducible development; an upstream compatible luma 9.4 release
and patch removal are required before publishing community packages.

Real WebGL2/WebGPU pixels validate order reversal, shared-source affine/tint ownership, picking,
Blob decoding and teardown. Real Coit HTTP ranges and first coverage are separate from settled
million-row, hardware frame-time or Spark visual parity evidence. Historical tree films retain
their original source and commit fingerprints.

### Prepared backend now implemented

`SplatDataInput` includes raw immutable `SplatSource`, the prepared descriptor below, URL/Blob,
and explicit RAD/static file descriptors. Arbitrary loader handles and decoded tables remain
target adapter work; they are not accepted simply because a loader exists.

```ts
type PreparedSplatData = {
  type: 'prepared-splats';
  source: SplatSource;
  hierarchy?: SplatHierarchy;
};
```

Prepared input forms default to weighted rendering, including direct assets and heterogeneous
rows. Explicit sorted rendering routes prepared sources into the scene domain at their finest
level. URL/Blob inputs default to sorted rendering. TreeLayer explicitly retains weighted
rendering to preserve optical hierarchy transitions, wind and shadows.
A direct asset has one stable implicit owner `{splats: asset, position: [0, 0, 0]}`. Instance rows
keep their caller-owned object and accessor context. Explicit `getSource` conflicts with legacy
`source`; descriptors carry the hierarchy in the new form.

The public composite normalizes assets and instances, builds transformed source bounds, and
registers desired prepared selections with `SplatRuntime`. One selection effect reconciles
visible registrations before presentation and advances optical mixtures. Whole-template
hierarchies retain their existing approximation; this does not implement RAD row-tree selection.
The existing prepared primitive and `SplatEffect` present weighted output. Immutable uploads
continue to be reference-counted per source and device.

Canopy allocation groups are internal. TreeLayer groups share `maxCanopySplats` and
`maxShadowSplats`; tiled TreeLayer inventories inherit their parent ceiling. Local child caps
remain effective. `maxTotalSplats` applies the strictest participating shared cap. Allocator
priorities compare projected error reduction across source roots, preserving coarsest coverage.
Optical transitions retain the existing soft overlap allowance. These are submission budgets,
not hard GPU memory or frame-time guarantees.

`getTransformMatrix` replaces orientation, scale and translation with a finite affine local
matrix, including covariance and conservative shear bounds. `splatStats` reports source/hierarchy
pairs, selected owners, submitted camera/shadow work, coarsest coverage and moving refinements.
Geographic inventory residency remains TreeLayer's separate `streamingStats` lane.
Use `data` for supplied rows or `getTileData` for a bounded inventory, with ordinary tree accessors
at the top level. WorldTreeLayer remains a deprecated compatibility wrapper around the internal
tile component. Coit depends on the shared SplatLayer runtime alone.

### Scene backend and remaining acceptance work

The scene runtime integrates native RAD pages, source/instance namespaces, reference-counted
page demand and one global order per view/domain. The luma 9.4 backport provides a borrowed
presentation pass and per-instance projection. WebGL2 uses exact projected-row ordering for
small frontiers; it does not use the prepared renderer's depth-slab shortcut. RAD selectors
retain each view's coherent cut while sharing a source allocation and union residency.

Full byte accounting, shared best-first RAD selection across different source hierarchies,
scalable worker ordering on WebGL2, sorted geographic/globe projection, and matched-camera
hardware performance/visual parity remain acceptance work. Per-source/view grants bound
refinement; they are not a claim that a global RAD node queue has been implemented.

Use a compatible publication or upstream backport for these extensions. Keep the Coit source and
lifecycle comparison until the supported scene path reproduces them. Do not copy the private
renderer into community or flatten RAD rows into prepared arrays to make the input appear supported.

## Existing implementation and reuse boundaries

This assessment uses community #807 at `cae0ddd19e41a58e6ea6078cfc739d7560bd07ac`, deck.gl #10627
at `a32d110633a6dfb0088eb7a5da8c0d32e2ebc44c`, luma.gl #3340 at
`09d7998202b6c102a9f2ffda6010a6b311e3c9d9`, and Spark source at
`f5368253780bed4d863c96b1fdea9dd3d614d131`.

| Existing component | Reuse | Required extension |
| --- | --- | --- |
| loaders.gl `RADSource` and splat decoders | Metadata, range transport, native pages, source identities, decoded columns | Integrate source adapters and shared cancellation/request demand |
| luma `SplatRADHierarchyManager` | Authored row links, coherent parent replacement, camera retargeting, retained detail | Source and instance namespaces, joint selection across transformed roots |
| luma `SplatResidencyManager` | Intact allocations, priorities, leases/ownership, bounded admission | Shared source registry and complete runtime memory accounting |
| luma `GPUPagedSplatRenderer` | Sparse row projection, SH, global 32-bit linear-depth ordering, segmented output, borrowed host pass | Per-instance transforms and one order across participating sources |
| luma prepared `SplatRenderer` | WebGL2/WebGPU drawing, covariance math, source conventions, CPU ordering | Scalable paged/index drawing and worker ordering with matching semantics |
| community #807 | Template reuse, deck accessors, owner picking, deformation, refinement transitions, optical shadows | Source resolution, heterogeneous instances, shared runtime registration |
| deck.gl Coit prototype | Worker ownership, load scheduling, admission, camera conversion, status, lifecycle regressions | Move reusable integration into the community layer after parity |

The prepared renderer currently walks source rows on the CPU and rebuilds WebGL attributes. When
globally interleaved batches exceed its exact draw-run threshold, it groups them into approximate
depth slabs. It is a reuse starting point, not an existing exact paged WebGL2 equivalent of the
WebGPU renderer. The latter also currently has one global transform, not instance transforms.

Dependency alignment is the first delivery gate. #807 uses deck/luma 9.4 and loaders 4.5; the
inspected splat package is private luma 10 alpha and the RAD work uses loaders 5 APIs. A coordinated
compatible publication or upstream backport must be selected before changing package pins. A
source-aliased development proof does not establish installable out-of-the-box support. Do not
mix luma majors in one device or copy the entire private renderer into community to bypass this.

## Spark concepts to carry forward

The [Spark 2.0 article](https://www.worldlabs.ai/blog/spark-2.0) and
[feature guide](https://sparkjs.dev/docs/new-features-2.0/) describe a shared scene representation:
instances contribute hierarchy roots to a joint detail selection, page demand is prioritized
across sources, and bounded residency is separate from the visible rendering budget. Adopt these
concepts, along with retained coarse coverage and optional view-centered foveation.

Use [Spark's existing build-lod tools](https://sparkjs.dev/docs/lod-getting-started/) for offline
RAD preparation. Preserve authored RAD hierarchy data. Keep #807's supplied template hierarchies
working; its whole-template levels are not the same representation as an authored per-row RAD
tree. Browser LoD construction needs an existing reusable kernel or an upstream addition; do not
claim a new Tiny-LoD or Bhatt-LoD implementation merely by renaming `createSplatHierarchy`.

Spark's runtime depends on THREE.js. Its renderer, scene graph, and Dyno compiler do not become
dependencies of the deck layer. Reuse existing loaders/luma code and extend their established
contracts where needed. If code is ported from Spark, retain its required license attribution.

## Flat public API

`new SplatLayer({id, data, ...})` is the primary form for every supported format. A URL,
Blob/File, supported binary input, loader-produced RAD handle, or decoded Gaussian dataset is
resolved by the appropriate existing loader/adapter. Direct asset input represents one implicit
instance. A separate top-level `source` is unnecessary:

```ts
new SplatLayer({id: 'coit', data: '/captures/scene.rad'});
new SplatLayer({id: 'capture', data: '/captures/scene.spz'});
new SplatLayer({id: 'prepared', data: canopySource});
```

Prepared templates and loaded captures enter the same source registry. Keep the existing exported
prepared `SplatSource` type compatible; define a broader `SplatDataInput` union for the supported
forms. Callers do not pack textures, construct a renderer, or adopt a new scene class. An optional
prepared-data descriptor associates an existing template with its supplied hierarchy. Decoded
tables and source handles preserve their schema, hierarchy, units, axes, and appearance metadata.

The format registry is extensible through loaders.gl and its normalized Gaussian/source
contracts. RAD retains range-loaded pages and its authored hierarchy. SPZ and other static
formats use the behavior their decoders actually support; accepting a file does not promise
native range streaming or an automatically generated hierarchy. New formats should add a loader
or adapter, not a new SplatLayer data prop. Use explicit `loaders`/`loadOptions` for ambiguous
URLs, transport options, or decoder selection; validate format headers and schemas rather than
trusting an extension. Unsupported inputs produce a normal layer error.

For repeated or heterogeneous instances, `data` can contain both the asset reference and placement:

```ts
const objects = [
  {splats: captureUrl, position: firstPosition},
  {splats: captureUrl, position: secondPosition},
  {splats: canopySource, position: treePosition}
];

new SplatLayer({
  id: 'world',
  data: objects,
  getPosition: object => object.position,
  pickable: true
});
```

The proposed default `getSource` accessor reads each instance row's `splats` field. It is optional
when rows use that field. It also accepts a constant asset or a function that selects an asset
from the caller's row, following deck's ordinary accessor convention:

```ts
// One shared template for all owner rows
new SplatLayer({
  id: 'canopies',
  data: trees,
  getSource: canopySource,
  getPosition: tree => tree.position
});

// Different templates selected by each row's species
new SplatLayer({
  id: 'forest',
  data: trees,
  getSource: tree => canopyTemplates[tree.species],
  getPosition: tree => tree.position
});
```

`getSource` applies to instance collections and is unnecessary for direct asset input. A constant
URL, supported handle, or prepared dataset is valid; a function returns the same input union for
each owner. Repeated rows can reference the same immutable asset without duplicating Gaussian
arrays, decoding, or source GPU allocations. Resolve stable source identities and honor
`updateTriggers.getSource`; avoid reconstructing equivalent source objects on every frame.
A list containing positions alone requires an explicit `getSource`, because the renderer cannot
infer the intended Gaussian asset from a placement.

Input recognition must distinguish an asset from a collection of instance rows. Recognized
source handles, validated Gaussian columns, and supported table schemas are asset inputs. An
array/iterable of instance records follows the documented instance schema. Do not guess arbitrary
objects or reinterpret raw Gaussian rows as placements. TypeScript and runtime validation follow
the same input union and reject ambiguous forms. In direct asset mode, constant placement
accessors apply to the implicit instance; function accessors receive the documented normalized
instance record containing that asset. In row mode, accessors and picking retain the caller's row.

Geographic grounding is a placement concern and stays explicit:

```ts
new SplatLayer({
  id: 'grounded-capture',
  data: captureUrl,
  getPosition: [longitude, latitude, altitude]
});
```

`getPosition` anchors the asset's local origin in the selected deck coordinate system. For
instance rows it defaults to the row's `position`; a constant applies to every instance. An
unplaced implicit instance uses the local origin in a Cartesian view. A geographic view requires
an explicit anchor or validated georeferencing metadata; a bare RAD/SPZ file does not imply a
known longitude, latitude, altitude, up direction, or scale. Orientation/scale and metadata
conversion must align the capture's local frame before geographic projection. Geographic and
globe behavior remain explicit acceptance gates, not existing Coit prototype capabilities.

Keep standard `modelMatrix`, coordinate system/origin, `visible`, `opacity`, `getColor`, accessor
update triggers, `dataComparator`, partial data changes, and picking behavior. Add
`getTransformMatrix` with the same precedence as deck's instance transform accessors. Its matrix
maps source-local coordinates into the instance's local coordinate frame; the layer's coordinate
projection and `modelMatrix` then apply. Preserve degrees and pitch/yaw/roll conventions for
`getOrientation`. A Three world matrix can migrate directly only when camera and world-coordinate
conventions match; it is not geographic registration.

Resolved assets carry their own hierarchy in mixed-input mode. The top-level `hierarchy` and
`source` props remain legacy controls for #807's constant-template form. They cannot ambiguously
override direct-asset input or explicit `getSource`. Reject conflicting input channels rather than
silently prefer one. New examples and TreeLayer integration use `data` plus the default, constant,
or function-valued `getSource` accessor.

The proposed advanced rendering controls are flat: `transparency: 'sorted' | 'weighted'` and
`sortMetric: 'depth' | 'radial'`. Direct asset input defaults to sorted/depth rendering, preserving
the Coit prototype's metric. The legacy owner/template form retains weighted rendering during
migration. Mixed inputs use one declared policy, with sorted/depth as their default. Migration
documentation must call out these defaults rather than presenting them as Spark defaults.

TreeLayer remains a CompositeLayer that supplies owner rows and generated canopy assets through
`getSource` while composing wood/crop meshes. Its sublayer row mapping preserves original
tree picking and accessor behavior. It explicitly retains the existing weighted rendering policy
until the sorted template path is accepted. Species, seasons, and trait generation stay in
TreeLayer. SplatLayer has no tree dependency.

## One shared runtime, with separate views

All participating SplatLayers in a deck instance register with an internal runtime scoped to
that deck and its device. Separate deck instances do not share GPU resources. Within a compatible
draw domain, layers share source allocations, page request priority, worker resources, and the
view's global splat ordering. Domains account for view, layer filtering, render operation, and
transparency policy; picking and shadow passes have their own selection/output.

| State | Scope |
| --- | --- |
| Source bytes, decoded pages, immutable geometry, owned GPU pages | Source identity and revision |
| Placement, tint, deformation, owner identity | Instance |
| Visibility, hierarchy frontier, projection, SH evaluation, ordering | View and instance |
| Residency, request scheduling, admission, device allocations | Shared runtime |

A visible sample is identified by source, page, original row, and instance. Two instances share
source pages but may select different rows. Requests are coalesced across their current demand.
Removing one instance does not abort another's requests or release its pages. GPU allocations
are shared only on the same device. Borrowed sources are not destroyed when a layer finalizes.
Use explicit source identity/revision; a bare URL is insufficient for coalescing differently
authenticated requests or loader configurations.

Extend luma's existing hierarchy machinery to seed a shared best-first selection with transformed
instance roots. Maintain a coherent retained frontier while worker results are pending. Do not
allocate an equal independent detail quota to every object or concatenate independent full-budget
cuts and call that joint selection. Original per-row links remain source-local. Prepared level
hierarchies retain their documented approximation until an actual row hierarchy is supplied.

Preserve `maxSplats` as a per-layer cap during migration. Shared runtime defaults bound aggregate
active work and memory. Proposed advanced flat overrides are `maxTotalSplats` and
`maxTotalGpuBytes`; consistent values are normally supplied once. If participating layers declare
different finite shared ceilings, the strictest ceiling wins and status exposes the effective
values. Local caps and global ceilings are distinct. Account for source allocations, projection
records, ordering scratch, and transition headroom. Source row counts alone are not a byte budget.

Repeated instances consume additional selected/rendered work even when their source residency is
shared. When minimum coverage cannot fit, preserve the admitted coherent frontier and report a
budget-limited state; never silently exceed a hard allocation limit or claim the view is complete.
Choose default ceilings from device capabilities and measured fixtures, not Spark's platform
counts copied as a universal performance guarantee.

Each viewport has its own frontier, camera-dependent appearance, and sort order; page demand and
residency can be shared across their union. Selection and projection use physical pixels. Orthographic
views use their actual projection derivative. Positive linear depth comes from the viewport's
view transform for both perspective and orthographic views; perspective clip-W alone is not a
general camera-depth contract. Globe/geographic support requires deck's nonlinear projection at
each source/instance, not just a single Cartesian MVP approximation. Initial RAD parity uses the
prototype's Cartesian scope. Geographic/globe claims require their own source extent, precision,
covariance, and camera regressions; unsupported combinations produce an explicit layer error.

## Backend parity contract

| Responsibility | WebGL2 | WebGPU |
| --- | --- | --- |
| Source resolution, native decoding, hierarchy policy, ownership | Shared code and workers | Same contracts |
| Page/instance references | luma texture/attribute/index facilities | luma storage buffers and sparse indices |
| Projection and source appearance | Existing luma math/shaders extended for paged instances | Existing paged projection extended for instances |
| Global ordering | Existing ordering extended to worker-driven compact references and scalable drawing | Existing GPU radix order across all projected instances |
| Presentation | luma draw into the host pass | luma prepare then draw into the host pass |

The semantic target is one global center-depth order across every participating source and
instance. Sorting each page, source, or instance separately is insufficient. WebGL2 must not
silently substitute depth slabs, drop SH, or become unordered under load. The implementation may
materialize bounded derived projected output for drawing; it must not flatten original sources
and discard their hierarchy, precision, or appearance. Both backends have the same documented
sort metric. Keep center-depth intersection artifacts distinct from ordering correctness.

Keep #807's weighted optical blending available as an explicitly approximate policy during
migration. Existing template callers retain their current policy until deliberately migrated.
The new scene path targets sorted rendering. A mixed source layer must choose one common policy;
independent weighted and sorted pipelines do not provide globally ordered overlap by being placed
in one CompositeLayer. Preserve legacy template shading/deformation/shadow semantics until the
equivalent sorted path is verified; do not infer normals or relight trained SH captures as foliage.

Follow the host device. Unsupported capabilities produce a clear layer error through deck's
normal error handling; they do not create another device or change the rendering policy. Device
loss/recovery, worker termination, cancellation, and source replacement require explicit lifecycle
coverage. GPU preparation precedes the host render pass. Drawing must not clear, end, or submit a
borrowed pass. Ordinary opaque geometry must use compatible depth/projection; other transparent
deck meshes are not automatically sorted per fragment with Gaussians.

## Migration rules

| Current usage | Target | Preservation requirement |
| --- | --- | --- |
| #807 `data: owners, source: template` | Compatibility form; migrate to `data: owners, getSource: template` | Type surface, original-owner picking, accessors, explicit retained weighted appearance |
| #807 supplied hierarchy and wind | Unchanged initially | Error units, optical transitions, deformation Jacobian, shadows |
| Coit `data: RAD URL/Blob` | Canonical direct-asset form, unchanged | Fixed camera/lens, source-local selection, native pages, SH, float colors |
| Coit `maxActiveSplats` | Compatibility alias for the local `maxSplats` cap | Identical effective value; conflicting explicit values are rejected |
| Coit `maxResidentSplats`, load concurrency, status callback | Retained during migration | Separate resident/active counts and source ownership |
| Spark `new SplatMesh({url})` | `data: url`; repeated owners use constant/accessor `getSource` | Same source file; RAD enables native paging |
| Spark object transforms | Deck instance accessors or `getTransformMatrix` | Matching coordinate basis, units, covariance, source-local SH direction |
| Spark `sortRadial` | `sortMetric: 'radial'` or `'depth'` | Preserve the chosen metric explicitly; current Spark defaults to radial |
| Spark shared renderer/pager | Automatically managed internal runtime | One shared resource domain without application renderer plumbing |

For a basic RAD migration, keep the asset and move the URL into the layer:

```ts
// Spark
new SplatMesh({url: assetUrl, paged: true});

// Proposed deck API, explicitly retaining Spark's current default sort metric
new SplatLayer({id: 'capture', data: assetUrl, sortMetric: 'radial'});
```

Automatic paging follows validated RAD metadata. A static PLY/SPZ file can be decoded by its
existing loader but does not thereby become a range-streamable RAD hierarchy. Spark's
`lod: true` browser construction remains an explicit migration gap until a reusable builder is
integrated; the existing offline conversion is available without inventing another algorithm.

Preserve WXYZ source quaternions, units and axis metadata, linear/HDR float colors, all supplied SH
bands, and native coarse-node opacity semantics. Non-uniform instance transforms must transform
covariance correctly; recomputing scale alone is insufficient. Evaluate SH in the original source
frame. Keep template peak alpha and optical depth distinct from RAD's nonlinear parent opacity.

Spark has features beyond this migration: Dyno shader graphs, skinning, XR wrappers, portals, and
other specialized formats. Do not label them automatically compatible or add a second shader
graph language. Preserve the reusable subset and list unsupported features explicitly. Existing
loaders determine initial format support; start the parity proof with RAD and prepared templates.

## Delivery and proof

1. Resolve a compatible published dependency line. Pin matched deck/luma/loader versions and
   verify a fresh install with no local checkout aliases. Keep the API contract review separate
   from this packaging decision.
2. Extend shared source/instance and selection contracts upstream in luma while retaining the
   existing hierarchy/residency regressions. Test multiple copies, heterogeneous sources,
   transformed views, reference-counted lifetimes, and joint budget allocation before presentation.
3. Complete both rendering backends against the same reference records. Add globally interleaved
   page/instance fixtures that defeat batch sorting and the prepared renderer's slab shortcut.
4. Add the flat CompositeLayer adapter and compatibility types to #807. Keep TreeLayer callers
   and the Coit lifecycle/camera tests working. Update the playground schema and document the
   new API and migration behavior when implementation exists.
5. Move the Coit example into community. Retain #10627 as a comparison reference until the
   migrated source, lifecycle, visible refinement, and camera behavior demonstrate parity.

Acceptance includes:

- Node tests for source resolution, collisions/revisions, shared page demand, cancellation,
  disposal, replacement, budgets, retained parents, instance transforms, and multi-view state.
- Strict TypeScript consumers for direct RAD/SPZ, URL/Blob, decoded data, legacy templates,
  default/constant/function `getSource`, heterogeneous owners, geographic anchors, accessor
  update triggers, and rejected ambiguous/conflicting inputs.
- Real WebGL2 and real WebGPU pixels for close-depth ordering, cross-source overlap, opaque host
  occlusion, non-uniform covariance, source-local SH, owner picking, and supported deformation.
- Identical-camera Coit captures with matched physical viewport, pixel ratio, source, selected
  work/residency budgets, and cache conditions. Include motion sequences and measured frame/long
  task distributions; a screenshot or a successful draw is not a smoothness proof.
- Many instances of one source proving one shared decode/upload with distinct placements and
  picking identities, plus mixed RAD/template instances in one ordering domain.
- Root install/build, relevant Node/browser/headless tests on both APIs, strict consumers,
  website build for implemented documentation, and lint-fix with a reviewed diff before landing.

"Zero mistakes" is expressed as these invariants and regression gates, not a promise of perfect
Gaussian reconstruction, identical floating-point pixels, or unrestricted performance. The scene acceptance gates remain requirements; prepared implementation evidence does not establish that the streamed or sorted backend passes them.

## Source references

- [World Labs Spark 2.0 article](https://www.worldlabs.ai/blog/spark-2.0)
- [Spark 2.0 feature guide](https://sparkjs.dev/docs/new-features-2.0/)
- [Spark LoD and build-lod](https://sparkjs.dev/docs/lod-getting-started/)
- [Spark migration guide](https://sparkjs.dev/docs/0.1-2.0-migration-guide/)
- [Pinned SparkRenderer](https://github.com/sparkjsdev/spark/blob/f5368253780bed4d863c96b1fdea9dd3d614d131/src/SparkRenderer.ts)
- [Pinned SplatPager](https://github.com/sparkjsdev/spark/blob/f5368253780bed4d863c96b1fdea9dd3d614d131/src/SplatPager.ts)
- [Community standalone SplatLayer PR](https://github.com/visgl/deck.gl-community/pull/807)
- [Deck Coit prototype PR](https://github.com/visgl/deck.gl/pull/10627)
- [Luma progressive selection and host-pass PR](https://github.com/visgl/luma.gl/pull/3340)
