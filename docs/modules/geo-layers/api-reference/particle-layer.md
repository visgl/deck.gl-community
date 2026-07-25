# ParticleLayer

`ParticleLayer` renders animated, fading particle trails advected through a Delaunay-interpolated
geographic wind field. It ports the particle animation from the original deck.gl wind showcase
without relying on WebGL-only transform feedback.

```ts
import {ParticleLayer} from '@deck.gl-community/geo-layers';

const layer = new ParticleLayer({
  id: 'wind-particles',
  windField,
  time,
  numParticles: 2400,
  trailLength: 12,
  speedScale: 0.085,
  color: [194, 246, 224, 210],
  elevationScale: 10,
  surfaceOffset: 160,
  pointRadiusPixels: 1.6
});
```

Advance `time` and pass a new `ParticleLayer` with the same `id` to `deck.setProps`. Deck.gl
transfers the existing particle state into the new layer, preserving continuous trails.
Particle advection is scaled to elapsed animation time rather than the browser frame rate, and
direction and speed are interpolated to produce smooth, curved streamlines.

## Properties

- `windField`: A `WindField` returned by `createWindField`.
- `time`: Fractional, cyclic weather-frame and particle-animation time.
- `numParticles`: Number of deterministic, continuously advected particles.
- `trailLength`: Maximum number of positions retained per particle.
- `speedScale`: Geographic particle movement per elapsed, 30-frame-per-second animation step.
- `widthMinPixels`: Minimum screen-space trail width.
- `color`: RGBA trail color; segments fade toward their historical positions.
- `elevationScale`: Multiplier for interpolated station elevation.
- `surfaceOffset`: Vertical separation above the rendered terrain surface, in meters.
- `pointRadiusPixels`: Radius of each bright, moving particle head.

## Sub-layers

- `trails`: A `LineLayer` containing independently faded particle-trail segments.
- `heads`: A `ScatterplotLayer` containing the animated, bright white particle heads.

See the [Wind Map example](/examples/geo-layers/wind).
