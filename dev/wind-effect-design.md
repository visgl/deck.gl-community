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
| `strength` | `null` | Bend as a fraction of object height for flex 1 (the units of `windStrength`). Wins over `speed`; `0.025` when neither is set. `0` is still air. |
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
| `axis` | `vec2` | `R(direction) · (1, 0.45)` |
| `mode` | `vec4` (mat2 columns) | `turbulence · R · M · Rᵀ` |
| `strength` | `f32` | `strength · gust(t)` |

`getUniforms` does the trigonometry once per draw, so the per-vertex work is unchanged: the shared
`splatDeform()` takes `axis` and `mode` as arguments instead of constants.

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
changing `windStrength` today, one frame later.

## TreeLayer and SplatLayer props: overrides, not deprecation

Keep the current props, with one change: `windStrength` and `deformationStrength` default to
`null`, meaning "follow the WindEffect". Without an effect, `null` is still air, so existing apps
render the same. Precedence, most specific first:

| Source | TreeLayer | SplatLayer |
| --- | --- | --- |
| Per object | `TreeSpec.wind` (a strength; `false` is rigid) | `getDeformation` flex (a multiplier) |
| Per layer | `windStrength`, `windTime` | `deformationStrength`, `deformationTime` |
| Scene | `WindEffect` `strength`, `time` | `WindEffect` `strength`, `time` |

`direction`, `gust` and `turbulence` always come from the effect, so even a pinned tree turns and
swells with the scene. An explicit `0` makes a layer rigid under a windy scene, for example a
sheltered courtyard. `windTime` and `deformationTime` stay: tests, screenshots and side-by-side
comparisons need a fixed pose.

Why not deprecate? The overrides cost a `??` each, and removing them would force every
deterministic test to construct an effect. The per-layer strength is also the only way to give one
grove less wind. Revisit when deck.gl core has a shared `WindEffect`; the layer props would then
become thin aliases.

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
  so `windStrength` and `windTime` override the effect per layer and shadows stay current.

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
- `windStrength` and `deformationStrength` default to `null`;
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
