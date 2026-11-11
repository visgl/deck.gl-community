import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# TreeLayer

<LayerLiveExample highlight="tree-layer" size="tall" />

`TreeLayer` renders procedural, instanced 3D trees: connected trunk-and-branch meshes with
Gaussian-splat foliage drawn by [`SplatLayer`](./splat-layer.md). Eight species share
templates, so size, season, color, crops and wind vary per tree without unique meshes. It
runs on WebGL2 and WebGPU.

The demo above is the [Seasonal Farm example](/examples/layers/seasonal-farm).

This integration branch includes an opt-in photoreal renderer. Set `quality: 'photoreal'`
on WebGL2 to draw grown wood, individual leaves, and attached crops for oak, birch, cherry,
banyan, mangrove, and citrus. Pine, palm, and WebGPU use the standard renderer.

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
| `quality` | `'standard'` | Set to `'photoreal'` to try the WebGL2 renderer on supported species. |
| `characteristics` | `{}` | Shared crown morphology for every tree. See [Characteristics](#characteristics). |
| `sizeScale` | `1` | Multiplier for all tree and crop dimensions. |
| `windStrength` | `0` | Wind bend as a fraction of tree height. `0.025` is a gentle breeze, and `1` a hurricane. |
| `windDirection` | `null` | Compass bearing in degrees, clockwise from +y (north), that the wind blows toward. Gusts then travel across the grove. `null` sways trees in no particular direction. |
| `windTime` | `null` | Wind clock in seconds. `null` follows deck.gl's animation timeline. |
| `windGustTime` | `null` | The clock gust fronts run on, so that a host can time a gust. `null` runs them on `windTime`. See [Wind](#wind). |
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
| `wind` | `true`, `false` or a bend fraction up to `0.2`. Defaults to `windStrength`. |
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

## Wind

With a `windDirection`, gusts come in broad fronts that roll downwind across a grove at
about 12 m for each second of the gust clock, with a quicker chop over them. Each tree bends,
its crown combs over and its leaves flip pale as a front passes. Past a breeze, from a
`windStrength` of `0.06` and in full by about `0.85`, a wind blows as a storm does. Lulls are
longer and the crowns stay dark in them, while a front bows a crown to about twice its lull
bend and silvers it: a leaf it holds over shows its pale, matte, grey-green underside, and near
the camera faces the open sky with it, from whichever side it is seen. How pale a flip is comes
from the layer's own wind, so a tree with less wind of its own than the layer's silvers as much
when it flips, only less often. Leaves shed in the wind fly downwind from where their twigs were,
at their true size. Near the camera each is drawn as its own outline over the last moment of its
flight, a soft streak that blends, so that renders which add up several moments of a frame give
it motion blur rather than a row of copies. Fewer of them fly within about 12 m of the camera,
and none within about 1.6 m.

With `wetness`, about a third of the leaves hold beads of water that mirror the sun, the first
directional light, in a lobe so tight that only the few facing halfway between the sun and the
camera sparkle at a time, over the leaves' own green. A leaf a few pixels long flashes as a whole;
a far crown's leaf, which stands for several, flashes as one of them would; close up the beads are
small domes on the blade, each with its own point of light. Only beads the sun reaches glint, so a
blade seen against a low sun has none on the side facing the camera.

The fronts run on `windGustTime`, or on `windTime` when it is `null`. Sway, flutter, falls and
everything else stay on `windTime`. A story can run the gust clock faster or slower through a
moment so that a front reaches a place on a beat, while the trees keep their own pace.

`getTreeWindGust` reads the same gust on the CPU, from 0 to 1, so that grass, water, spray, a
camera shake or a sound can move with the trees:

```ts
import {getTreeWindGust} from '@deck.gl-community/layers';

const gust = getTreeWindGust({
  position: [-18, 3.8], // metres from the layer's first tree
  time: windGustTime,
  direction: 15, // as windDirection
  strength: 0.72, // as windStrength, or a tree's own TreeSpec.wind
  phase: 0 // 0 for a point in the open
});
```

The experimental `_treeWindGust` shader module gives a layer's own shaders the same gust as
`float treeWind_getGust(vec2 metres, float time, vec2 direction, float force, float phase)`. Its
`direction` is the unit vector the wind blows toward, `[sin(bearing), cos(bearing)]`.

`position` is in metres from the layer's gust origin, which is the position of its first tree,
along x and y. The GPU computes in 32-bit floats, so the two agree to about `1e-4` with clocks of
a few hundred seconds.

### Upgrading

The storm look changed. A `windStrength` of `0.06` or more now gives deeper lulls, a front that
bows a crown about twice as far as a lull does, crowns that comb further, and pale leaves that
follow the fronts instead of flickering all the time. Below `0.06` trees sway as they did.

At any strength, shed leaves now start from where the wind had their twigs, except a far tree's
leaves about 3 px long or less, which start where they rest. They are drawn at their own size:
never as a far tree's larger stand-in leaves, and never capped at a size on screen. One too small to see is shown for less of the time rather than drawn larger, and they
fade out within about 1.6 m of the camera. Near the camera they are drawn in a pass of their own
after the rest of the layer, which blends and writes depth for as much of each pixel as a leaf
covers, so a layer drawn later that tests depth is behind a leaf in the air about as much as the
leaf covers it.

A tree that comes down tears out a wide, shallow plate of soil and roots, about 22 trunk radii
across and 4 deep, and leans about its rim. A toppled or leaning tree therefore stands a little
further over than it did. The face it turns up is pale grey wet sand with dark fibrous roots
through it, over the dark mat they bind under the old ground, which shows round the rim and where
the sand has fallen away. Its roots keep to the tree's own trunk, whatever the proportions of its
crown: lateral ones end just past the rim, and short broken ones stand kinked out of the rim all
round it. Only the finest level of detail draws those, so a far tree draws no more wood than it
did. A camera inside a tree's bound, as under its skirt, now always draws that tree at full
detail, with the finer blades for its nearest leaves. In a storm a long limb streams rather than curling round
over its fork, and shoots that point into the wind from just below the fork bend less, where
before two of them could bend apart and stretch the wood between them into a long straight line.

The storm's and the rain's terms wait behind the layer's own wind and `wetness`, so a frame with
no `windDirection`, a `windStrength` under `0.06` and no `wetness` does next to none of their work.

Leaves large on screen, from about 32 px long, are darker and greener than the coarser blades have
them, as a coarser blade stands for the sheen of many leaves, with a sharper waxy highlight in a
broader bloom, which a low sun from the side catches. Their midrib no longer breaks into dashes.

Blossoms (`kind: 'flower'`) are borne on the skin of the crown as it is, at the tips of the shoots,
in clusters of five at their own depths in the outer leaves, and their petals are a brighter white.
Within about 2 m of the camera, among the leaves it looks through, they hang on their own twigs.
A tree blooms from a `growth` of `0.15`, whether or not the twigs its blossoms would hang from have
grown, so a young tree in bloom shows as many as an old one.

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
