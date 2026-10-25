# WindEffect: one wind for every 3D layer

Status: proposal with a prototype in `modules/layers/src/wind-effect/` and the Wind Garden example. The branch stacks on
[#986](https://github.com/visgl/deck.gl-community/pull/986), which owns the Seasonal Farm settings
panel and the legacy-free SplatLayer.

## Today

Wind is configured per layer, and two layers spell it differently:

| | TreeLayer | SplatLayer |
| --- | --- | --- |
| Strength | `windStrength` (default `0`) | `deformationStrength` (default `0`) |
| Clock | `windTime` (`null` follows the deck timeline) | `deformationTime` |
| Per object | `TreeSpec.wind`: `true`, `false` or a strength | `getDeformation`: `[height, phase, flex]` |

Both layers apply the same analytic bend in GLSL and WGSL (`splat-deformation.ts`): a clamped
cantilever `u²(3−u)/2` along a fixed axis `(1, 0.45)`, plus a crown mode
`mat2(0.65, −0.25, 0.3, 0.8)` at twice the frequency. The Jacobian transforms Gaussian covariance
and mesh normals. Each layer writes the uniforms in `draw()` and calls `setNeedsRedraw()` while
strength is positive and the clock follows the timeline. A scene with three tree layers and a
splat scan therefore needs four props kept in sync, and nobody can turn the wind around.

## API

```ts
import {WindEffect} from '@deck.gl-community/layers';

new Deck({
  effects: [new WindEffect({strength: 0.03, direction: 90, gust: 0.4})],
  layers: [new TreeLayer({data})] // no wind props: the trees follow the effect
});
```

| Prop | Default | Meaning |
| --- | --- | --- |
| `speed` | `null` | m/s at 10 m. Without `strength`, the bend is `getWindStrength(speed)`, `0.025 × (speed / 5)^1.4` capped at 0.2 ([weather](./wind-effect-weather.md)). |
| `strength` | `null` | Bend as a fraction of object height for flex 1 (the units of the former `windStrength`). Wins over `speed`; `0.025` when neither is set. `0` is still air. |
| `direction` | `≈65.8` | Compass bearing the wind blows *toward*, degrees clockwise from north, like `DirectionalLight.direction`. The default reproduces today's fixed `(1, 0.45)` axis. |
| `gust` | `0` | Slow strength swell: strength varies within `strength × (1 ± gust)`. |
| `turbulence` | `1` | Scale of the crown flutter mode. `0` leaves a pure bend. |
| `shear` | `1/7` | Power-law profile exponent for `getWindVelocity` and `getWindDisplacement`. |
| `time` | `null` | Seconds. `null` follows the deck timeline, so `timeline.setTime()` and `pause()` apply. A `() => number` callback is an app-owned clock: layers then request no redraws. |

Like `LightingEffect`, the effect is replaced by passing a new instance with the same `id`. deck.gl
then calls `setProps` on the existing one. One `WindEffect` per deck: it is the scene's wind field.

The bend direction is a world-frame vector (east/north metre offsets, or Cartesian x/y), applied
after each owner's yaw, so rotating `direction` turns the whole sway pattern with it. The crown
mode is rotated with it (`R·M·Rᵀ`), so a scene rotated together with its wind looks the same.

## How it reaches shaders

A `wind` shader module (GLSL uniform block and WGSL struct) carries four values:

| Uniform | Type | Derived on the CPU from |
| --- | --- | --- |
| `wave` | `vec4` | `sin/cos(1.6t)`, `sin/cos(3.2t)`, as today |
| `mode` | `vec4` (mat2 columns) | `turbulence · R · M · Rᵀ` |
| `branch` | `vec4` | `turbulence · sin/cos(4.4t)`, `turbulence · sin/cos(7.1t)` |
| `flutter` | `vec4` | `turbulence · sin/cos(14.3t)`, `turbulence · sin/cos(21.7t)` |
| `axis` | `vec2` | `R(direction) · (1, 0.45)` |
| `strength` | `f32` | `strength · gust(t)` |

`getUniforms` does the trigonometry once per draw: the shared `splatDeform()` takes `axis` and
`mode` as arguments instead of constants.

### Motion

The first prototype swung every object symmetrically through upright on one sine,
`strength · sin(1.6t + φ)`, and the crown mode was a small 0.35× shear. Trees do not do that. Their
mean drag holds a downwind lean, and the trunk sways a little around it near its natural
frequency. Branches sway faster, rooted at the trunk, and carry their leaves; leaves add a fast,
small shimmer. This is the usual split of vegetation animation into a main bend, a branch bend
and leaf flutter (as in Crytek's procedural vegetation in *GPU Gems 3*, chapter 16).

A second iteration gave each leaf Gaussian its own large flutter. Leaves then drifted off wood
that did not flutter. Branch sway now lives in `splatDeform`, which wood, fruit and leaves all
use, so a leaf moves with the branch it sits on.

| Part | Displacement | Where |
| --- | --- | --- |
| Trunk | `axis · strength · H · f(u) · (1 + 0.25 (0.75 w₁ + 0.25 w₂))` | Everything: wood, crops, splats, `WindExtension` |
| Crown | `0.35 · strength · w₂ · g(u) · mode · xy` | Everything |
| Branches | `0.5 · strength · H · tier(u) · reach(r) · (axis b₁ + 0.4 axis⊥ b₂)` | Everything |
| Leaves | `0.08 · strength · H · tier(u) · shelter(r) · (axis l₁ + 0.4 axis⊥ l₂, 0.6 l₂)` | `SplatLayer` Gaussians only |

- `w₁ = sin(1.6t + φ)` and `w₂` (the crown wave) use the owner's phase. The trunk factor stays in
  [0.75, 1.25].
- Branch reach is `q² / (1 + q²/4)` with `q = r / 0.3H`: zero on the trunk axis, rising toward
  the tips and saturating for wide crowns. `tier` rises smoothly from 10% to 40% of the height.
- The branch phase is `θ = α + 5z/H + φ`, where `α` is the azimuth around the trunk. It does not
  depend on the distance out, so each branch sways as one. Branches around the crown and up its
  tiers move out of step. `b₁ = sin(4.4t + θ)` and `b₂ = sin(7.1t + 2θ)`.
- The sway is horizontal, so the Jacobian keeps its unit z row and `splatDeformNormal` is
  unchanged. The analytic gradient never divides by `r`, because `reach / r² = 1 / (span² (1 + q²/4))`;
  a unit test checks it against numeric derivatives.
- Leaves shimmer at 14.3 and 21.7 rad/s with a phase from an integer hash of the Gaussian's
  template centre, offset by the owner phase. Each Gaussian moves rigidly. The hash runs on a 1/64 m
  grid with `uint` arithmetic, which float32 represents exactly, so the CPU depth sort
  (`getSplatWindOffset`) reproduces the shaders. A headless test checks a Gaussian against it to
  within a pixel.

At 6 m/s on a 12 m tree the trunk top leans 0.34 to 0.52 m, branch tips sway up to 0.21 m on top
of that, and leaves shimmer up to 4 cm.

The effect supplies the module props the way `LightingEffect` supplies `lighting`:

- `getShaderModuleProps(layer)` returns `{wind: {...}}`, with `time` resolved from that layer's
  timeline. Layers without the module ignore it; deck.gl builds every model with
  `disableWarnings`.
- `useInPicking = true`, so pick passes bend geometry exactly like the draw pass.

TreeLayer and SplatLayer also *pull* the effect in `draw()`, for two reasons:

1. deck.gl's `ShadowPass` (run from `LightingEffect.preRender`) passes no effects. A pushed
   module would reach the shadow map one frame late, and not at all on the first frame.
   SplatEffect's private accumulation passes do forward effects.
2. A layer can override strength or clock (below), which a deck-wide push cannot express.

So the layers resolve `layer override ?? WindEffect ?? still air` in `draw()` and write the
`wind` module themselves. They find the effect through a per-deck registry that the effect fills
in `setup()` and clears in `cleanup()`, the same pattern as `SplatEffect.get(deck)`.

### CPU bounds

Culling and the splat level of detail use bounds padded by the largest wind excursion
(`getSplatDeformationRadius`, TreeWoodLayer's owner radius). Those now use the peak,
`strength × (1 + gust)`, with the crown term scaled by `turbulence`. Direction and time do not
change the bounds.

Layers cache the bound, so they must learn when the effect changes. deck.gl does not update layers
when only `effects` change. Layers that read the effect record its bound key (`strength`, `gust`,
`turbulence`) in `state.windKey`. In `preRender` the effect calls `setNeedsUpdate()` on every
layer whose key differs; `cleanup()` does the same for layers that used it. The cost is that of
changing a layer's bounds-affecting prop, one frame later.

## TreeLayer and SplatLayer props: one deck-wide wind

The first prototype kept the layer props as overrides (`windStrength`, `windTime`,
`deformationStrength`, `deformationTime`, and a per-tree `TreeSpec.wind`). They are removed: wind
is a property of the scene, like light, so the effect is its only source. Each layer keeps one
opt-out, `windEnabled` (default `true`), in the same spirit as deck.gl's `shadowEnabled`:

| | TreeLayer | SplatLayer |
| --- | --- | --- |
| Scene | `WindEffect` `speed` or `strength`, `direction`, `gust`, `turbulence`, `time` | Same |
| Per layer | `windEnabled: false` keeps it still | Same |
| Per object | None: every tree bends alike | `getDeformation` `[height, phase, flex]`: the object's bend height and stiffness, not its wind |

- Tests and screenshots set the effect's `time` instead of a layer clock.
- Without an effect, layers are still, which is what existing apps that passed no wind props
  saw before.
- Wind that varies across the scene (station fields, shelter behind windbreaks) belongs in the
  effect as a field the layers sample, not in per-tree strengths. Until then, a station field
  sets the effect's one speed and direction, as the Wind Garden's Stations mode does.

## A `WindExtension` for other layers

Worth it, and prototyped. `WindExtension` bends deck.gl's instanced 3D layers with the same
cantilever, so a scene of trees, reeds and point-cloud scans sways as one:

| Layer | Bend base | Notes |
| --- | --- | --- |
| `SimpleMeshLayer`, `ScenegraphLayer` | instance anchor | Mesh z above the anchor is the height. |
| `ColumnLayer`, `GridCellLayer` | instance anchor | Elevation is the height. |
| `PointCloudLayer` | `windBase: 'ground'` | Each point is its own anchor, so height is its z. |

How it works:

- **One hook for every layer.** `DECKGL_FILTER_SIZE` is not consistent across layers: ColumnLayer
  passes only the xy offset there and keeps elevation in a local variable. Every instanced layer
  does call `DECKGL_FILTER_GL_POSITION` with `geometry.position`, the vertex in common space. The
  extension reconstructs the vertex offset from the anchor (`instancePositions`, copied into a
  global at `#main-start` because the hook is emitted before the layer declares its attributes),
  converts it to metres, applies `splatDeform` and adds the offset to both `geometry.position` and
  the clip position. The injection runs at order −100, before deck.gl's shadow module projects
  `geometry.position` into the light, so shadow maps, picking and drawing share one pose.
- **Per-object attribute.** `getWind` returns `[height, phase, flex]`, packed as
  `[height, flex, sin, cos]` in one vec4, the slot budget SimpleMeshLayer can still spare. The
  crown mode uses twice the phase, derived in the shader. The default spreads phases by the golden
  angle per index, so a field of reeds does not sway in step.
- **Same effect plumbing.** The extension's `draw` hook resolves `getLayerWind`, like TreeLayer,
  so shadows stay current. It has no strength or clock of its own; remove the extension to keep a
  layer still.

Limits of the prototype:

- The hook's `geometry` is a copy. Layers that light from `geometry.position` and
  `geometry.normal` after the hook (ColumnLayer) keep the unbent normal and lighting position;
  the error is of the order of the bend angle, a few degrees in a breeze.
- `ColumnLayer`, `GridCellLayer` and `H3HexagonLayer` heights often encode a data value, and
  bending a bar chart misreports it. The extension works on them; the docs recommend it for
  decorative extrusions only.
- Non-instanced layers (extruded `PolygonLayer`) have no anchor and are not supported.

## WebGPU

The `wind` module ships a WGSL struct beside the GLSL block (`vec4, vec4, vec2, f32`, 48 bytes,
no padding surprises), and `SPLAT_DEFORMATION_WGSL` takes the same two extra arguments. TreeLayer
and SplatLayer already patch their WGSL, so both backends get the effect in this change. The CPU
depth sort in `SplatSortedRenderer` reads the same `wind` uniforms, so sorted transparency matches
the GPU bend on both.

`WindExtension` is WebGL2 only. deck.gl 9.4's WGSL layers have no vertex filter hooks, so on
WebGPU the extension leaves the layer unchanged. Supporting it needs per-layer WGSL patches (as
TreeMeshLayer does) or an upstream hook.

## Redraw cost when there is no wind

| Scene | Per frame |
| --- | --- |
| No WindEffect, layer strength `null` or `0` | Nothing. No redraw requests; the shader skips the bend on `strength == 0`. Same as today. |
| `WindEffect` with `strength: 0` | Same. `getShaderModuleProps` returns a small object per layer per pass, as `LightingEffect` does. |
| `WindEffect` with a fixed `time` | One draw per change, then idle: a static, posed scene. |
| `WindEffect` animated | Wind-consuming layers call `setNeedsRedraw()` after drawing, so deck redraws every frame only while such a layer is drawn. A wind effect over a scene of map tiles alone stays idle. |

The effect does not request redraws itself: deck.gl gives effects no redraw hook, and asking for a
frame from `preRender` would keep an empty scene animating. A paused timeline still redraws, as
today; set `time` to freeze.

## Prototype scope

In this branch:

- `WindEffect`, the `wind` shader module and the per-deck registry, exported from
  `@deck.gl-community/layers`;
- TreeLayer (wood, crops and canopy) and SplatLayer on WebGL2 and WebGPU, including shadows,
  picking and the sorted CPU depth;
- TreeLayer and SplatLayer drop their wind props for the effect and a `windEnabled` opt-out;
- the Seasonal Farm Wind, Wind direction and Gusts controls drive the effect;
- `WindExtension` for SimpleMeshLayer, ScenegraphLayer, ColumnLayer, GridCellLayer and
  PointCloudLayer (WebGL2);
- the Wind Garden example (`examples/layers/wind-garden`): one effect over a TreeLayer grove,
  reeds, columns, grid cells and a scanned shrub, with strength, direction, gust, turbulence,
  freeze, per-layer and shadow controls.

Follow-ups:

- spatial gusts: a gust front travelling along `direction`, phased by owner position, so a wave
  crosses a field instead of every tree swelling at once;
- WGSL support for `WindExtension`, and bent normals for layers that light after the hook;
- propose the effect, module and extension to deck.gl core once the API has settled;
- share one wind with luma.gl's weather modules (rain, fog, clouds): see
  [wind-effect-weather.md](./wind-effect-weather.md).
