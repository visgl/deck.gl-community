# CORTAOEffect

![Experimental](https://img.shields.io/badge/status-experimental-orange.svg?style=flat-square)
![WebGPU supported](https://img.shields.io/badge/webgpu-yes-success.svg?style=flat-square)

`CORTAOEffect` adds screen-space ambient occlusion to a deck.gl scene. It uses CORTAO (Circular
Occluder Ray-Traced Ambient Occlusion) by Daniel Isheden. CORTAO models each depth sample as a
circular occluder. It looks up which rays the occluder blocks in a precomputed table, and it
counts the blocked rays.

This port follows the [CORTAO reference implementation](https://github.com/theagentd/CORTAO). The
defaults follow the [Carbon Engine version](https://github.com/carbonengine/CORTAO). Both projects
use the MIT License. See `THIRD-PARTY-NOTICES.md` in the module.

## Usage

```ts
import {Deck} from '@deck.gl/core';
import {CORTAOEffect} from '@deck.gl-community/experimental';

const ambientOcclusion = new CORTAOEffect({maxScreenSpaceRadius: 0.2, sampleCount: 16});

new Deck({
  initialViewState: {longitude: -122.42, latitude: 37.77, zoom: 13, pitch: 60},
  controller: true,
  effects: [ambientOcclusion],
  layers: [/* extruded layers */]
});
```

To turn the effect off, remove it from `effects`.

## How it works

The deck.gl post-process buffers have only a color attachment. So the effect draws the layers a
second time, into its own color and depth textures. Then it runs these passes:

1. Prepass. It converts the depth to linear depth in meters. It reconstructs a view-space normal
   from the depth of the neighbor pixels, because deck.gl has no normal buffer. It packs the depth
   and a 10-bit normal into one 32-bit texel.
2. Mip pass. It writes up to 8 levels of the packed data. Each texel of a level is a copy of one
   texel of the level below. On WebGPU, the levels are real mip levels, one compute dispatch per
   level. WebGL 2 cannot read one level of a texture while it writes another level of the same
   texture, so on WebGL 2 the levels go into one atlas texture.
3. Main pass. It samples the depth on a golden-angle spiral, and it accumulates the blocked rays
   from the occluder lookup table.
4. Filter pass (optional). It applies the CORTAO bilateral filter with depth and normal weights.
   On WebGPU, one invocation filters a 2 x 2 block with `textureGather()`, as the reference
   does. WebGL 2 has no `textureGather()`, so each pixel reads its taps with `texelFetch()`.
5. Composite pass. It multiplies the captured color by the occlusion.

## Constructor

```ts
new CORTAOEffect(props?: CORTAOEffectProps);
```

## Properties

All distances are in meters.

#### `radius` (number, optional)

Maximum world-space radius of the occlusion. Default: `Infinity`. With the default, only
`maxScreenSpaceRadius` limits the radius, as in the Carbon Engine version.

#### `maxScreenSpaceRadius` (number, optional)

Maximum radius on the screen, as a fraction of the viewport height. Default: `0.2`.

#### `intensity` (number, optional)

Exponent that the effect applies to the occlusion. Default: `1`. Values above 1 make the
occlusion darker. `0` turns the occlusion off.

#### `sampleCount` (number, optional)

Number of depth samples for each pixel. Default: `16`. CORTAO recommends 4 to 32. A change
compiles the main pass again.

#### `rayCount` (8 | 16 | 32, optional)

Number of rays for each pixel. Default: `16`. A change compiles the main pass again and creates
a new lookup table.

#### `mipBias` (number, optional)

Bias of the mip level for the depth samples. Default: `-4`.

#### `maxSlopeCompensation` (number, optional)

Maximum enlargement of an occluder that the camera sees at a grazing angle. Default: `4`.

#### `backfaceThreshold` (number, optional)

Threshold that classifies an occluder as a back face, from 0 to 1. Default: `0.5`.

#### `backfaceBoost` (number, optional)

Extra enlargement of back-face occluders, from 0 to 1. Default: `0.5`.

#### `filter` (boolean, optional)

Apply the bilateral filter. Default: `true`.

#### `largeFilter` (boolean, optional)

Use the 13-tap filter. `false` uses the 5-tap filter. Default: `true`.

#### `filterSymmetry` (boolean, optional)

Use the smaller weight of each pair of opposite taps for both taps. This keeps contact shadows
sharp. Default: `true`.

#### `filterDepthSensitivity` (number, optional)

Depth sensitivity of the filter. `0` disables the depth test. Default: `512`.

#### `filterNormalSensitivity` (number, optional)

Normal sensitivity of the filter. `0` disables the normal test. Default: `16`.

#### `randomSeed` (number, optional)

Seed of the per-pixel noise. Default: `0`. Keep it constant to prevent flicker.

#### `showOcclusion` (boolean, optional)

Show the occlusion as a gray image. Default: `false`.

## Methods

#### `setProps(props: CORTAOEffectProps)`

Updates the props. Call `deck.redraw()` after this call.

## Limits

- WebGL 2 and WebGPU. The effect picks the GLSL or the WGSL passes from the device type. Both
  backends give the same occlusion, except for small depth differences between the two
  rasterizers.
- On WebGPU, the effect adds a depth attachment to the deck.gl post-process buffers. The layer
  pipelines have a depth format on WebGPU, so a draw into a buffer without depth is invalid.
- On WebGPU, the canvas must use the `rgba8unorm` format, because the deck.gl post-process
  buffers use it and the layer pipelines use the canvas format.
- Perspective views only. On an orthographic view the effect logs a warning and passes the scene
  through.
- The effect uses the first viewport only.
- The effect draws the layers two times. The capture target has no multisampling, so the
  polygon edges lose antialiasing.
- The effect ignores the color input of the post-process chain. Put it before other
  post-process effects.
- The occlusion darkens all light, because deck.gl has no separate ambient light buffer.
- No reverse depth, because deck.gl does not make a reverse-depth buffer.
- No bent normals and no temporal accumulation.
