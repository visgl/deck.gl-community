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
  effects: [new WindEffect({speed: 6, direction: 90, gust: 0.4})],
  layers: [new TreeLayer({id: 'orchard', data: trees}), new TreeLayer({id: 'hedge', data: hedge})]
});
```

To change the wind, pass a new instance. deck.gl keeps the registered effect and gives it the new
props, as it does for `LightingEffect`.

## Properties

| Property | Default | Description |
| --- | --- | --- |
| `speed` | `null` | Wind speed in m/s at the 10 m reference height. Without `strength`, it sets the bend through [`getWindStrength`](#getwindstrength). |
| `strength` | `null` | Bend as a fraction of object height. Wins over `speed`. With neither, the bend is `0.025`, a gentle breeze; `0` is still air. |
| `direction` | `≈65.8` | Compass bearing the wind blows toward, in degrees clockwise from north. The default is the fixed direction TreeLayer and SplatLayer used before this effect. |
| `gust` | `0` | `0`–`1`. Slow swell: strength (and speed) varies between `× (1 − gust)` and `× (1 + gust)`. |
| `turbulence` | `1` | Scale of the crown flutter. `0` leaves a pure bend. |
| `shear` | `1/7` | Exponent of the height profile `v(z) = v₁₀ (z / 10)^shear`, used by [`getWindVelocity`](#getwindvelocity). About `0.25` over a city or an orchard. |
| `time` | `null` | Wind clock in seconds. `null` follows deck.gl's animation timeline; a number freezes the pose; a function `() => number` is an app-owned clock. |

`effect.strength` is the resolved bend: `strength`, else the response to `speed`, else `0.025`.

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

A `time` callback hands frame scheduling to the app, as in a weather scene that animates with
`_animate` and pauses when hidden: wind layers read the callback on every draw but request no
redraws of their own.

```ts
let time = 0;
const wind = new WindEffect({speed: 6, direction: 120, time: () => time});
// The app advances `time` and redraws; trees, rain and clouds share the clock.
```

Other layers can read the wind through the exported `wind` shader module, whose props the effect
supplies through `getShaderModuleProps`.

## Physical wind

The helpers below are pure functions with no deck.gl dependency. They take a plain
`{speed, direction, gust, shear}` object, so `wind.props` works as is.

### getWindStrength

`getWindStrength(speed: number): number`

The vegetation response curve: `0.025 × (speed / 5)^1.4`, capped at `0.2`. 5 m/s gives `0.025`,
6 m/s `0.032`, a 15 m/s gale `0.12`; the cap is reached near 22 m/s. The exponent below 2 reflects
flexible crowns streamlining as the wind grows.

### getWindVelocity

`getWindVelocity(wind, height: number, time?: number): [east, north]`

Air velocity in m/s at `height` metres, on the power-law profile `v(z) = v₁₀ (z / 10)^shear`, with
the same gust swell that bends the trees. Use it for particles and clouds that move with the wind.
Without `speed`, the air is still.

### getWindDisplacement

`getWindDisplacement(wind, height: number, time?: number): [east, north]`

The distance in metres the air has travelled since time 0: the exact integral of
`getWindVelocity`, gusts included. An offset built on it, for example for rain, stays continuous
through gusts, where `velocity × time` would jump.

```ts
import {getWindDisplacement, getWindVelocity} from '@deck.gl-community/layers';

const clouds = getWindVelocity(wind.props, 1500, time); // m/s
const rainOffset = getWindDisplacement(wind.props, 225, time); // metres
```

### getLocalWindStrengths

`getLocalWindStrengths(data, sampler, {getPosition?, time?}): (number | undefined)[]`

Per-tree bend strengths from local wind, for `TreeSpec.wind`. The `sampler`,
`(position, time) => {speed, direction?} | null`, reports the wind at each tree: a station field, a
forecast grid or a shelter model. Each strength is `getWindStrength` of the sampled speed. Where
the sampler returns `null` the strength is `undefined`, so that tree follows the scene's wind.

A pinned tree still takes its direction, gusts and clock from the `WindEffect`, so set the effect's
direction from the wind at the scene's centre. Per-tree directions do not reach the bend yet.

```ts
import {sampleWindField, type WindField} from '@deck.gl-community/geo-layers';
import {getLocalWindStrengths, TreeLayer, WindEffect} from '@deck.gl-community/layers';

// WindSample.direction is the direction of travel, counterclockwise radians from east.
const toBearing = (radians: number) => (((90 - (radians * 180) / Math.PI) % 360) + 360) % 360;
const sampleStations = (field: WindField) => (position: readonly number[], time: number) => {
  const sample = sampleWindField(field, [position[0], position[1]], time);
  return sample && {speed: sample.speed, direction: toBearing(sample.direction)};
};

// Trees positioned in longitude/latitude, like the field's stations.
const sampler = sampleStations(field);
const strengths = getLocalWindStrengths(trees, sampler);
const center = sampler(orchardCenter, 0)!;
new Deck({
  effects: [new WindEffect({speed: center.speed, direction: center.direction})],
  layers: [new TreeLayer({data: trees.map((tree, i) => ({...tree, wind: strengths[i]}))})]
});
```

`@deck.gl-community/geo-layers` draws `WindSample.direction` as the way the air moves: its arrows
point and its particles travel along `(cos, sin)` of it. That is `WindEffect`'s convention too,
apart from the angle units. Station data that reports where the wind comes *from* needs another
180°.

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
