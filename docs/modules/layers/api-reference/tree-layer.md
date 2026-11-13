import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# TreeLayer

<LayerLiveExample highlight="tree-layer" size="tall" />

`TreeLayer` renders procedural 3D trees on WebGL2 and WebGPU. Templates describe wood,
foliage and crop attachments for eight species, with individual leaves up close, fitted
leaf clumps at middle distances and fitted crown hulls farther away. Trees sharing a
template can vary in size, growth, foliage, color, crops and wind.

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
  windStrength: 0.025,
  pickable: true
});
```

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
| `characteristics` | `{}` | Shared template characteristics. See [Characteristics](#characteristics). |
| `sizeScale` | `1` | Multiplier for all tree and crop dimensions. |
| `lodBias` | `0` | Positive values switch to simpler crown detail closer to the camera. Negative values retain individual detail farther away. |
| `windStrength` | `0` | Wind bend as a fraction of tree height. `0.025` is a gentle breeze, and `1` a hurricane. |
| `windDirection` | `null` | Compass bearing in degrees, clockwise from +y (north), that the wind blows toward. Gusts then travel across the grove. `null` sways trees in no particular direction. |
| `windTime` | `null` | Wind clock in seconds. `null` follows deck.gl's animation timeline. |
| `getCoverageWeight` | `1` | Per-tree optical coverage, for fading trees in and out. |
| `transitions` | `null` | Interpolation settings keyed by a TreeLayer accessor. Pass a duration in milliseconds or an object with `duration` and optional `easing`. |
| `woodMaterial`, `foliageMaterial`, `cropMaterial` | `null` | Optional Phong material overrides. |

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
| `getGrowth`, `getHealth`, `getFoliage` | `growth`, `health`, `foliage` | `1` |
| `getFlush`, `getDamage`, `getDecay` | `flush`, `damage`, `decay` | `0` |
| `getLean` | `lean` | `[0, 0]` |

`getCanopyRadius` uses a legacy scale: broadleaf crowns render at about half its value. For a
crown radius in metres, set `crownRadius` in `getTree` instead.

## Types

### TreeSpec

| Field | Description |
| --- | --- |
| `position` | Tree base position. Required. |
| `species` | One of the species below. Defaults to pine. |
| `height` | Total height in metres. |
| `crownRadius` | Crown radius in metres. |
| `trunkRadius` | Trunk base radius in metres. |
| `trunkHeightFraction` | Fraction of height below the crown, `0`–`1`. |
| `elevation` | Base elevation in metres. |
| `season` | `spring`, `summer`, `autumn` or `winter`. |
| `crop` | A [`CropConfig`](#cropconfig) value or `null`. |
| `growth` | Fraction of the tree's development, from 0 to 1. Defaults to 1. |
| `health` | Foliage health, from 0 to 1. Defaults to 1. |
| `foliage` | Leaf coverage, from 0 to 1. Defaults to the season. |
| `flush` | Amount of new growth color, from 0 to 1. Defaults to 0. |
| `lean` | Tuple of tilt and compass bearing in degrees. Broadleaf templates show a root plate when a tree leans far enough to lift it. |
| `damage` | Limb damage, from 0 to 1. Defaults to 0. |
| `decay` | Wood and leaf decay, from 0 to 1. Defaults to 0. |
| `wind` | `true`, `false` or a bend fraction from 0 to 1. Defaults to `windStrength`. |
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
| `radius` | Enclosing radius in metres. |
| `droppedCount` | Crops scattered on the ground, in addition to `count`. |
| `kind` | `fruit` (default), `lemon`, `cone`, `acorn`, `catkin`, `flower` or `propagule`. |

### Characteristics

Characteristics shape broadleaf crowns and leaves. Pine uses its own branching tiers and
needle shapes. For palm, `seed` varies the frond template. Changing characteristics regenerates
shared templates, so keep the number of distinct combinations small.

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
| `branchWander` | `1` | `0`–`2` | Curvature of limbs and shoots. |
| `twigDroop` | `1` | `0`–`2` | Droop of outer shoots and twigs. |

## Wind

With `windDirection`, gust fronts travel downwind across a grove. `windStrength` controls bend
and gust intensity. Gusts, sway, flutter and falling leaves all follow `windTime`.

## Shadows

Use deck.gl's `LightingEffect` with a `DirectionalLight` whose `_shadow` is `true`. The effect
sets the shadow map's coverage, resolution and color. `TreeLayer` casts and receives shadows on
WebGL2 and WebGPU and keeps its caster geometry stable across visible canopy LOD changes.
Set `shadowEnabled: false` to stop trees from casting. Separate ground and terrain layers need
shader support for receiving shadows on their backend. In deck.gl 9.4, the Seasonal Farm plot
polygons receive shadows on WebGL2.

## Limitations

- Supports `MapView`, `GlobeView` and Cartesian views. With `MapView.repeat`, trees render in the
  primary world copy only.
- On `GlobeView`, wood, crops and canopies share one east-north-up pose per tree, unchanged across
  the zoom-12 switch to Web Mercator. Canopies and connected wood behind the horizon are skipped;
  crops rely on a globe surface's depth, such as MapLibre's globe, to hide the far side.
- In Cartesian and metre-offset coordinates, `modelMatrix` supports translation only.

## Migrating from the Gaussian canopy renderer

Remove `maxCanopySplats`, `maxCanopyPixels` and `foveationStrength`. If you used a preview build,
remove its `quality` switch as well. Set
`lodBias` to tune the distance at which trees use coarser detail. Use the source row's
`TreeSpec` or field accessors to control appearance. Custom sublayer overrides that target
Gaussian canopies need to move to the tree's supported material, accessor or extension
properties. A standalone Gaussian canopy can still use [`SplatLayer`](./splat-layer.md).

## Source

[modules/layers/src/tree-layer](https://github.com/visgl/deck.gl-community/tree/master/modules/layers/src/tree-layer)
