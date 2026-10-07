# TreeLayer

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

`TreeLayer` is the public renderer for both supplied rows and streamed geographic inventories. Supply `getTileData` instead of a global `data` array to stream through its internal tile component. `WorldTreeLayer` remains a deprecated compatibility wrapper; `TreeWoodLayer` and `TreeMeshLayer` are internal sublayers, not alternate public tree renderers. Comparison fixtures live only in examples.

## Authored tree traits

`getTree` defaults to the source row and accepts a constant `TreeSpec` or `(row, accessorContext) => TreeSpec`. Supply a position and species; height, crown dimensions, first-branch height and bole thickness have species defaults. `height` and nominal `crownRadius` use metres. Per-tree `characteristics` selects a shared wood/leaf morphology, `season` controls foliage, `crop` is explicit, and `wind` accepts `true` (0.025), `false`, or a bend fraction up to 0.2. Omitted wind uses the layer's `windStrength`. Optional colors and elevation also live in the same object.

Explicit granular accessors override corresponding `getTree` fields, so hosts can change a global season or bind a single field without rebuilding their inventory. Function accessors follow deck.gl's `updateTriggers` convention; use `updateTriggers.getTree` when a mapped trait function's captured values change. Position changes, species, crops and morphology rebuild prepared owner rows; global wind and animation time retain geometry. Default transforms and deterministic variation are shared across wood, leaves, crops, picking and shadows.

The layer owns template sharing, mesh/splat composition, spatial visibility, refinement and bounded Gaussian work. There is no manual `detail` mode. Keep common morphology presets shared: unique botanical skeletons require distinct templates and draws. Sizes, colors, seasons and wind vary per instance without unique meshes. Host lighting still follows deck.gl's `LightingEffect` convention; translucent foliage shadow integration has the receiver limitations described below.

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
| `sizeScale` | `1` | Multiplier for tree and crop dimensions. |
| `characteristics` | `{}` | Shared broadleaf morphology; changes regenerate the connected wood, leaves and crop attachment together. See below. |
| `windStrength` | `0` | Bend amplitude as a fraction of tree height. Zero stops continuous redraw when no per-tree wind is authored; a value around `0.025` is a gentle breeze. |
| `windTime` | `null` | Wind time in seconds. `null` uses deck.gl's timeline; a number freezes the pose for controlled comparisons. |
| `shadowEnabled` | `true` | Cast shadows from opaque wood and crops with `LightingEffect`; translucent foliage needs the host optical shadow integration described below. |

## Crops

`CropConfig` has `color`, `count`, `radius` and optional `droppedCount` and `kind`. Shapes are `fruit` (the default sphere), `lemon`, `cone`, `acorn`, `catkin`, `flower` and `propagule`. Radius is the enclosing sphere radius in metres, including elongated shapes and petals. Counts are explicitly supplied, rounded down and clamped at zero. Broadleaf crops attach to leaf-bearing shoots inside the same clusters used for foliage. Placement reserves clearance for the complete sphere under the tree’s anisotropic scale; attached crops too large to fit are omitted. Palm crops cluster beneath the frond sockets. Dropped crops use the same conservative spherical bounds above the ground. Positions are deterministic, remain stable when counts grow, and picking returns the owning source tree. Attached crops share the tree's GPU bend; dropped crops remain still.

## Animation and shadows

Wind is implemented in GLSL and WGSL. Trunks, crowns, attached crops, picking and WebGL shadow passes use the same deformation. Time changes do not rebuild geometry, regroup data or regenerate instance attributes.

