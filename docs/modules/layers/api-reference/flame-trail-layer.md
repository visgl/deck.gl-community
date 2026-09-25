---
title: FlameTrailLayer
---

# FlameTrailLayer

`FlameTrailLayer` renders timestamped paths as rising 3D fire: a white-hot leading
head, curling orange tongues, a blue reaction zone, and drifting ember particles.
It subclasses deck.gl's [TripsLayer](https://deck.gl/docs/api-reference/geo-layers/trips-layer)
and accepts the same props.

## Usage

```typescript
import {FlameTrailLayer} from '@deck.gl-community/layers';

const layer = new FlameTrailLayer({
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

Update `currentTime` to move the trip playhead. The flame keeps burning when
`currentTime` is static, with turbulence and embers driven automatically by
deck.gl's animation timeline. No animation props or per-frame updates are needed.

## How it works

The implementation is a TripsLayer subclass with four small source files:

| File | Responsibility |
| --- | --- |
| `flame-trail-layer.ts` | Reuses TripsLayer's attributes, time clipping, fading, and picking; installs the geometry and shader injections. |
| `flame-trail-geometry.ts` | Builds 96 horizontal sheets, 64 upright sheets, and eight ember quads per segment, all in one instanced draw. |
| `flame-trail-layer-vertex.ts` | Raises the sheets above the path, fits their feet to terrain, blends viewing directions, and moves embers. |
| `flame-trail-layer-fragment.ts` | Turns scrolling noise into curling flame shapes, then maps heat to color and density to opacity. |

The sheets overlap to approximate a volume. Two crossing directions keep it
visible from above and from the side. `currentTime` controls route clipping and
fuel age. Each draw passes deck.gl's elapsed time to the shader to move noise
and embers, then requests another frame. No CPU particle updates or extra draw
calls are needed.

## Properties

All [TripsLayer properties](https://deck.gl/docs/api-reference/geo-layers/trips-layer#properties)
and inherited PathLayer props are supported, including accessors, picking,
width units, rounded joints, `opacity`, and update triggers.

| Property | Behavior |
| --- | --- |
| `currentTime` | Controls the trip playhead, trail clipping, and fuel age. Holding it fixed leaves the flame animated. |
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

new FlameTrailLayer({
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

## Rendering notes

- Requires WebGL2; WebGPU is not supported by this shader.
- Crossed volume slices rise above the path in common space, so pitching or
  orbiting the camera reveals actual height and parallax. Flame height scales
  with the path width. A rounded, hotter combustion front marks the playhead.
- This is a procedural volume approximation, not a fluid simulation. It does
  not produce smoke, cast light on surrounding geometry, or simulate wind.
- The flame uses three-octave noise without a flame texture. The slices cost more
  geometry and fragment shading than TripsLayer; benchmark dense datasets on target devices.
- The two slice directions blend by their camera-facing weights to suppress
  edge-on bands. Upright slices share a continuous join across path segments;
  flame edges use derivative-based antialiasing.
- Embers spawn in timestamp bins with at most eight emitters per path segment.
  Small, short-lived flecks rise close to the plume and cool from orange to red,
  with quiet intervals and varied trajectories between bursts. They obey the
  same time window, color tint, and opacity.
- Depth writes are disabled and both sides render by default for translucent
  volume slices. Explicit `parameters` can override these defaults.
- Wider paths (roughly 12–60 pixels) reveal the detail. Narrow paths still work,
  but cannot display the same visible flame structure. Extremely close views can
  reveal slices; transparent intersecting flames use ordinary alpha blending.
- Relative timestamps in seconds are a useful starting point. The initial flame
  tuning uses timestamp units directly: multiplying all timestamps and playback
  values changes the spatial noise frequency and emission spacing. Flame animation
  speed is independent of those units.
  Subtract an epoch offset before passing timestamps to avoid float32 precision loss.
- For reduced-motion preferences, applications can render a TripsLayer instead
  of the continuously animated flame.

## Example

[Open the interactive demo](/examples/layers/flame-trail) or run
`yarn workspace @deck.gl-community/example-flame-trail start-local`.
The standard example panel controls trip playback, time, tint, width, fading,
terrain fitting, and the TripsLayer comparison. Flames animate automatically
while the trip is paused. Reduced-motion preferences start with TripsLayer.
The example also includes a Hide UI action and a 12-second 1080p recorder that
follows Play trip and Trip speed. Terrain generation, controls, and recording
live entirely in the example workspace.
