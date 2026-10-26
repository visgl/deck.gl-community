# WindEffect

<p class="badges">
  <img src="https://img.shields.io/badge/From-v9.4-blue.svg?style=flat-square" alt="From v9.4" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="Experimental" />
</p>

A deck.gl effect that sets one wind for the whole scene. Every
[`TreeLayer`](./tree-layer.md) in the deck bends with it, wood, crops and Gaussian canopy alike, in
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
| `direction` | `≈65.8` | Compass bearing the wind blows toward, in degrees clockwise from north. The default is the fixed direction TreeLayer used before this effect. |
| `gust` | `0` | `0`–`1`. Slow swell: strength (and speed) varies between `× (1 − gust)` and `× (1 + gust)`. |
| `turbulence` | `1` | Scale of the crown, branch and leaf motion. `0` leaves a pure bend. |
| `shear` | `1/7` | Exponent of the height profile `v(z) = v₁₀ (z / 10)^shear`, used by [`getWindVelocity`](#getwindvelocity). About `0.25` over a city or an orchard. |
| `time` | `null` | Wind clock in seconds. `null` follows deck.gl's animation timeline; a number freezes the pose; a function `() => number` is an app-owned clock. |

`effect.strength` is the resolved bend: `strength`, else the response to `speed`, else `0.025`.

## One wind per deck

Wind is deck-wide: layers have no strength or clock of their own. Every part of every tree bends
with the effect, and layers are still without one. To keep one layer still in a windy scene, such
as a sheltered courtyard, set `windEnabled: false` on it, as `shadowEnabled: false` opts a layer
out of shadows.

| Layer | Opt out | Per object |
| --- | --- | --- |
| `TreeLayer` | `windEnabled: false` | None: every tree bends alike. |
| `WindExtension` layers | Remove the extension. | `getWind` `[height, phase, flex]`: bend height, phase and flex; flex `0` is rigid. |

`SplatLayer` knows nothing of wind: it draws Gaussians where they are. TreeLayer's canopy bends its
own Gaussians.

For repeatable screenshots and tests, give the effect a fixed `time`.

## Rendering

Wind bends the geometry in the vertex shader on WebGL2 and WebGPU, in three parts:

- **Trunk.** Each object leans downwind by `strength` (the mean drag) and sways around that lean,
  between 0.75 and 1.25 of it, on two harmonics with its own phase. It never swings upwind.
  Gusts swell and ease the lean.
- **Branches.** Branches sway at about 0.7 and 1.1 Hz. The motion is zero at the trunk and grows
  toward the branch tips, and each branch sways as one. Branches around the crown and up its
  tiers move out of step. Wood, fruit and leaves share this motion, so branches carry their leaves
  and fruit.
- **Leaves.** Each Gaussian of a TreeLayer canopy adds a small, fast
  shimmer of its own (2 to 3.5 Hz, a few centimetres in a breeze), up and down as well as
  sideways.

At 6 m/s on a 12 m tree, the top of the trunk leans 0.34 to 0.52 m downwind, branch tips sway up
to 0.21 m on top of that, and leaves shimmer up to 4 cm off their branch.

Shadows and picking use the same motion. A canopy drawn with sorted transparency stays still:
the sorted renderer packs only SplatLayer's own attributes. While the strength is above zero and
the clock follows the timeline, deck.gl redraws every frame. With no wind, or a fixed `time`, it
idles.

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

### Wind from station data

The effect can take its speed and direction from measurements. Sample a geo-layers `WindField` at
the scene's centre and pass the result to the effect:

```ts
import {sampleWindField} from '@deck.gl-community/geo-layers';
import {TreeLayer, WindEffect} from '@deck.gl-community/layers';

// WindSample.direction is the direction of travel, counterclockwise radians from east.
const toBearing = (radians: number) => (((90 - (radians * 180) / Math.PI) % 360) + 360) % 360;
const sample = sampleWindField(field, orchardCenter, forecastFrame)!;
new Deck({
  effects: [new WindEffect({speed: sample.speed, direction: toBearing(sample.direction)})],
  layers: [new TreeLayer({data: trees})]
});
```

`@deck.gl-community/geo-layers` draws `WindSample.direction` as the way the air moves: its arrows
point and its particles travel along `(cos, sin)` of it. That is `WindEffect`'s convention too,
apart from the angle units. Station data that reports where the wind comes *from* needs another
180°.

## WindExtension

A layer extension that bends deck.gl's instanced 3D layers with the scene's `WindEffect`, using
the same bend as TreeLayer. Those layers have no wind code of their own; TreeLayer bends natively
and needs no extension.

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

The extension is WebGL2 only: deck.gl's WGSL layers have no vertex filter hook, so on WebGPU it
leaves the layer unchanged. Column heights often encode data; bending them suits decorative
extrusions, not charts. Lighting on `ColumnLayer` uses the unbent normal.
