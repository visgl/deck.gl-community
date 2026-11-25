# CORTAOEffect example

This example shows the experimental `CORTAOEffect` screen-space ambient occlusion on four test
scenes. It also compares CORTAO on WebGL 2 and WebGPU with the SSAO and GTAO passes of luma.gl.

```sh
yarn
cd examples/experimental/ambient-occlusion
yarn start-local
```

## Scenes

Select a scene in the panel, or set the `scene` URL parameter.

| `?scene=` | Scene | What to look at |
| --- | --- | --- |
| `city` (default) | Extruded building footprints of lower Manhattan, at street level with a low sun | Contact shadows at building bases, in courtyards and between towers |
| `terrain` | `TerrainLayer` over the Grand Canyon, at a high pitch | Valleys, side canyons and ridge lines |
| `primitives` | Procedural columns, spheres and stacked boxes on a ground plane | Crevices, gaps between columns, sphere contact points |
| `bike-parking` | San Francisco bike parking counts as extruded A5 cells | The first test scene of the effect |

## Methods and backends

Select a method in the panel, or set the `method` URL parameter. A method that needs another
device reloads the page.

| `?method=` | Method | Device |
| --- | --- | --- |
| `none` | No ambient occlusion | `?device=webgl2` (default) or `?device=webgpu` |
| `cortao-webgl2` | `CORTAOEffect`, GLSL passes | WebGL 2 |
| `cortao-webgpu` | `CORTAOEffect`, WGSL compute passes | WebGPU |
| `ssao` | luma.gl `AmbientOcclusionPass` in `'ssao'` mode | WebGPU |
| `gtao` | luma.gl `AmbientOcclusionPass` in `'gtao'` mode | WebGPU |

The **Backend** selector moves CORTAO to the other device.

Set `compare=<method>` to compare two methods with a swipe split. The page then has two decks,
each with its own device, and the same camera. The left part shows `method`, the right part shows
`compare`. Drag the white divider, or set `split=0.3` for the initial position. For example,
`?method=cortao-webgl2&compare=cortao-webgpu&show=1` compares the two CORTAO backends.

### Parameter mapping

All methods get the same capture of the layers, the same normals from depth (the CORTAO normal
reconstruction), and the same composite: the scene color times the visibility.

| Parameter | CORTAO | luma.gl GTAO | luma.gl SSAO |
| --- | --- | --- | --- |
| World radius `radius` (meters) | `radius` | `radius`, in meters: the effect gives GTAO a projection matrix in meters | No world radius. The effect converts `radius` to pixels at the distance of the view target |
| Screen limit `screenRadius` | `maxScreenSpaceRadius` | None. GTAO clamps its radius to 2 to 72 pixels | Clamps the pixel radius |
| Intensity | `intensity` (exponent, default 1) | luma.gl default, 3.2 | luma.gl default, 1.35 |
| Samples | `sampleCount` (default 16) and 16 rays | 4 slices, 6 steps per side | 12 samples |
| Denoise | CORTAO bilateral filter | Two depth-aware blur passes | Two depth-aware blur passes |
| Resolution | Full | Full (the luma.gl default is half) | Full (the luma.gl default is half) |

The default radius of each scene is: `city` 50 m, `terrain` 1000 m, `primitives` 10 m and
`bike-parking` 300 m. The `radius` URL parameter and the panel change it for all methods.

The two luma.gl evaluators read the normal texture with different Y directions: GTAO with +Y up
(view space), SSAO with +Y down (texture rows). The example flips Y for SSAO. Without the flip,
SSAO makes a flat ground about 50% gray.

## Controls

- **Ambient occlusion** turns the effect on and off.
- **Show occlusion only** shows the occlusion as a gray image.
- **Bilateral filter**, **Samples**, **Radius**, **Screen radius** and **Intensity** set the
  effect props.
- Hold the space key to see the scene without the effect. Release it to see the effect again.

## URL parameters

| Parameter | Effect |
| --- | --- |
| `scene` | The scene id. See the table above. |
| `method` | The method id. See the methods table. |
| `device` | `webgl2` or `webgpu`. Used only when the method runs on both. |
| `compare` | A second method id. Shows a swipe split. |
| `split` | The initial position of the split, from 0 to 1. Default `0.5`. |
| `ao=0` | Start with the effect off. |
| `show=1` | Start with the occlusion-only view. |
| `controls=0` | Hide the panel. |
| `samples`, `radius`, `screenRadius`, `intensity` | Initial `sampleCount`, `radius`, `maxScreenSpaceRadius` and `intensity`. |
| `filter=0` | Start with the bilateral filter off. |

## Data sources and licenses

The example loads all data by URL at runtime. The repository contains no data files.

| Scene | Data | Source | License |
| --- | --- | --- | --- |
| `city` | `examples/trips/buildings.json`, the building footprints of the deck.gl `trips` example | [visgl/deck.gl-data](https://github.com/visgl/deck.gl-data) | MIT, the license of the deck.gl-data repository |
| `terrain` | Terrarium-encoded elevation tiles | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), from the Registry of Open Data on AWS | Open data. The Grand Canyon data is from USGS 3DEP, which is public domain. The tiles require the attribution "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey", which the example shows. See the [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) of all source data sets |
| `primitives` | Generated in the example | None | MIT, the license of this repository |
| `bike-parking` | `website/sf.bike.parking.a5.json`, bike parking counts per A5 cell | [visgl/deck.gl-data](https://github.com/visgl/deck.gl-data) | MIT, the license of the deck.gl-data repository |
