# basemap-layers

The `basemap-layers` module provides a [deck.gl](https://deck.gl) `BaseMapLayer` that can render a basemap showing geography with water, land, rivers, roads, labels etc.

In contrast to other basemap integrations available for deck.gl (primarily Mapbox, Google Maps, ArcGIS etc) the `BaseMapLayer` is a standard deck.gl `CompositeLayer` subclass, that renders basemap geometry using other deck.gl layers such as the `MVTTileLayer`, `TerrainLayer` and `TextLayer`.

The `BasemapLayer` approach of rendering basemaps using a true deck.gl layer has both advantages and disadvantages:

- Notably, it now offers applications that just need a basic basemap the option to do all rendering with deck.gl and avoid external dependencies, potentially leading to smaller bundle sizes and faster application startup.
- Being a true deck.gl layer, it will also support all deck.gl rendering modes, including use with the deck.gl `GlobeView`, which is not supported by any of the existing basemaps.
- It may in some cases render the basemap faster as all rendering is now kept within deck.gl's WebGL context and render loop.
- On the flip side, external basemap libraries are heavily optimized to accelerate map tile loading and are likely to display the first tiles bit faster.

## Goals

A software stack that can render a commercial-quality, world-class basemap is a very complex thing. This module is NOT intended to be a replacement for specialized basemap software. The following goals and non-goals are intended to help set reasonable the expectations for prospective users:

Goals for the deck.gl `BaseMapLayer` include:

- **A backdrop basemap** - For the ~90% of deck.gl applications where the key visuals are provided by the remaining deck.gl layers, and the basemap is mainly a “backdrop” that provides visual context.
- **Globe Support** - The `BasemapLayer` works in all deck.gl views, notably in globe mode which is currently not covered by any of the external basemap integrations,
- **Terrain-Adjusted Visualization** - When using 3D basemaps, deck.gl visualizations need to be adjusted to match the terrain. If required, the `BasemapLayer` design will be expanded to support this use case as it is implemented.

Non-goals include:

- Being a complete replacement of a paid basemap for map-critical use cases.
- Full support for map styling
- Full asian character set support
- Perfect label placement
- Matching loading performance of commercial basemap libraries.

Naturally, contributions and/or funding in the non-goal areas is still welcome.

## Feature Gap Analysis

> This section is still TBD.

This section is intended to show what features of a traditional external basemap library are supported by the `BasemapLayer`.

| Feature                      | Details                           | Replacement                                    |
| ---------------------------- | --------------------------------- | ---------------------------------------------- |
| Water                        |                                   |
| Roads                        |
| labels                       |                                   | Would require more sophisticated TileLayer     |
| Terrain                      |                                   | Yes, TerrainLayer                              |
| 3D visualization integration | Datavis layers adapt to elevation | No (but highly prioritized in deck.gl roadmap) |
| Sky Styling                  |                                   | No, we could add styling, skybox support etc.  |
| Free Camera                  |                                   | Yes, `FirstPersonView`, etc                    |
| Progressive Loading          |                                   | No                                             |
| `GlobeView`                  |                                   | Yes                                            |

kepler.gl impact

Beyond basemap serving, there are some mapbox specific features in kepler.gl.

# Support Concerns

While deck.gl maintainers are very supportive of the `BaseMapLayer`, it is kept separate from deck.gl because of concerns that it could become a magnet for a long list of detailed feature requests, clarification discussions and debugging asks from users around the world.

To avoid overwhelming limited support resources this repository is kept separate and clearly marked as not covered by deck.gl maintainers.

he primary export is the `BaseMapLayer` layer, which accepts

- [A vector tile URL]()
- [A style specification]()

## License

MIT License
