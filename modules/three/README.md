# @deck.gl-community/three

Three.js-powered procedural **TreeLayer** for deck.gl.

Renders richly configurable 3D trees at geographic positions using procedural geometry generated with Three.js `BufferGeometry` primitives, rendered via deck.gl's `SimpleMeshLayer`.

## Features

- **5 tree species / silhouettes**: pine (tiered cones), oak (sphere), palm (flat crown), birch (narrow oval), cherry (round sphere)
- **Parametric geometry**: per-instance height, trunk-to-canopy ratio, trunk radius, canopy radius
- **Season-driven colours**: spring / summer / autumn / winter palettes with species-specific defaults
- **Explicit colour overrides**: `getTrunkColor` and `getCanopyColor` accessors for full control
- **Pine tier density**: `getBranchLevels` (1–5) controls the number of overlapping cone tiers
- **Global scale factor**: `sizeScale` multiplier for easy zoom-level adjustment

## Install

```bash
npm install @deck.gl-community/three three
# or
yarn add @deck.gl-community/three three
```

## Usage

```tsx
import {TreeLayer} from '@deck.gl-community/three';

const layer = new TreeLayer({
  id: 'trees',
  data: myForestData,
  getPosition: d => d.coordinates,
  getTreeType: d => d.species,       // 'pine' | 'oak' | 'palm' | 'birch' | 'cherry'
  getHeight: d => d.heightMetres,
  getTrunkRadius: d => d.trunkRadius,
  getCanopyRadius: d => d.canopyRadius,
  getTrunkHeightFraction: d => 0.35,
  getSeason: d => 'autumn',
  sizeScale: 1,
  pickable: true,
});
```

## TreeLayer Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `getPosition` | accessor → `[lon, lat]` | `d.position` | Tree base position |
| `getElevation` | accessor → `number` | `0` | Base elevation in metres |
| `getTreeType` | accessor → `TreeType` | `'pine'` | Silhouette variant |
| `getHeight` | accessor → `number` | `10` | Total height (metres) |
| `getTrunkHeightFraction` | accessor → `number` | `0.35` | Trunk fraction of total height |
| `getTrunkRadius` | accessor → `number` | `0.5` | Trunk base radius (metres) |
| `getCanopyRadius` | accessor → `number` | `3` | Canopy horizontal radius (metres) |
| `getTrunkColor` | accessor → `Color\|null` | `null` | Explicit trunk RGBA; `null` uses species default |
| `getCanopyColor` | accessor → `Color\|null` | `null` | Explicit canopy RGBA; `null` uses season default |
| `getSeason` | accessor → `Season` | `'summer'` | Drives default canopy colour |
| `getBranchLevels` | accessor → `number` | `3` | Pine tier count (1–5) |
| `sizeScale` | `number` | `1` | Global size multiplier |

## TreeType values

`'pine'` · `'oak'` · `'palm'` · `'birch'` · `'cherry'`

## Season values

`'spring'` · `'summer'` · `'autumn'` · `'winter'`