For opaque WebGL shadows, supply a deck.gl `LightingEffect` with a `DirectionalLight` whose `_shadow` option is enabled. Gaussian foliage additionally needs a light-space transmission pass. A host can combine the public `SplatShadowPass` with mesh depth on a planar receiver; see [SplatLayer shadows](./splat-layer.md#shadows) for the integration and receiver limitations. WebGPU shadow effects are not supported by deck.gl.

## Migration

Remove `detail` from TreeLayer props and `TreeDetail` from type imports. TreeLayer now composes full leaf Gaussian sources and continuous woody meshes, with automatic refinement for subpixel crowns and branches. Legacy demo `detail` query parameters are ignored.

The deprecated `@deck.gl-community/three` workspace temporarily re-exports the same native `TreeLayer` constructor. Update imports and dependencies to `@deck.gl-community/layers`, including `TreeLayerProps`, `TreeType`, `Season` and `CropConfig`. The production renderer has no Three.js dependency; the compatibility workspace will be removed with the examples migration.

Gaussian crowns and connected winter silhouettes deliberately differ from the original geometry. `CropConfig.radius` now matches its documented radius: older geometry rendered half that radius. Halve an existing crop radius to retain its old apparent size. Inspect your explicit seasonal foliage overrides, canopy sublayer overrides and custom winter branches when migrating; the native crown sublayer IDs include foliage/winter and tier information. Legacy species overrides such as `canopy-cherry` remain supported and apply after native defaults. Exact grouped sublayer IDs take precedence over species aliases. Custom wood meshes reach both camera and shadow children without the native template morph; arbitrary custom geometry is kept conservatively visible. Overridden wood transform accessors and their triggers also determine culling bounds. Override accessors receive the source tree and its original accessor context; parameters and update triggers merge by key.

[Source](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/tree-layer)

## Canopy composition

`canopy-{species}-foliage-{tier}` sublayers are now `SplatLayer` composites, so mesh-specific canopy overrides no longer apply. `wood-{species}-{foliage|winter}-{tier}` sublayers own the connected woody mesh. The `trunks` alias applies bark overrides to connected wood; exact wood IDs take precedence. Deciduous winter has no canopy sublayer. Crop layers remain meshes and their owner picking and accessor contexts are unchanged.

Deciduous boles divide into curved, tapered limbs, secondary branches and terminal twigs. The same botanical structure places leaf clusters around those shoots and attaches fruit inside them. The trunk and branches form one closed, connected triangle surface. Branch roots reuse socket boundary vertices, with smooth normals across their junctions. Palm shafts and frond stems share that surface; leaflets remain translucent Gaussians. Wind, crop locations and tree yaw remain stable across seasonal foliage changes. These are deterministic procedural botanical templates, not trained photographic reconstructions.


## Procedural growth and motion

Broadleaf crowns use a bounded [space-colonization model](https://algorithmicbotany.org/papers/colonization.egwnp2007.pdf). Irregular crown volumes supply attraction points. The nearest eligible shoot grows in the normalized sum of directions to its points, with apical persistence and upward tropism; nearby points are consumed. Each species template has at most 600 growth nodes and 64 iterations per shared template. Interactive templates use bounded LRU caches (16 botanical/source templates and 32 full/distant woody meshes). Terminal shoot counts determine pipe-model taper with exponent 2.3. Tube frames are transported along the curves; junctions reuse parent vertices. This produces asymmetric paths and forks instead of repeated spherical lobes.

The banyan template has a broad crown, ovate leaves and aerial roots descending from spreading limbs. Red mangrove has large elliptical leaves and arching stilt roots attached to the bole. Their evergreen foliage remains visible in every season. These traits follow [Flora of North America](https://efloras.org/florataxon.aspx?flora_id=1&taxon_id=233500648) and [UF/IFAS](https://ask.ifas.ufl.edu/publication/FR460); dimensions are procedural, not measured specimens. The demo uses elongated mangrove propagules, pine cones, capped oak acorns, birch catkins, cherry fruit or spring flowers, small banyan figs and palm coconuts; supplied shapes and colors remain caller-controlled.

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

Citrus Lab exposes orange, lemon and lime forms with coherent structural controls, crop stages and branch inspection. Citrus remains evergreen through all seasons; white blossom, green fruit and ripe fruit are separate explicit inputs. Maturity varies with cultivar and location, as described by [UF/IFAS](https://ask.ifas.ufl.edu/publication/HS132). A variety preset is an illustrative tree form, not a cultivar reconstruction or ripening calendar.

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

Wood and foliage keep persistent owner bounds for camera and light-volume queries. Mercator bounds use each owner's geographic latitude, so camera pans preserve the index. Offscreen trees remain eligible for light-space shadows; camera refinement does not restore the entire forest to the shadow list. Mesh wind phases are prepared per owner while the animation clock supplies shared frame uniforms.

The highest source detail remains available. Cost depends on the visible crowns, projected Gaussian support and shadow volume, rather than tree count alone. Measure delivered frame intervals and tail latency on the intended device.

### Automatic submission budgets

`maxCanopySplats` (default 250,000) and `maxShadowSplats` (default 125,000) apportion independent Gaussian submission budgets across species. They preserve every visible owner using the existing covariance hierarchy, prioritize projected error reductions, and retain finest leaf templates. If the coarsest owner coverage exceeds a budget, coverage wins; use [TreeLayer geographic streaming](./world-tree-layer.md) with `getTileData` and regional source aggregation for world-scale residency and automatic frame feedback. Large inventories should never be supplied as one global `TreeLayer.data` array.

`maxCanopyPixels` defaults to `Infinity`. A finite value caps the shared Gaussian accumulation target without changing host-resolution wood or owner picking. The streaming mode keeps this raster target fixed while geometry budgets adapt; an explicitly low target softens leaf edges and reduces branch-occlusion precision.

`foveationStrength` (default zero) applies a smooth priority weight to each projected crown center. One retains full central error priority and lowers peripheral priority to 0.15 at the screen boundary. It changes automatic refinement and quota allocation, preserves visible owners, and leaves light-space shadow refinement independent. Set it to one in streamed inventories to favor central crowns.

`getCoverageWeight` applies to wood, fallback trunks, foliage and every crop kind, including their picking and shadow passes. It defaults to one and supports optical canopy fades and matching wood coverage during streamed replacement. Automatic wood refinement blends the connected fine and coarse skeletons with complementary pixel coverage. Native wood cross-sections follow `getTrunkRadius` independently of canopy spread; branch centerlines remain aligned with the leaf growth structure.

## Examples

[Tree Lab](/examples/layers/tree-lab) compares Gaussian crowns with an explicitly named mesh reference. [Citrus Lab](/examples/layers/citrus-lab) edits botanical traits, crops, sun and seasons. [Tree Forest](/examples/layers/tree-forest) and [Tree World](/examples/layers/tree-world) exercise bounded rendering and synthetic streaming.

### Prepared canopy assets

Canopy sublayers use `SplatLayer` with owner rows, cached `prepared-splats` descriptors through
`getSource`, and explicit weighted transparency. Canopy group IDs and `_subLayerProps` aliases
remain stable. The shared runtime allocates `maxCanopySplats` and `maxShadowSplats` across all
canopy roots. An explicit child quota still limits that child. Wood and crops use their existing
mesh paths; tree traits, seasons and original-tree picking remain TreeLayer responsibilities.

### Geographic inventories

Use `new TreeLayer({getTileData, getTreeKey, ...})` for a bounded source inventory. Species,
season, wind, crop, picking and material accessors remain at the top level, as in row mode.
`getDistantCanopyColor` tints unresolved source-built groups separately from individual-tree
`getCanopyColor`. Request/cache controls, continuous replacement, automatic frame budgets and
`streamingStats` are described in the [geographic streaming reference](./world-tree-layer.md).
The same public layer works at specimen, forest and world scales; it never materializes a global
inventory to manufacture rows. Coit depends on SplatLayer alone and does not use this tree API.
