import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# ParticleLayer

:::caution Work in progress
The wind-layer API, GPU simulation, particle appearance, and tuning controls are experimental and
may change. WebGL2 and WebGPU particle simulation are browser-tested independently; a complete
WebGPU wind scene still depends on upstream terrain, polygon, and path support.
:::

`ParticleLayer` animates GPU-resident particles through a station-interpolated geographic wind
field. WebGL2 uses transform feedback and single-vertex point rendering; WebGPU uses a compute
shader and portable deck.gl sublayers. Neither simulation reads particle positions back to the CPU.

<LayerLiveExample highlight="particle-layer" size="tall" />

## Import

```ts
import {ParticleLayer} from '@deck.gl-community/geo-layers';
```

## Example

```ts
import {Deck} from '@deck.gl/core';
import {createWindField, parseWindData, ParticleLayer} from '@deck.gl-community/geo-layers';

const stations = await fetch('/wind/stations.json').then(response => response.json());
const weather = await fetch('/wind/weather.bin').then(response => response.arrayBuffer());
const windField = createWindField(stations, parseWindData(weather, stations.length));

const deck = new Deck({
  initialViewState: {longitude: -98, latitude: 38, zoom: 4, pitch: 45},
  controller: true
});

let time = 0;

function animate() {
  deck.setProps({
    layers: [
      new ParticleLayer({
        id: 'wind-particles',
        windField,
        time,
        numParticles: 100_000,
        speedScale: 0.16,
        color: [186, 233, 223, 34],
        elevationScale: 24,
        surfaceOffset: 1_700,
        pointRadiusPixels: 0.7
      })
    ]
  });

  time += 1 / 108;
  requestAnimationFrame(animate);
}

animate();
```

Keep `windField` and `id` stable. deck.gl transfers the existing simulation state to the next
layer instance, so advancing `time` does not reallocate the particle buffers.

## Properties

### `windField` (`WindField`, required)

Shared station forecast created with [`createWindField`](./wind-field.md). Changing the field
creates a new GPU simulation.

### `time` (`number`, default `0`)

Fractional forecast-frame index and simulation time. Forecast frames wrap automatically.

### `numParticles` (`number`, default `2400`)

Number of simulated GPU particles. The showcase defaults to `100_000` and lets you select up to
`1_000_000`. Changing the count necessarily reallocates the simulation buffers; debounce sliders
rather than reallocating on every pointer-move event.

### `trailLength` (`number`, default `12`)

Maximum retained history for the device-free CPU fallback. The GPU path instead renders directly
from current and previous GPU buffers and fades particles by their GPU-resident lifetime. At high
densities it prioritizes single-vertex points over additional trail geometry.

### `speedScale` (`number`, default `0.085`)

Geographic distance per 30-fps-equivalent simulation step. Simulation speed is adjusted for elapsed
time instead of assuming a fixed browser frame rate.

### `widthMinPixels` (`number`, default `1.1`)

Minimum visible trail width in screen pixels.

### `color` (`Color`, default `[194, 246, 224, 210]`)

RGBA particle and trail color. The GPU multiplies alpha by fade-in and fade-out lifetime curves.
Use a lower alpha when rendering hundreds of thousands of overlapping particles.

### `elevationScale` (`number`, default `1`)

Multiplier applied to station-interpolated elevation in meters.

### `surfaceOffset` (`number`, default `160`)

Vertical separation in meters above the interpolated terrain.

### `pointRadiusPixels` (`number`, default `1.6`)

Radius of moving particle heads in screen pixels.

## Rendering and lifecycle

- WebGL2: cached `rgba32float` weather textures, transform-feedback ping-pong buffers, and one
  native point vertex per particle.
- WebGPU: cached weather textures, a WGSL compute pipeline, and GPU-buffer-backed sublayers.
- Coverage: invalid samples are respawned within the wind field; overlong segments are clipped.
- Cleanup: deck.gl finalization releases the weather textures, simulation buffers, and pipeline.
- Scope: GPU particle compatibility does not imply that `TerrainLayer`, `SolidPolygonLayer`, or
  `PathLayer` is already WebGPU-compatible.

See the [wind showcase guide](../developer-guide/wind-showcase.md), the
[Wind Map example](/examples/geo-layers/wind), and the
[WebGPU compatibility matrix](/docs/webgpu).
