import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# SkyboxLayer

<LayerLiveExample highlight="skybox-layer" />

<p class="badges">
  <img src="https://img.shields.io/badge/From-v9.3-blue.svg?style=flat-square" alt="From v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="Experimental" />
</p>

Renders a camera-centered cubemap background using a luma.gl cube texture.

See the [SkyboxLayer MapView example](/examples/layers/skybox-map-view), the
[SkyboxLayer GlobeView example](/examples/layers/skybox-globe), and the
[SkyboxLayer FirstPersonView example](/examples/layers/skybox-first-person).

## Import

```ts
import {SkyboxLayer} from '@deck.gl-community/layers';
```

## Example

```ts
import {SkyboxLayer} from '@deck.gl-community/layers';

new SkyboxLayer({
  id: 'skybox',
  cubemap: {
    shape: 'image-texture-cube',
    faces: {
      '+X': 'right.png',
      '-X': 'left.png',
      '+Y': 'top.png',
      '-Y': 'bottom.png',
      '+Z': 'front.png',
      '-Z': 'back.png'
    }
  },
  orientation: 'y-up',
  loadOptions: {
    core: {
      baseUrl: 'https://example.com/assets/environment.image-texture-cube.json'
    }
  }
});
```

## Properties

### `cubemap` (string | TextureCubeManifest, required)

Either:

- a URL to a loaders.gl `image-texture-cube` manifest JSON file
- an in-memory manifest object with the same shape

The layer loads the cubemap once and reuses the GPU texture until the source changes.

### `orientation` (`'default' | 'y-up'`, optional)

Controls how the cubemap faces should be interpreted relative to deck.gl's Z-up scene.

- Use `'default'` for cubemaps already authored in deck.gl's expected orientation.
- Use `'y-up'` for cubemaps authored for Y-up scenes, such as the NASA Tycho cubemap
  used by the `SkyboxLayer GlobeView` example.

### `loadOptions` (TextureCubeLoaderOptions, optional)

Forwarded to loaders.gl when loading the cubemap. When passing an in-memory manifest that
contains relative face URLs, provide `loadOptions.core.baseUrl` (or `loadOptions.baseUrl`) so
those relative paths can be resolved.

## Notes

- Place the layer early in the `layers` array so it behaves as a background.
- The skybox follows camera rotation but ignores camera translation, so it stays visually fixed
  around the viewer in `MapView`, `GlobeView`, and `FirstPersonView`.
- `SkyboxLayer` does not provide its own lighting or sun model; apparent "sun" placement comes
  entirely from the cubemap imagery.
