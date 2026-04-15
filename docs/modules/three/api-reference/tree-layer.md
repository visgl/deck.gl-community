import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# TreeLayer

<LayerLiveExample highlight="tree-layer" size="tall" />

Renders richly configurable 3D trees at geographic positions using procedural geometry generated with Three.js `BufferGeometry` primitives and rendered via deck.gl's `SimpleMeshLayer`.

```tsx
import {TreeLayer} from '@deck.gl-community/three';

new TreeLayer({
  id: 'trees',
  data: myForestData,
  getPosition: d => d.coordinates,
  getTreeType: d => d.species,
  getHeight: d => d.heightMetres,
  getSeason: () => 'autumn',
  sizeScale: 1,
  pickable: true
});
```

## Features

- **5 tree species / silhouettes**: pine (tiered cones), oak (sphere), palm (flat crown), birch (narrow oval), cherry (round sphere)
- **Organic canopy geometry**: smooth low-frequency vertex jitter baked into each species mesh at init time — no runtime cost, no mesh gaps
- **Per-tree variety**: position-derived random bearing and asymmetric XY scale give every instance a unique silhouette with zero extra draw calls
- **Parametric geometry**: per-instance height, trunk-to-canopy ratio, trunk radius, canopy radius
- **Season-driven colours**: spring / summer / autumn / winter palettes with species-specific defaults
- **Explicit colour overrides**: `getTrunkColor` and `getCanopyColor` accessors for full control
- **Pine tier density**: `getBranchLevels` (1–5) controls the number of overlapping cone tiers; each tier drifts progressively for a windswept look
- **Crop / fruit / flower visualisation**: `getCrop` places coloured spheres in the outer canopy volume and scattered on the ground beneath the tree
- **Global scale factor**: `sizeScale` multiplier for easy zoom-level adjustment

## Properties

Inherits from all [Base Layer](https://deck.gl/docs/api-reference/core/layer) properties.

### Geometry

#### `getPosition` (Accessor&lt;Position&gt;, optional)

Tree base position as `[longitude, latitude]`. Default: `d => d.position`.

#### `getElevation` (Accessor&lt;number&gt;, optional)

Base elevation in metres above sea level. Default: `0`.

#### `getTreeType` (Accessor&lt;TreeType&gt;, optional)

Silhouette variant: `'pine'` | `'oak'` | `'palm'` | `'birch'` | `'cherry'`. Default: `'pine'`.

#### `getHeight` (Accessor&lt;number&gt;, optional)

Total tree height in metres. Default: `10`.

#### `getTrunkHeightFraction` (Accessor&lt;number&gt;, optional)

Fraction of total height occupied by the trunk (0–1). Default: `0.35`.

#### `getTrunkRadius` (Accessor&lt;number&gt;, optional)

Trunk base radius in metres. Default: `0.5`.

#### `getCanopyRadius` (Accessor&lt;number&gt;, optional)

Canopy horizontal radius in metres. Default: `3`.

#### `getBranchLevels` (Accessor&lt;number&gt;, optional)

Number of cone tiers for pine trees (1–5). Higher values produce a denser layered silhouette. Default: `3`.

#### `sizeScale` (number, optional)

Global size multiplier applied to all dimensions. Default: `1`.

### Colour

#### `getTrunkColor` (Accessor&lt;Color | null&gt;, optional)

Explicit trunk colour `[r, g, b, a]`. When `null`, the species default is used. Default: `null`.

#### `getCanopyColor` (Accessor&lt;Color | null&gt;, optional)

Explicit canopy colour `[r, g, b, a]`. When `null`, the season × species default is used. Default: `null`.

#### `getSeason` (Accessor&lt;Season&gt;, optional)

Season used to pick the default canopy colour: `'spring'` | `'summer'` | `'autumn'` | `'winter'`. Default: `'summer'`.

### Crops

#### `getCrop` (Accessor&lt;CropConfig | null&gt;, optional)

Crop configuration per tree. Return a `CropConfig` to render small spherical crop points in the outer canopy volume (live crops) and/or scattered on the ground around the trunk (dropped crops). Return `null` for no crops. Default: `null`.

## Types

### TreeType

```ts
type TreeType = 'pine' | 'oak' | 'palm' | 'birch' | 'cherry';
```

### Season

```ts
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
```

### CropConfig

```ts
type CropConfig = {
  color: Color;          // Colour of each crop sphere [r, g, b, a]
  count: number;         // Crop spheres in the outer canopy volume (live / in-tree)
  droppedCount?: number; // Crop spheres on the ground (dropped / fallen). Default: 0
  radius: number;        // Radius of each crop sphere in metres (scaled by sizeScale)
};
```

### Crop example

```tsx
import type {CropConfig} from '@deck.gl-community/three';

// Orange orchard
const citrusCrop: CropConfig = {
  color: [255, 140, 0, 255],
  count: 30,
  droppedCount: 10,
  radius: 0.12
};
```

Crop positions are seeded deterministically from each tree's geographic coordinates, so they are stable across re-renders and `sizeScale` changes.

## Default canopy colours

| Species | Spring | Summer | Autumn | Winter |
|---------|--------|--------|--------|--------|
| pine | `[34, 100, 34]` | `[0, 64, 0]` | `[0, 64, 0]` | `[0, 55, 0]` |
| oak | `[100, 180, 80]` | `[34, 120, 15]` | `[180, 85, 20]` | `[100, 80, 60]` (alpha 160) |
| palm | `[50, 160, 50]` | `[20, 145, 20]` | `[55, 150, 30]` | `[40, 130, 30]` |
| birch | `[150, 210, 110]` | `[80, 160, 60]` | `[230, 185, 40]` | `[180, 180, 170]` (alpha 90) |
| cherry | `[255, 180, 205]` | `[50, 140, 50]` | `[200, 60, 40]` | `[120, 90, 80]` (alpha 110) |

## Source

[modules/three/src/tree-layer](https://github.com/visgl/deck.gl-community/tree/master/modules/three/src/tree-layer)
