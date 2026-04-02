# SkyboxLayer

Renders a camera-centered cubemap background using a luma.gl cube texture.

See the [Skybox Globe example](/examples/layers/skybox-globe) and the
[Skybox First Person example](/examples/layers/skybox-first-person).

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

### `loadOptions` (TextureCubeLoaderOptions, optional)

Forwarded to loaders.gl when loading the cubemap. When passing an in-memory manifest that
contains relative face URLs, provide `loadOptions.core.baseUrl` (or `loadOptions.baseUrl`) so
those relative paths can be resolved.

## Notes

- Place the layer early in the `layers` array so it behaves as a background.
- The skybox follows camera rotation but ignores camera translation, so it stays visually fixed
  around the viewer in both `GlobeView` and `FirstPersonView`.
