# ElevationLayer

`ElevationLayer` renders a grayscale elevation image as a genuinely three-dimensional, illuminated
terrain mesh. It ports the height-map surface used by Nicolas Belmonte's original wind showcase,
including the original elevation image, geographic bounds, and elevation range.

```ts
import {ElevationLayer} from '@deck.gl-community/geo-layers';

const layer = new ElevationLayer({
  id: 'wind-elevation',
  elevationData:
    'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/wind/elevation.png',
  bounds: [-125, 24.4, -66.7, 49.6],
  elevationRange: [-100, 4126],
  elevationScale: 80,
  meshMaxError: 480,
  color: [42, 60, 77, 255]
});
```

The layer decodes the original height map into terrain geometry using the in-process loaders.gl
terrain loader. It does not require an externally hosted terrain worker.

## Properties

- `elevationData`: URL of the red-channel grayscale terrain height map.
- `bounds`: Geographic `[west, south, east, north]` extent.
- `elevationRange`: Minimum and maximum image elevations, in meters.
- `elevationScale`: Vertical exaggeration applied to the decoded mesh.
- `meshMaxError`: Simplification error tolerance for the generated terrain mesh.
- `color`: RGBA color applied to the lit terrain surface.
- `texture`: Optional image draped over the three-dimensional mesh.

## Sub-layers

- `terrain-mesh`: A `TerrainLayer` containing the decoded elevation mesh.

See the [Wind Map example](/examples/geo-layers/wind).
