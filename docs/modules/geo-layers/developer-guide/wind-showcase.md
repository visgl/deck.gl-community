import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# Recreating the wind showcase

:::caution Work in progress
The reusable wind layers and the historical showcase are experimental. GPU particle advection has
been independently verified on WebGL2 and WebGPU. The complete mountain-and-arrow scene currently
uses upstream terrain, polygon, and path layers, so its end-to-end WebGPU support remains a work
in progress.
:::

The Wind Map restores
[Nicolas Belmonte's original deck.gl wind showcase](https://github.com/visgl/deck.gl/tree/master/showcases/wind/src)
using reusable, publicly imported community layers and the original United States station forecast.

<LayerLiveExample highlight="wind-layer" size="tall" />

## Install

```bash
npm install @deck.gl/core @deck.gl-community/geo-layers
```

## Load and index the forecast once

```ts
import {
  createWindField,
  parseWindData,
  type WindField,
  type WindStation
} from '@deck.gl-community/geo-layers';

const dataUrl =
  'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/wind';

async function loadWindField(): Promise<WindField> {
  const [stations, weather] = await Promise.all([
    fetch(`${dataUrl}/stations.json`).then(response => response.json()) as Promise<WindStation[]>,
    fetch(`${dataUrl}/weather.bin`).then(response => response.arrayBuffer())
  ]);

  return createWindField(stations, parseWindData(weather, stations.length));
}

const windField = await loadWindField();
```

The forecast contains 72 hourly frames. Station longitudes use the original positive-west format;
`createWindField` converts them into deck.gl geographic coordinates and computes a robust Delaunay
triangulation once.

## Render terrain, arrows, and animated particles

```ts
import {
  AmbientLight,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView
} from '@deck.gl/core';
import {
  ElevationLayer,
  ParticleLayer,
  WindLayer,
  type WindField
} from '@deck.gl-community/geo-layers';

function mountWindMap(container: HTMLElement, windField: WindField): () => void {
  const terrain = new ElevationLayer({
    id: 'wind-terrain',
    elevationData: `${dataUrl}/elevation.png`,
    bounds: [-125, 24.4, -66.7, 49.6],
    elevationRange: [-100, 4126],
    elevationScale: 24,
    meshMaxError: 12
  });

  const lighting = new LightingEffect({
    ambient: new AmbientLight({color: [194, 210, 235], intensity: 0.7}),
    sunlight: new DirectionalLight({
      color: [255, 226, 198],
      intensity: 1.15,
      direction: [-1, -2, -2]
    })
  });

  const deck = new Deck({
    parent: container,
    views: new MapView({repeat: false}),
    initialViewState: {
      longitude: -98.319,
      latitude: 37.614,
      zoom: 4.05,
      pitch: 52,
      maxPitch: 85
    },
    controller: {dragRotate: true, touchRotate: true},
    effects: [lighting]
  });

  let animationFrame = 0;
  let lastTimestamp = 0;
  let lastArrowUpdate = -Infinity;
  let time = 0;
  let arrows: WindLayer | undefined;

  function animate(timestamp: number): void {
    const elapsed = lastTimestamp ? Math.min(timestamp - lastTimestamp, 100) : 0;
    lastTimestamp = timestamp;
    time += elapsed / 1800;

    if (timestamp - lastArrowUpdate >= 250) {
      arrows = new WindLayer({
        id: 'wind-arrows',
        windField,
        time,
        gridWidth: 40,
        gridHeight: 22,
        speedScale: 1.8,
        elevationScale: 24,
        surfaceOffset: 1200
      });
      lastArrowUpdate = timestamp;
    }

    deck.setProps({
      layers: [
        terrain,
        arrows,
        new ParticleLayer({
          id: 'wind-particles',
          windField,
          time,
          numParticles: 100_000,
          speedScale: 0.16,
          elevationScale: 24,
          surfaceOffset: 1700,
          pointRadiusPixels: 0.7,
          color: [186, 233, 223, 34]
        })
      ]
    });

    animationFrame = requestAnimationFrame(animate);
  }

  animationFrame = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(animationFrame);
    deck.finalize();
  };
}

const unmount = mountWindMap(document.querySelector<HTMLElement>('#app')!, windField);

// Call unmount() before removing the containing element.
```

Keep the `windField`, terrain layer, particle layer `id`, and graphics device stable. deck.gl
transfers particle simulation state to each new `ParticleLayer` instance; only its time advances.
Update the station-sampled arrows less frequently than the GPU particle frame to avoid repeating
CPU interpolation every frame.

## Smooth terrain versus the station mesh

`ElevationLayer` creates the actual mountain terrain from the original `elevation.png`. The full
showcase applies two separable Gaussian smoothing passes to that image before displaying it, then
uses `elevationScale: 24` and `meshMaxError: 12`. This preserves broad mountain ridges without
turning the weather-station Delaunay triangles into jagged terrain.

`DelaunayCoverLayer` visualizes the **weather station mesh**, not the elevation image. Enable it
when debugging interpolation coverage; do not replace the mountain terrain with it.

## Particle density and performance

The example starts with `100_000` particles and provides a debounced slider from `1_000` to
`1_000_000`. WebGL2 advances GPU-resident particle buffers using transform feedback and renders
single-vertex point primitives. WebGPU advances them with a WGSL compute shader. Neither production
animation path reads particle positions back to the CPU.

Weather textures are cached, static terrain is retained, arrow resampling is throttled, and
high-density rendering favors particle heads over additional line geometry. Changing the particle
count necessarily allocates a new simulation, so debounce density controls rather than rebuilding
buffers on every slider event.

## Backend compatibility

| Component | WebGL2 | WebGPU | Notes |
| --- | :---: | :---: | --- |
| `ParticleLayer` | Supported | Supported | Independently browser-tested GPU advection and rendering. |
| Wind data and `DelaunayInterpolation` | Supported | Supported | Backend-independent indexing and explicit sampling. |
| `WindLayer` | Supported | In progress | Depends on upstream polygon and path rendering. |
| `ElevationLayer` | Supported | In progress | Depends on upstream `TerrainLayer`. |
| `DelaunayCoverLayer` | Supported | Blocked | Depends on upstream polygon rendering. |
| Complete original showcase | Supported | In progress | GPU particles are ready; remaining scene layers are not. |

See the full [WebGPU compatibility matrix](/docs/webgpu).

## Run the repository example

```bash
yarn
yarn workspace wind-layer-example start
```

The standalone example is in `examples/geo-layers/wind`. The website mounts the same named
`mountWindExample` implementation for the [Wind Map](/examples/geo-layers/wind) and the inline
wind-layer documentation.

## API references

- [Wind field and weather data](../api-reference/wind-field.md)
- [ParticleLayer](../api-reference/particle-layer.md)
- [WindLayer](../api-reference/wind-layer.md)
- [ElevationLayer](../api-reference/elevation-layer.md)
- [DelaunayCoverLayer](../api-reference/delaunay-cover-layer.md)
- [DelaunayInterpolation](../api-reference/delaunay-interpolation.md)
