# WindEffect

<p class="badges">
  <img src="https://img.shields.io/badge/From-v9.4-blue.svg?style=flat-square" alt="From v9.4" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="Experimental" />
</p>

A deck.gl effect that sets one wind for the whole scene. Every
[`TreeLayer`](./tree-layer.md) and [`SplatLayer`](./splat-layer.md) in the deck bends with it, in
the same direction and on the same clock, as `LightingEffect` lights every lit layer.
[`WindExtension`](#windextension) brings deck.gl's own instanced 3D layers into the same wind.
See it in the [Wind Garden](/examples/layers/wind-garden) example.

```ts
import {Deck} from '@deck.gl/core';
import {TreeLayer, WindEffect} from '@deck.gl-community/layers';

new Deck({
  effects: [new WindEffect({strength: 0.03, direction: 90, gust: 0.4})],
  layers: [new TreeLayer({id: 'orchard', data: trees}), new TreeLayer({id: 'hedge', data: hedge})]
});
```

To change the wind, pass a new instance. deck.gl keeps the registered effect and gives it the new
props, as it does for `LightingEffect`.

## Properties

| Property | Default | Description |
| --- | --- | --- |
| `strength` | `0.025` | Bend as a fraction of object height. `0.025` is a gentle breeze; `0` is still air. |
| `direction` | `≈65.8` | Compass bearing the wind blows toward, in degrees clockwise from north. The default is the fixed direction TreeLayer and SplatLayer used before this effect. |
| `gust` | `0` | `0`–`1`. Slow swell: strength varies between `strength × (1 − gust)` and `strength × (1 + gust)`. |
| `turbulence` | `1` | Scale of the crown flutter. `0` leaves a pure bend. |
| `time` | `null` | Wind clock in seconds. `null` follows deck.gl's animation timeline; a number freezes the pose. |

## Layer overrides

Layer props override the effect for that layer only:

| Layer | Strength | Clock |
| --- | --- | --- |
| `TreeLayer` | `windStrength`; a tree's own `wind` overrides it in turn | `windTime` |
| `SplatLayer` | `deformationStrength`; `getDeformation` flex multiplies it | `deformationTime` |

`null`, the default, follows the effect. `0` keeps a layer still in a windy scene. Direction, gusts
and turbulence always come from the effect. Without a `WindEffect`, the layer props work on their
own, with the default direction.

## Rendering

Wind bends the geometry in the vertex shader on WebGL2 and WebGPU. Shadows, picking and the sorted
splat transparency use the same bend. While the strength is above zero and the clock follows the
timeline, deck.gl redraws every frame. With no wind, or a fixed `time`, it idles.

Other layers can read the wind through the exported `wind` shader module, whose props the effect
supplies through `getShaderModuleProps`.

## WindExtension

A layer extension that bends deck.gl's instanced 3D layers with the scene's `WindEffect`, using
the same bend as TreeLayer.

```ts
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {WindExtension} from '@deck.gl-community/layers';

new SimpleMeshLayer({
  data: reeds,
  mesh,
  getPosition: d => d.position,
  extensions: [new WindExtension()],
  getWind: d => [d.height, d.phase, 3]
});
```

| Layer | `windBase` |
| --- | --- |
| `SimpleMeshLayer`, `ScenegraphLayer` | `'instance'`: height above each object's anchor |
| `ColumnLayer`, `GridCellLayer` | `'instance'` |
| `PointCloudLayer` | `'ground'`: each point's height above z = 0 |

| Property | Default | Description |
| --- | --- | --- |
| `getWind` | `[10, index × golden angle, 1]` | Per-object `[height, phase, flex]`: the bend reaches full strength at `height` metres above the base, `phase` (radians) offsets its sway, `flex` multiplies its strength. |
| `windBase` | `'instance'` | `'instance'` bends from each object's anchor; `'ground'` from z = 0, for point clouds. |
| `windStrength` | `null` | Overrides the effect's strength for this layer. |
| `windTime` | `null` | Overrides the effect's clock for this layer. |

The extension is WebGL2 only: deck.gl's WGSL layers have no vertex filter hook, so on WebGPU it
leaves the layer unchanged. Column heights often encode data; bending them suits decorative
extrusions, not charts. Lighting on `ColumnLayer` uses the unbent normal.
