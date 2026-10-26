import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# TreeLayer

<LayerLiveExample highlight="tree-layer" size="tall" />

`TreeLayer` renders procedural, instanced 3D trees: connected trunk-and-branch meshes with
Gaussian-splat foliage drawn by [`SplatLayer`](./splat-layer.md). Eight species share
templates, so size, season, color and crops vary per tree without unique meshes. It
runs on WebGL2 and WebGPU.

The demo above is the [Seasonal Farm example](/examples/layers/seasonal-farm).

## Usage

```ts
import {TreeLayer} from '@deck.gl-community/layers';

new TreeLayer({
  id: 'trees',
  data: [
    {position: [-122.4194, 37.7749], species: 'oak', height: 10, season: 'autumn'},
    {
      position: [-122.4196, 37.7749],
      species: 'citrus',
      height: 5,
      crop: {kind: 'fruit', color: [244, 153, 34, 255], count: 40, radius: 0.08}
    }
  ],
  pickable: true
});
```

Wind is deck-wide: a [`WindEffect`](./wind-effect.md) on the deck bends every tree layer with
the same speed, direction, gusts and clock, `new Deck({effects: [new WindEffect({speed: 6})], layers})`.
Trees are still without one.

Each row is a [`TreeSpec`](#treespec) by default. Use `getTree` to map other records:

```ts
new TreeLayer({
  data: records,
  getTree: record => ({position: record.coordinates, species: record.kind, height: record.height})
});
```

## Properties

Inherits all [`CompositeLayer`](https://deck.gl/docs/api-reference/core/composite-layer)
properties. Picking, `autoHighlight` and `highlightedObjectIndex` use the source row.

| Property | Default | Description |
| --- | --- | --- |
| `getTree` | `d => d` | Returns the [`TreeSpec`](#treespec) for a row. |
| `characteristics` | `{}` | Shared crown morphology for every tree. See [Characteristics](#characteristics). |
| `sizeScale` | `1` | Multiplier for all tree and crop dimensions. |
| `windEnabled` | `true` | Bend with the deck's [`WindEffect`](./wind-effect.md). `false` keeps this layer still in a windy scene, as `shadowEnabled` opts out of shadows. |
| `maxCanopySplats` | `'auto'` | Shared foliage splat budget. `'auto'` picks one for the device. |
| `maxCanopyPixels` | `Infinity` | Pixel cap for foliage rendering. Lower values soften leaves. |
| `foveationStrength` | `0` | `0`–`1`. Under a tight budget, favors crowns near the screen center. |
| `getCoverageWeight` | `1` | Per-tree optical coverage, for fading trees in and out. |

### Per-field accessors

Each accessor overrides one `TreeSpec` field, so you can change a single trait, such as a
global season, without rebuilding your data. Function accessors follow deck.gl's
`updateTriggers` convention.

| Accessor | Overrides | Fallback |
| --- | --- | --- |
| `getPosition` | `position` | `d => d.position` |
| `getElevation` | `elevation` | `0` |
| `getTreeType` | `species` | `'pine'` |
| `getHeight` | `height` | species default |
| `getTrunkHeightFraction` | `trunkHeightFraction` | species default |
| `getTrunkRadius` | `trunkRadius` | species default |
| `getCanopyRadius` | `crownRadius` | species default |
| `getTrunkColor` | `trunkColor` | species default |
| `getCanopyColor` | `canopyColor` | species and season default |
| `getSeason` | `season` | `'summer'` |
| `getBranchLevels` | `branchLevels` | `3` |
| `getCrop` | `crop` | `null` |

`getCanopyRadius` uses a legacy scale: broadleaf crowns render at about half its value. For a
crown radius in metres, set `crownRadius` in `getTree` instead.

## Types

### TreeSpec

| Field | Description |
| --- | --- |
| `position` | Tree base position. Required. |
| `species` | One of the species below. Required. |
| `height` | Total height in metres. |
| `crownRadius` | Crown radius in metres. |
| `trunkRadius` | Trunk base radius in metres. |
| `trunkHeightFraction` | Fraction of height below the crown, `0`–`1`. |
| `elevation` | Base elevation in metres. |
| `season` | `spring`, `summer`, `autumn` or `winter`. |
| `crop` | Optional [`CropConfig`](#cropconfig). Trees never get crops unless you supply them. |
| `characteristics` | Per-tree [characteristics](#characteristics), merged over the layer prop. |
| `trunkColor` | RGBA bark color override. |
| `canopyColor` | RGBA foliage color override. |
| `branchLevels` | Pine tier count, `1`–`5`. |

Species are `pine`, `oak`, `palm`, `birch`, `cherry`, `banyan`, `mangrove` and `citrus`. Oak,
birch and cherry lose their leaves in winter; the others are evergreen.

### CropConfig

| Field | Description |
| --- | --- |
| `color` | RGBA crop color. |
| `count` | Crops attached inside the crown. |
| `radius` | Enclosing radius in metres. Crops too large to fit the crown are omitted. |
| `droppedCount` | Optional crops scattered on the ground. |
| `kind` | `fruit` (default), `lemon`, `cone`, `acorn`, `catkin`, `flower` or `propagule`. |

### Characteristics

Characteristics shape broadleaf crowns and leaves. Pine and palm keep their own silhouettes.
Changing them regenerates the shared templates, so keep the number of distinct combinations
small.

| Field | Default | Range | Effect |
| --- | --- | --- | --- |
| `seed` | `0` | integer | Growth pattern. |
| `crownSpread` | `1` | `0.6`–`1.5` | Crown width. |
| `crownDepth` | `1` | `0.6`–`1.4` | Crown height. |
| `crownAsymmetry` | `1` | `0`–`2` | Lopsidedness. |
| `branchDensity` | `1` | `0.5`–`1.5` | Number of branches. |
| `branchLift` | `1` | `0`–`3` | Upward branch angle. |
| `internodeLength` | `1` | `0.7`–`1.4` | Branch segment length. |
| `leafSize` | `1` | `0.5`–`1.8` | Leaf size. |
| `leafDensity` | `1` | `0.25`–`2` | Leaf count. |

## Shadows

Trees cast and receive deck.gl `LightingEffect` shadows on WebGL2, like other deck.gl layers.
Opt out with deck.gl's standard `shadowEnabled: false`.

## Limitations

- Supports `MapView`, `GlobeView` and Cartesian views. With `MapView.repeat`, trees render in the
  primary world copy only. See [SplatLayer limitations](./splat-layer.md#limitations).
- On `GlobeView`, wood, crops and canopies share one east-north-up pose per tree, unchanged across
  the zoom-12 switch to Web Mercator. Canopies and connected wood behind the horizon are skipped;
  crops rely on a globe surface's depth, such as MapLibre's globe, to hide the far side.
- In Cartesian and metre-offset coordinates, `modelMatrix` supports translation only.

## Source

[modules/layers/src/tree-layer](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/tree-layer)
