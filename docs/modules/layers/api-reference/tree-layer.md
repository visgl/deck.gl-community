import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# TreeLayer

<LayerLiveExample highlight="tree-layer" size="tall" />

An instanced, procedural tree layer built entirely with deck.gl, luma.gl and math.gl. Eight species share immutable Gaussian leaf templates and connected trunk-and-branch meshes. Winter removes deciduous foliage while retaining the same wood. Automatic screen-error refinement retains the full authored source for close views. No Three.js runtime dependency is required.

```ts
import {TreeLayer} from '@deck.gl-community/layers';

const trees = [{
  position: [-60.1, -2.5, 0],
  species: 'citrus',
  height: 5,
  crownRadius: 2,
  season: 'summer',
  wind: true
}];
new TreeLayer({id: 'trees', data: trees, pickable: true});

// Adapt any inventory with one standard deck.gl accessor:
new TreeLayer({
  id: 'inventory',
  data: records,
  getTree: (record, {index}) => ({
    position: record.coordinates,
    species: record.species,
    height: record.height,
    season: record.season,
    characteristics: record.morphology,
    crop: record.crop,
    wind: record.wind
  })
});
```

`TreeLayer` is the canonical renderer. `TreeWoodLayer` and `TreeMeshLayer` are internal sublayers, not alternate public tree renderers. Comparison fixtures live only in examples.

## Authored tree traits

Start with `getTree` for the complete authored tree and add granular accessors only for fields
that need an override. For a crown specified in metres, use `getTree: row => ({...row,
crownRadius: 2})`. `getCanopyRadius: 2` retains the legacy canopy scale convention and is not an
equivalent physical radius; broadleaf crowns use approximately half that scale.

`getTree` defaults to the source row and accepts a constant `TreeSpec` or `(row, accessorContext) => TreeSpec`. Supply a position and species; height, crown dimensions, first-branch height and bole thickness have species defaults. `height` and nominal `crownRadius` use metres. Per-tree `characteristics` selects a shared wood/leaf morphology, `season` controls foliage, `crop` is explicit, and `wind` accepts `true` (0.025), `false`, or a bend fraction up to 0.2. Omitted wind uses the layer's `windStrength`. Optional colors and elevation also live in the same object.

Explicit granular accessors override corresponding `getTree` fields, so hosts can change a global season or bind a single field without rebuilding their inventory. Function accessors follow deck.gl's `updateTriggers` convention; use `updateTriggers.getTree` when a mapped trait function's captured values change. Position changes, species, crops and morphology rebuild prepared owner rows; global wind and animation time retain geometry. Default transforms and deterministic variation are shared across wood, leaves, crops and picking.

Leaf-on tree canopies always use `SplatLayer`; there is no triangle-mesh foliage fallback. `TreeWoodLayer` composes connected trunks and branches through internal `TreeMeshLayer` children, while crop layers remain meshes. `TreeLayer` owns the authored tree shape and template selection; `SplatLayer` owns spatial visibility, refinement and bounded Gaussian work. There is no manual `detail` mode. Keep common morphology presets shared: unique botanical skeletons require distinct templates and draws. Sizes, colors, seasons and wind vary per instance without unique meshes. Dense scenes keep their splat crowns and their nearby connected branch lattice; a stable coverage mask lets foliage fill between branch samples rather than cutting a hard opaque lattice through the canopy. Distant native wood simplifies to compact boles.

