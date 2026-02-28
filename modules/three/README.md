# @deck.gl-community/three

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/three.svg)](https://www.npmjs.com/package/@deck.gl-community/three)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/three.svg)](https://www.npmjs.com/package/@deck.gl-community/three)

A collection of deck.gl layers powered by [Three.js](https://threejs.org/), giving access to Three.js geometry primitives and scene graph tooling directly inside deck.gl visualisations.

`TreeLayer` is the first layer in this module — a fully parametric 3D tree renderer backed by Three.js `BufferGeometry` and rendered via deck.gl's `SimpleMeshLayer`.

## Layers

| Layer | Description |
|-------|-------------|
| [`TreeLayer`](#treelayer) | Procedural 3D trees with 5 species silhouettes, season colours, and crop/fruit visualisation |

---

## TreeLayer

Renders richly configurable 3D trees at geographic positions using procedural geometry generated with Three.js `BufferGeometry` primitives.

### Features

- **5 tree species / silhouettes**: pine (tiered cones), oak (sphere), palm (flat crown), birch (narrow oval), cherry (round sphere)
- **Organic canopy geometry**: smooth low-frequency vertex jitter baked into each species mesh at init time — no runtime cost, no mesh gaps
- **Per-tree variety**: position-derived random bearing and asymmetric XY scale give every instance a unique silhouette with zero extra draw calls
- **Parametric geometry**: per-instance height, trunk-to-canopy ratio, trunk radius, canopy radius
- **Season-driven colours**: spring / summer / autumn / winter palettes with species-specific defaults
- **Explicit colour overrides**: `getTrunkColor` and `getCanopyColor` accessors for full control
- **Pine tier density**: `getBranchLevels` (1–5) controls the number of overlapping cone tiers; each tier drifts progressively for a windswept look
- **Crop / fruit / flower visualisation**: `getCrop` places coloured spheres in the outer canopy volume and scattered on the ground beneath the tree
- **Global scale factor**: `sizeScale` multiplier for easy zoom-level adjustment

## Install

```bash
npm install @deck.gl-community/three
# or
yarn add @deck.gl-community/three
```

> Three.js is a peer dependency pulled in automatically.

## Usage

```tsx
import {TreeLayer} from '@deck.gl-community/three';
import type {CropConfig} from '@deck.gl-community/three';

const layer = new TreeLayer({
  id: 'trees',
  data: myForestData,
  getPosition: d => d.coordinates,
  getTreeType: d => d.species,        // 'pine' | 'oak' | 'palm' | 'birch' | 'cherry'
  getHeight: d => d.heightMetres,
  getTrunkRadius: d => d.trunkRadius,
  getCanopyRadius: d => d.canopyRadius,
  getTrunkHeightFraction: d => 0.35,
  getSeason: d => 'autumn',
  getCrop: d => d.crop,               // CropConfig | null
  sizeScale: 1,
  pickable: true,
});
```

### Crop / fruit / flower example

```tsx
import type {CropConfig} from '@deck.gl-community/three';

// Orange orchard
const citrusCrop: CropConfig = {
  color: [255, 140, 0, 255],  // orange
  count: 30,                  // live fruits in canopy
  droppedCount: 10,           // fallen fruits on ground (rendered at 45% opacity)
  radius: 0.12,               // metres per fruit sphere (scaled by sizeScale)
};

// Cherry blossom (flowering stage — just use flower colour)
const blossomCrop: CropConfig = {
  color: [255, 200, 220, 200],
  count: 25,
  droppedCount: 8,
  radius: 0.07,
};
```

Crop positions are seeded deterministically from each tree's geographic coordinates, so they are stable across re-renders and sizeScale changes.

---

## TreeLayer Props

### Geometry

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `getPosition` | accessor → `[lon, lat]` | `d.position` | Tree base position |
| `getElevation` | accessor → `number` | `0` | Base elevation in metres |
| `getTreeType` | accessor → `TreeType` | `'pine'` | Silhouette variant |
| `getHeight` | accessor → `number` | `10` | Total height (metres) |
| `getTrunkHeightFraction` | accessor → `number` | `0.35` | Fraction of total height occupied by trunk (0–1) |
| `getTrunkRadius` | accessor → `number` | `0.5` | Trunk base radius (metres) |
| `getCanopyRadius` | accessor → `number` | `3` | Canopy horizontal radius (metres) |
| `getBranchLevels` | accessor → `number` | `3` | Pine tier count (1–5) |
| `sizeScale` | `number` | `1` | Global size multiplier applied to all dimensions |

### Colour

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `getTrunkColor` | accessor → `Color\|null` | `null` | Explicit trunk RGBA; `null` uses species default |
| `getCanopyColor` | accessor → `Color\|null` | `null` | Explicit canopy RGBA; `null` uses season default |
| `getSeason` | accessor → `Season` | `'summer'` | Drives default canopy colour when no explicit colour is given |

### Crops

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `getCrop` | accessor → `CropConfig\|null` | `null` | Crop configuration per tree. `null` renders no crops |

---

## Types

### `TreeType`

```ts
type TreeType = 'pine' | 'oak' | 'palm' | 'birch' | 'cherry';
```

### `Season`

```ts
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
```

### `CropConfig`

Configuration for crop/fruit/flower visualisation on a single tree.

```ts
type CropConfig = {
  /** Colour of each crop sphere [r, g, b, a]. */
  color: Color;

  /** Number of crop spheres placed in the outer canopy volume (live / in-tree). */
  count: number;

  /**
   * Number of crop spheres scattered on the ground within the canopy footprint
   * (dropped / fallen). Rendered at ~45 % opacity relative to `color`.
   * @default 0
   */
  droppedCount?: number;

  /**
   * Radius of each individual crop sphere in metres (scaled by `sizeScale`).
   * Typical values: 0.06–0.15 m for fruit, 0.05–0.10 m for nuts/blossoms.
   */
  radius: number;
};
```

#### Crop placement details

- **Live crops** are placed on the outer 90–102 % of the canopy ellipsoid surface (equatorial band only — never on the crown or base) so they appear nestled into the canopy with tips just visible.
- **Dropped crops** are scattered uniformly across the ground disk within the canopy footprint at a fixed slight elevation (0.05 m), rendered semi-transparent.
- All positions are derived deterministically from the tree's geographic coordinates via a seeded PRNG, so they are stable across re-renders and `sizeScale` changes.

---

## Default canopy colours

| Species | Spring | Summer | Autumn | Winter |
|---------|--------|--------|--------|--------|
| pine | `[34, 100, 34]` | `[0, 64, 0]` | `[0, 64, 0]` | `[0, 55, 0]` |
| oak | `[100, 180, 80]` | `[34, 120, 15]` | `[180, 85, 20]` | `[100, 80, 60]` (α 160) |
| palm | `[50, 160, 50]` | `[20, 145, 20]` | `[55, 150, 30]` | `[40, 130, 30]` |
| birch | `[150, 210, 110]` | `[80, 160, 60]` | `[230, 185, 40]` | `[180, 180, 170]` (α 90) |
| cherry | `[255, 180, 205]` | `[50, 140, 50]` | `[200, 60, 40]` | `[120, 90, 80]` (α 110) |

---

## Wild-Forest example

A full demo with 9 forest zones (pines, oaks, palms, birches, cherry blossoms, citrus orchards, almond groves) is available at `examples/three/wild-forest/`.

```bash
cd examples/three/wild-forest
yarn          # first time only
yarn start    # opens http://localhost:8080
```

The example includes a live `sizeScale` slider, a crop toggle, and a zone legend.
