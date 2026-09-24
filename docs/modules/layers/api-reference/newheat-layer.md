---
title: NewHeatLayer
---

# NewHeatLayer

`NewHeatLayer` renders timestamped paths as rising 3D fire: a white-hot leading
head, curling orange tongues, a blue reaction zone, and drifting ember particles.
It subclasses deck.gl's [TripsLayer](https://deck.gl/docs/api-reference/geo-layers/trips-layer)
and accepts the same props. No additional flame props are required.

## Usage

```typescript
import {NewHeatLayer} from '@deck.gl-community/layers';

const layer = new NewHeatLayer({
  id: 'burning-trips',
  data: trips,
  getPath: d => d.path,
  getTimestamps: d => d.timestamps,
  currentTime: 180,
  trailLength: 120,
  getColor: [255, 255, 255],
  widthMinPixels: 12,
  capRounded: true,
  jointRounded: true
});
```

Use the same animation loop you use for `TripsLayer`: update `currentTime` each
frame. Keeping `currentTime` fixed freezes both playback and the flame. There
is no internal timer or random seed, so scrubbing back recreates the same fire.

## Properties

All [TripsLayer properties](https://deck.gl/docs/api-reference/geo-layers/trips-layer#properties)
and inherited PathLayer props are supported, including accessors, picking,
width units, rounded joints, `opacity`, and update triggers.

| Property | Behavior |
| --- | --- |
| `currentTime` | Controls the trip playhead and flame animation. |
| `getTimestamps` | One timestamp per path vertex, in the same units as `currentTime`. |
| `trailLength` | Length of the fading trail, in timestamp units. A zero-length fading trail is empty. |
| `fadeTrail` | Defaults to `true`. When `false`, all visited segments keep burning and `trailLength` has no effect. Future segments remain hidden. |
| `getColor` | Multiplies the procedural palette by an RGB/RGBA tint. Defaults to white (`[255, 255, 255, 255]`) so the full palette is visible. Its alpha still controls opacity. Black produces a black flame. |
| `opacity` | Multiplies the flame's varying transparency and the normal trail fade. |

## Following terrain

Add deck.gl's experimental `TerrainExtension` with `terrainDrawMode: 'offset'`
and `billboard: false`. Mark the terrain source with `operation: 'terrain+draw'`.
The flame samples its footprint from the GPU height map, including across its
width, and embers start at the sampled ground elevation. The terrain's depth
buffer occludes flames behind ridges.

```typescript
import {_TerrainExtension as TerrainExtension} from '@deck.gl/extensions';

new NewHeatLayer({
  data: trips,
  getPath: d => d.path, // XY coordinates; Z may supply an offset above terrain
  getTimestamps: d => d.timestamps,
  currentTime: 180,
  extensions: [new TerrainExtension()],
  terrainDrawMode: 'offset',
  billboard: false
});
```

Use `offset` to retain the flame's 3D height. TerrainExtension's `drape` mode
flattens the layer into a texture on the surface. Provide enough path vertices
to follow the terrain between samples; the layer does not resample sparse paths.
The demo uses a synthetic mesh with peaks and gullies and a 2D route to exercise
GPU fitting. It does not require a terrain provider or elevation API.

## Rendering notes

- Requires WebGL2; WebGPU is not supported by this shader.
- Crossed volume slices rise above the path in common space, so pitching or
  orbiting the camera reveals actual height and parallax. Flame height scales
  with the path width. A rounded, hotter combustion front marks the playhead.
- This is a procedural volume approximation, not a fluid simulation. It does
  not produce smoke, cast light on surrounding geometry, or simulate wind.
- The shader integrates three-octave noise over 96 horizontal and 64 upright
  slices in one instanced draw call. It needs no textures, but uses more geometry
  and fragment shading than TripsLayer; benchmark dense datasets on target devices.
- The two slice directions blend by their camera-facing weights to suppress
  edge-on bands. Upright slices share a continuous join across path segments;
  flame edges use derivative-based antialiasing.
- Embers spawn in timestamp bins with at most eight emitters per path segment.
  Small, short-lived flecks rise close to the plume and cool from orange to red,
  with quiet intervals and varied trajectories between bursts. They obey the
  same time window, color tint, and opacity. Their lifetimes are deterministic
  when scrubbing.
- Depth writes are disabled and both sides render by default for translucent
  volume slices. Explicit `parameters` can override these defaults.
- Wider paths (roughly 12–60 pixels) reveal the detail. Narrow paths still work,
  but cannot display the same visible flame structure. Extremely close views can
  reveal slices; transparent intersecting flames use ordinary alpha blending.
- Relative timestamps in seconds are a useful starting point. The initial flame
  tuning uses timestamp units directly: multiplying all timestamps and playback
  values changes the noise frequency and flicker speed as well as playback units.
  Subtract an epoch offset before passing timestamps to avoid float32 precision loss.
- Respect reduced-motion preferences in the application animation loop. The example
  starts paused when the browser requests reduced motion.

## Example

[Open the NewHeat demo](/examples/layers/newheat) to compare the shader with
TripsLayer, scrub time, change width and tint, or keep the whole visited path burning.
The small Settings panel switches between rugged terrain and flat ground. Use
Follow surface to compare fitting, Low angle to inspect contact and occlusion,
and Show grid / mesh to inspect the surface. Hide UI (or H) clears the frame;
Escape brings the controls back. Record 12s creates a local 1920 × 1080 canvas
recording without controls, using MP4 where supported and WebM otherwise.