Foliage inherits the [SplatLayer rendering limits](./splat-layer.md#rendering-and-refinement):
use planar Cartesian or Web Mercator views. With wrapped world copies (`MapView.repeat`),
canopies render in the primary world copy only. GlobeView and WebGPU `View.clear` are
unsupported.
In Cartesian and metre-offset coordinates, layer `modelMatrix` supports translation only;
rotation, scaling and shear report an explicit error to keep wood and foliage aligned.
Use authored tree dimensions and positions to set the tree pose.

## Properties and granular overrides

Inherits the deck.gl `CompositeLayer` properties. Accessors accept constants or functions receiving the source tree and the standard deck.gl accessor context. The granular accessor defaults below are legacy fallbacks; authored `TreeSpec` fields and species proportions apply first unless a granular accessor is explicitly supplied. Invalid base positions and unknown species are omitted. Non-finite dimensions fall back to their documented defaults; negative dimensions clamp to zero. Non-finite elevation falls back to zero, and invalid seasons use summer.

| Property | Default | Meaning |
| --- | --- | --- |
| `getTree` | `d => d` | One `TreeSpec` per source row, including position, species, dimensions, morphology, season, crops, colors and wind. |
| `getPosition` | `d => d.position` | Longitude/latitude position of the tree base; the host coordinate system also supports local coordinates. |
| `getElevation` | `() => 0` | Base elevation in metres. |
| `getTreeType` | `() => 'pine'` | `pine`, `oak`, `palm`, `birch`, `cherry`, `banyan`, `mangrove` or `citrus`. |
| `getHeight` | `() => 10` | Total nominal height in metres. |
| `getTrunkHeightFraction` | `() => 0.35` | Trunk fraction, clamped to 0–1. Palm shafts extend into the crown. |
| `getTrunkRadius` | `() => 0.5` | Trunk base radius in metres. |
| `getCanopyRadius` | `() => 3` | Horizontal canopy scale, retaining the legacy approximate half-scale broadleaf radius. Palms and pines have their own silhouette envelopes. |
| `getTrunkColor` | `() => null` | Explicit bark color or the species default. |
| `getCanopyColor` | `() => null` | Explicit foliage color or the species/season default. Branches use bark color in every season. Authored leaf tones multiply foliage color. |
| `getSeason` | `() => 'summer'` | `spring`, `summer`, `autumn` or `winter`. Winter removes deciduous foliage; pine, palm, banyan, mangrove and citrus remain evergreen. |
| `getBranchLevels` | `() => 3` | Pine tier count, rounded and clamped to 1–5. |
| `getCrop` | `() => null` | Explicit crop configuration; the layer never invents seasonal yield. |
| `maxCanopySplats` | `'auto'` | Shared Gaussian submission budget across all species and visible trees. It resolves once per device to 20,000 on real GPUs and 5,000 on known software/fallback adapters; pass a number to override it. Screen-space LOD and foveation prioritize projected detail within this limit. |
| `maxCanopyPixels` | `Infinity` | Optional cap for the shared foliage accumulation target; wood and picking retain host resolution. |
| `foveationStrength` | `0` | Optionally ranks constrained canopy refinements toward the viewport center without lowering requested detail. |
| `sizeScale` | `1` | Multiplier for tree and crop dimensions. |
| `characteristics` | `{}` | Shared broadleaf morphology; changes regenerate the connected wood, leaves and crop attachment together. See below. |
| `windStrength` | `0` | Bend amplitude as a fraction of tree height. Zero stops continuous redraw when no per-tree wind is authored; a value around `0.025` is a gentle breeze. |
| `windTime` | `null` | Wind time in seconds. `null` uses deck.gl's timeline; a number freezes the pose for controlled comparisons. |

## Crops

`CropConfig` has `color`, `count`, `radius` and optional `droppedCount` and `kind`. Shapes are `fruit` (the default sphere), `lemon`, `cone`, `acorn`, `catkin`, `flower` and `propagule`. Radius is the enclosing sphere radius in metres, including elongated shapes and petals. Counts are explicitly supplied, rounded down and clamped at zero. Broadleaf crops attach to leaf-bearing shoots inside the same clusters used for foliage. Placement reserves clearance for the complete sphere under the tree’s anisotropic scale; attached crops too large to fit are omitted. Palm crops cluster beneath the frond sockets. Dropped crops use the same conservative spherical bounds above the ground. Positions are deterministic, remain stable when counts grow, and picking returns the owning source tree. A controlled `highlightedObjectIndex` names a source tree and highlights it in every wood, canopy and crop partition. Attached crops share the tree's GPU bend; dropped crops remain still.

## Animation

Wind is implemented in GLSL and WGSL. Trunks, branches, leaves and attached crops use the same deformation. Time changes do not rebuild geometry, regroup data or regenerate instance attributes.

## Extensions

`extensions` and their props pass to the wood, crop and canopy sub-layers; extension accessors receive the source tree and its index, and their `updateTriggers` apply. The wood, crop and canopy shaders already use the 16 vertex attributes that WebGL2 guarantees, so extensions that add a vertex attribute, such as `DataFilterExtension`, do not link on those sub-layers.

[`SelectionPulseExtension`](./selection-pulse-extension.md) reads its data from a texture instead, so it pulses selected trees on the GPU in WebGL2 and WebGPU:

```ts
new TreeLayer({
  id: 'trees',
  data: trees,
  extensions: [new SelectionPulseExtension()],
  getSelected: tree => selectedIds.has(tree.id),
  updateTriggers: {getSelected: [selectedIds]}
});
```

## Migration

Remove `detail` from TreeLayer props and `TreeDetail` from type imports. TreeLayer now composes full leaf Gaussian sources and continuous woody meshes, with automatic refinement for subpixel crowns and branches. Legacy demo `detail` query parameters are ignored.

The deprecated `@deck.gl-community/three` workspace has been removed. Update imports and dependencies to `@deck.gl-community/layers`, including `TreeLayerProps`, `TreeType`, `Season` and `CropConfig`. Previously published package versions are unchanged. The production renderer has no Three.js dependency.

Native TreeLayer and SplatLayer foliage ship without built-in deck.gl foliage-shadow integration. TreeLayer and SplatLayer force their foliage and wood sublayers not to cast deck.gl shadows. Applications that need shadows must provide them outside this foliage renderer.

Gaussian crowns and connected winter silhouettes deliberately differ from the original geometry. `CropConfig.radius` now matches its documented radius: older geometry rendered half that radius. Halve an existing crop radius to retain its old apparent size. Inspect your explicit seasonal foliage overrides, canopy sublayer overrides and custom winter branches when migrating; the native crown sublayer IDs include foliage/winter and tier information. Legacy species overrides such as `canopy-cherry` remain supported and apply after native defaults. Exact grouped sublayer IDs take precedence over species aliases. Custom wood meshes use camera LOD children without the native template morph; arbitrary custom geometry is kept conservatively visible. Overridden wood transform accessors and their triggers also determine culling bounds. Override accessors receive the source tree and its original accessor context; parameters and update triggers merge by key.

[Source](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/tree-layer)

## Canopy composition

`canopy-{species}-foliage-{tier}` sublayers are now `SplatLayer` composites, so mesh-specific canopy overrides no longer apply. `wood-{species}-{foliage|winter}-{tier}` sublayers own the connected woody mesh. The `trunks` alias applies bark overrides to connected wood; exact wood IDs take precedence. Deciduous winter has no canopy sublayer. Crop layers remain meshes and their owner picking and accessor contexts are unchanged.

Deciduous boles divide into curved, tapered limbs, secondary branches and terminal twigs. The same botanical structure places leaf clusters around those shoots and attaches fruit inside them. The trunk and branches form one closed, connected triangle surface. Branch roots reuse socket boundary vertices, with smooth normals across their junctions. Palm shafts and frond stems share that surface; leaflets remain translucent Gaussians. Wind, crop locations and tree yaw remain stable across seasonal foliage changes. These are deterministic procedural botanical templates, not trained photographic reconstructions.


## Procedural growth and motion

Broadleaf crowns use a bounded [space-colonization model](https://algorithmicbotany.org/papers/colonization.egwnp2007.pdf). Irregular crown volumes supply attraction points. The nearest eligible shoot grows in the normalized sum of directions to its points, with apical persistence and upward tropism; nearby points are consumed. Each species template has at most 600 growth nodes and 64 iterations per shared template. Interactive templates use bounded LRU caches (16 botanical/source templates and 32 full/distant woody meshes). Terminal shoot counts determine pipe-model taper with exponent 2.3. Tube frames are transported along the curves; junctions reuse parent vertices. This produces asymmetric paths and forks instead of repeated spherical lobes.

The banyan template has a broad crown, ovate leaves and aerial roots descending from spreading limbs. Red mangrove has large elliptical leaves and arching stilt roots attached to the bole. Their evergreen foliage remains visible in every season. These traits follow [Flora of North America](https://efloras.org/florataxon.aspx?flora_id=1&taxon_id=233500648) and [UF/IFAS](https://ask.ifas.ufl.edu/publication/FR460); dimensions are procedural, not measured specimens. The demo uses elongated mangrove propagules, pine cones, capped oak acorns, birch catkins, cherry fruit or spring flowers, small banyan figs and palm coconuts; supplied shapes and colors remain caller-controlled.

Palm frond stems and splat leaflets share the same deterministic arching centerlines, keeping woody structure aligned with foliage. Palm leaflets remain splats at every density; they use the same screen-space LOD and shared canopy budget as other species.

Wind uses the normalized clamped-cantilever shape `f(u) = u²(3 − u)/2` plus a spatial crown mode at twice the main sway frequency. The second mode gives different crown regions different motion while keeping a continuous deformation field. [Branching dynamics research](https://arxiv.org/pdf/1106.1283) motivates multiple motion scales, but this renderer is a reduced animation model, not a mechanical stress or damping solver. The full analytic Jacobian transforms leaf covariance and inverse-transpose normals. Ground contacts stay fixed. Source buffers and growth templates remain unchanged as time advances.


## Shared characteristics

`characteristics` applies to every tree in this layer and preserves instancing by species. Broadleaf wood, Gaussian leaves and attached crop bounds consume the same normalized template. Pine and palm retain their specialized skeletons. The defaults preserve existing templates.

| Characteristic | Default | Range | Effect |
| --- | --- | --- | --- |
| `seed` | `0` | unsigned 32-bit integer | Deterministic growth pattern. |
| `crownSpread` | `1` | `0.6–1.5` | Horizontal attraction envelope. |
| `crownDepth` | `1` | `0.6–1.4` | Vertical attraction envelope. |
| `crownAsymmetry` | `1` | `0–2` | Smooth azimuthal crown lobes. |
| `branchDensity` | `1` | `0.5–1.5` | Attraction-point count within the bounded growth solver. |
| `branchLift` | `1` | `0–3` | Upward tropism. |
| `internodeLength` | `1` | `0.7–1.4` | Shoot growth step. |
| `leafSize` | `1` | `0.5–1.8` | Gaussian leaf axes. |
| `leafDensity` | `1` | `0.25–2` | Shared template leaf count. |

Non-finite values use defaults; multipliers are clamped and quantized to `0.01`. Seeds are rounded. Growth remains limited to 600 nodes and 64 iterations. Animation and lighting updates retain geometry and owner rows. These controls describe procedural morphology, not predicted biological growth or yield.

Citrus supports orange, lemon and lime forms through its characteristics and explicit crop inputs. Citrus remains evergreen through all seasons; white blossom, green fruit and ripe fruit are separate explicit inputs. Maturity varies with cultivar and location, as described by [UF/IFAS](https://ask.ifas.ufl.edu/publication/HS132). A variety preset is an illustrative tree form, not a cultivar reconstruction or ripening calendar.

```ts
new TreeLayer({
  data: orchard,
  getTreeType: () => 'citrus',
  characteristics: {seed: 19, crownDepth: 0.8, branchLift: 0.8, leafSize: 1.15},
  getCrop: () => ({kind: 'lemon', color: [245, 211, 37], count: 40, radius: 0.052})
});
```

Shaped crops use suffixes such as `live-crops-lemon`; spherical fruit retains `live-crops` and `dropped-crops`. Picking still resolves to the source tree.

## Large forests

Wood and foliage keep persistent owner bounds for camera queries. Mercator bounds use each owner's geographic latitude, so camera pans preserve the index. Mesh wind phases are prepared per owner while the animation clock supplies shared frame uniforms.

The highest source detail remains available. Cost depends on visible crowns and projected Gaussian support, rather than tree count alone. Camera motion keeps each visible tree in its instance slot, so trees crossing the view edge update only their own wood and canopy rows. Subpixel wood simplifies to a bole; high-density groves retain nearby branches through stable complementary coverage with their splat crowns, while distant wood uses compact boles. Measure delivered frame intervals and tail latency on the intended device.

### Automatic submission budgets

`maxCanopySplats` defaults to `'auto'`: it resolves once for each device to 20,000 submissions on a real GPU, or 5,000 for a known software, fallback, or CPU adapter. Pass a number for an explicit shared cap. The automatic value remains fixed while the camera moves, avoiding quota-driven LOD churn. `TreeLayer` supplies the canopy template, transforms and shared cap; `SplatLayer` owns projected-support screen-error selection and decides each visible crown's hierarchy level independently. The cap is independent of total inventory size, so close views of a large grove can refine up to the requested limit while distant crowns remain coarse. Every canopy remains on `SplatLayer`, with its finest leaf templates available. Tree canopy hierarchies retain at least two spatial aggregates at their floor rather than reducing a crown to one point. If the coarsest owner coverage exceeds the budget, coverage wins; use regional source aggregation for world-scale residency beyond a bounded grove.

`maxCanopyPixels` defaults to `Infinity`. A finite value caps the shared Gaussian accumulation target without changing host-resolution wood or owner picking. An explicitly low target softens leaf edges and reduces branch-occlusion precision.

`foveationStrength` (default `0`) optionally applies a smooth priority weight to each projected crown center when the shared budget is constrained. One retains full central allocation priority and lowers peripheral priority to 0.15 at the screen boundary. It does not lower the hierarchy requested by a visible crown.

`getCoverageWeight` applies to wood, fallback trunks, foliage and every crop kind, including picking. It defaults to one and supports optical canopy fades and matching wood coverage during streamed replacement. Automatic wood refinement selects one opaque coarse or fine skeleton per tree, avoiding stochastic holes between different mesh surfaces. The coarse shell retains structural aerial and stilt roots. Native wood cross-sections follow `getTrunkRadius` independently of canopy spread; branch centerlines remain aligned with the leaf growth structure.

### Prepared canopy assets

Canopy sublayers use `SplatLayer` with owner rows and cached `prepared-splats` descriptors through
`getSource`. They use SplatLayer's weighted, order-independent transparency by default, avoiding a
per-frame sort of every leaf. Canopy group IDs and `_subLayerProps` aliases remain stable.
The shared runtime allocates the `maxCanopySplats` budget across all canopy roots. An explicit child
quota still limits that child. Wood and crops use their mesh paths; tree traits, seasons and
original-tree picking remain TreeLayer responsibilities.

## Example

The [TreeLayer demo](/examples/layers/tree-lab) renders one pickable 10,000-tree mixed-species authored core, with 1,250 owners for each supported species, plus a deterministic 6,600-tree continuation field: a dense, irregular apron overlaps the core boundary before the forest tapers into middle-distance and horizon trees. It uses `getTree` for global season and shared crown-characteristic controls, plus MapView camera presets. The demo uses no shadow effect; `SplatLayer` owns its per-crown LOD allocation.
