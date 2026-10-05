# TreeLayer

An instanced, procedural tree layer built entirely with deck.gl, luma.gl and math.gl. Five species share cached CPU meshes; winter deciduous trees expose branching crowns. No Three.js runtime dependency is required.

```ts
import {TreeLayer} from '@deck.gl-community/layers';

new TreeLayer({
  data: trees,
  getPosition: tree => tree.position,
  getTreeType: tree => tree.species,
  getHeight: tree => tree.height,
  getSeason: () => 'summer',
  detail: 'high',
  windStrength: 0.025,
  pickable: true
});
```

Try [Tree Lab](/examples/layers/tree-lab) for synchronized original/native specimens of every species, seasonal controls, supplied crop points, shadows and wind.

## Properties

Inherits the deck.gl `CompositeLayer` properties. Accessors are functions of the source data object.

| Property | Default | Meaning |
| --- | --- | --- |
| `getPosition` | `d => d.position` | Longitude/latitude position of the tree base; the host coordinate system also supports local coordinates. |
| `getElevation` | `() => 0` | Base elevation in metres. |
| `getTreeType` | `() => 'pine'` | `pine`, `oak`, `palm`, `birch` or `cherry`. |
| `getHeight` | `() => 10` | Total nominal height in metres. |
| `getTrunkHeightFraction` | `() => 0.35` | Trunk fraction, clamped to 0–1. Palm shafts extend into the crown. |
| `getTrunkRadius` | `() => 0.5` | Trunk base radius in metres. |
| `getCanopyRadius` | `() => 3` | Horizontal canopy scale, retaining the legacy approximate half-scale broadleaf radius. Palms and pines have their own silhouette envelopes. |
| `getTrunkColor` | `() => null` | Explicit bark color or the species default. |
| `getCanopyColor` | `() => null` | Explicit foliage color or the species/season default. Winter branches use bark color. Vertex tones multiply this color. |
| `getSeason` | `() => 'summer'` | `spring`, `summer`, `autumn` or `winter`. Winter removes deciduous foliage; pine and palm remain evergreen. |
| `getBranchLevels` | `() => 3` | Pine tier count, rounded and clamped to 1–5. |
| `getCrop` | `() => null` | Explicit crop configuration; the layer never invents seasonal yield. |
| `sizeScale` | `1` | Multiplier for tree and crop dimensions. |
| `detail` | `'high'` | `low`, `medium` or `high`. Use separate detail layers for distant and nearby trees; automatic distance selection is not provided. |
| `windStrength` | `0` | Bend amplitude as a fraction of tree height. Zero stops continuous redraw; a value around `0.025` is a gentle breeze. |
| `windTime` | `null` | Wind time in seconds. `null` uses deck.gl's timeline; a number freezes the pose for controlled comparisons. |
| `shadowEnabled` | `true` | Cast shadows when enabled by the host `LightingEffect`. |

## Crops

`CropConfig` has `color`, `count`, `radius` and optional `droppedCount`. Radius is the actual sphere radius in metres. Counts are explicitly supplied, rounded down and clamped at zero. Broadleaf crops follow the shared outer crown envelope; palm crops cluster beneath the crown. Dropped spheres rest on the ground. Positions are deterministic, remain stable when counts grow, and picking returns the owning source tree. Attached crops share the tree's GPU bend; dropped crops remain still.

## Animation and shadows

Wind is implemented in GLSL and WGSL. Trunks, crowns, attached crops, picking and WebGL shadow passes use the same deformation. Time changes do not rebuild geometry, regroup data or regenerate instance attributes.

For WebGL shadows, supply a deck.gl `LightingEffect` with a `DirectionalLight` whose `_shadow` option is enabled, and a receiving ground surface. Shadows are an extra rendering pass. WebGPU shadow effects are not supported by deck.gl; Tree Lab disables that control on WebGPU.

## Migration

The legacy `@deck.gl-community/three` package has been removed from this repository. Replace its imports with `@deck.gl-community/layers`, including `TreeLayerProps`, `TreeType`, `Season`, `CropConfig` and `TreeDetail`. Previously published package versions are unchanged. Three.js is used only by Tree Lab's frozen development fixture.

Native crowns and winter silhouettes deliberately differ from the original geometry. `CropConfig.radius` now matches its documented radius: older geometry rendered half that radius. Halve an existing crop radius to retain its old apparent size. Inspect your explicit seasonal foliage overrides, canopy sublayer overrides and custom winter branches when migrating; the native crown sublayer IDs include foliage/winter and tier information. Legacy species overrides such as `canopy-cherry` remain supported and apply after native defaults. Exact grouped sublayer IDs take precedence over species aliases. Override accessors receive the source tree and its original accessor context; parameters and update triggers merge by key.

[Source](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/tree-layer)
