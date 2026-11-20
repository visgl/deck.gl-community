# CORTAOEffect example

This example shows the experimental `CORTAOEffect` screen-space ambient occlusion on four test
scenes.

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
