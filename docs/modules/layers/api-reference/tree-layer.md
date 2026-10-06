# TreeLayer

An instanced, procedural tree layer built entirely with deck.gl, luma.gl and math.gl. Eight species share immutable Gaussian leaf templates and connected trunk-and-branch meshes. Winter removes deciduous foliage while retaining the same wood. Automatic screen-error refinement retains the full authored source for close views. No Three.js runtime dependency is required.

```ts
import {TreeLayer} from '@deck.gl-community/layers';

new TreeLayer({
  data: trees,
  getPosition: tree => tree.position,
  getTreeType: tree => tree.species,
  getHeight: tree => tree.height,
  getSeason: () => 'summer',
  windStrength: 0.025,
  pickable: true
});
```

Try [Tree Lab](/examples/layers/tree-lab) for synchronized native mesh/Gaussian specimens of every species, seasonal controls, supplied crop points, shadows and wind.

## Properties

Inherits the deck.gl `CompositeLayer` properties. Accessors are functions of the source data object.

| Property | Default | Meaning |
| --- | --- | --- |
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
| `windStrength` | `0` | Bend amplitude as a fraction of tree height. Zero stops continuous redraw; a value around `0.025` is a gentle breeze. |
| `windTime` | `null` | Wind time in seconds. `null` uses deck.gl's timeline; a number freezes the pose for controlled comparisons. |
| `shadowEnabled` | `true` | Cast shadows from opaque wood and crops with `LightingEffect`; translucent foliage needs the host optical shadow integration described below. |

## Crops

`CropConfig` has `color`, `count`, `radius` and optional `droppedCount` and `kind`. Shapes are `fruit` (the default sphere), `lemon`, `cone`, `acorn`, `catkin`, `flower` and `propagule`. Radius is the enclosing sphere radius in metres, including elongated shapes and petals. Counts are explicitly supplied, rounded down and clamped at zero. Broadleaf crops attach to leaf-bearing shoots inside the same clusters used for foliage. Placement reserves clearance for the complete sphere under the tree’s anisotropic scale; attached crops too large to fit are omitted. Palm crops cluster beneath the frond sockets. Dropped crops use the same conservative spherical bounds above the ground. Positions are deterministic, remain stable when counts grow, and picking returns the owning source tree. Attached crops share the tree's GPU bend; dropped crops remain still.

## Animation and shadows

Wind is implemented in GLSL and WGSL. Trunks, crowns, attached crops, picking and WebGL shadow passes use the same deformation. Time changes do not rebuild geometry, regroup data or regenerate instance attributes.

For opaque WebGL shadows, supply a deck.gl `LightingEffect` with a `DirectionalLight` whose `_shadow` option is enabled. Gaussian foliage additionally needs a light-space transmission pass. Tree Lab combines the public `SplatShadowPass` with mesh depth and soft coverage filtering on its planar ground; see [SplatLayer shadows](./splat-layer.md#shadows) for the integration and receiver limitations. WebGPU shadow effects are not supported by deck.gl; Tree Lab disables that control on WebGPU.

## Migration

Remove `detail` from TreeLayer props and `TreeDetail` from type imports. TreeLayer now composes full leaf Gaussian sources and continuous woody meshes, with automatic refinement for subpixel crowns and branches. Legacy demo `detail` query parameters are ignored.

The legacy `@deck.gl-community/three` package has been removed from this repository. Replace its imports with `@deck.gl-community/layers`, including `TreeLayerProps`, `TreeType`, `Season` and `CropConfig`. Previously published package versions are unchanged. Three.js is used only by Tree Lab's frozen development fixture.

Gaussian crowns and connected winter silhouettes deliberately differ from the original geometry. `CropConfig.radius` now matches its documented radius: older geometry rendered half that radius. Halve an existing crop radius to retain its old apparent size. Inspect your explicit seasonal foliage overrides, canopy sublayer overrides and custom winter branches when migrating; the native crown sublayer IDs include foliage/winter and tier information. Legacy species overrides such as `canopy-cherry` remain supported and apply after native defaults. Exact grouped sublayer IDs take precedence over species aliases. Override accessors receive the source tree and its original accessor context; parameters and update triggers merge by key.

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

[Citrus Lab](/examples/layers/citrus-lab) exposes orange, lemon and lime forms with coherent structural controls, crop stages and branch inspection. Citrus remains evergreen through all seasons; white blossom, green fruit and ripe fruit are separate explicit inputs. Maturity varies with cultivar and location, as described by [UF/IFAS](https://ask.ifas.ufl.edu/publication/HS132). A variety preset is an illustrative tree form, not a cultivar reconstruction or ripening calendar.

```ts
new TreeLayer({
  data: orchard,
  getTreeType: () => 'citrus',
  characteristics: {seed: 19, crownDepth: 0.8, branchLift: 0.8, leafSize: 1.15},
  getCrop: () => ({kind: 'lemon', color: [245, 211, 37], count: 40, radius: 0.052})
});
```

Shaped crops use suffixes such as `live-crops-lemon`; spherical fruit retains `live-crops` and `dropped-crops`. Picking still resolves to the source tree.
