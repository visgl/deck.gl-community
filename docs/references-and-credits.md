---
title: Attributions and Credits
description: Contributors, upstream projects, libraries, data, and imagery behind deck.gl-community.
---

# Attributions and Credits

Thank you to the people who build, document, test, and maintain these packages. The project
draws on visualization software and research shared by many teams. Source code, related work,
formats, and example assets each have their own provenance. [Repository contributors](https://github.com/visgl/deck.gl-community/graphs/contributors)

## Package origins

| Area | Sources and contributions |
| --- | --- |
| Editable layers and React | The **nebula.gl contributors** built the editing layers and interaction modes that continue in Editable Layers. The community React package also carries forward components from the nebula.gl editor. [Editable Layers history](./modules/editable-layers/README.md) |
| Graph layers | **Uber’s Graph.gl team and contributors** started Graph.gl. The OpenJS community continued work on graph visualization in deck.gl-community. [Graph Layers history](./modules/graph-layers/developer-guide/get-started.md) |
| Wind layers | **Nicolas Belmonte’s** original deck.gl wind visualization inspired the modern port and provides the historical showcase data. **Vladimir Agafonkin and the Delaunator contributors** provide the station triangulation library. [Original showcase](https://github.com/visgl/deck.gl/tree/master/showcases/wind/src) · [Wind showcase guide](./modules/geo-layers/developer-guide/wind-showcase.md) · [Delaunator](https://github.com/mapbox/delaunator) |
| Global grids | **Jon Atkins and AJ ONeal’s s2-geometry** supplied code adapted under ISC terms. The grid family also draws on the **node-geohash contributors** and the separately installed **H3 and A5 libraries**. [S2 source notice](https://github.com/visgl/deck.gl-community/blob/master/modules/layers/src/global-grid-layers/global-grid-systems/s2-geometry/s2-geometry.ts) · [H3](https://h3geo.org/) · [A5](https://a5geo.org/) |
| Vega prototype | **Microsoft Research’s VIDA group** created SandDance. We thank **Dan Marshall** for his engineering work and credit **Steven Drucker, Roland Fernandez, Deokgun Park, and Niklas Elmqvist** for the visualization and grammar research identified in the module. [SandDance](https://github.com/microsoft/SandDance) · [Vega provenance and notices](https://github.com/visgl/deck.gl-community/tree/master/modules/vega#attribution-and-upstream-project) |

## Ecosystem foundations

- The **deck.gl and luma.gl contributors** maintain the layer model, picking, device APIs, and
  shader infrastructure used throughout the project. [deck.gl](https://deck.gl/) · [luma.gl](https://luma.gl/)
- The **math.gl and loaders.gl contributors** maintain geometry, projection, and data-loading
  tools used by community layers. Their inventories document adaptations and retained notices.
  [math.gl credits](https://math.gl/docs/references-and-credits) · [loaders.gl credits](https://loaders.gl/docs/references-and-credits)
- The **Apache Arrow contributors** supply the JavaScript columnar and IPC implementation used in
  the Playground and other packages. [Apache Arrow JS](https://github.com/apache/arrow-js)
- The **D3 and Turf contributors** provide libraries used for graph layouts and geospatial editing.
  [D3](https://d3js.org/) · [Turf](https://turfjs.org/)

## Imagery and examples

- The [Community photograph](./community.md) comes from the shared vis.gl documentation for the
  2026 Open Visualization Collaborator Summit in Zürich. [Image source](https://github.com/visgl/math.gl/blob/317715c422c01c3b6fa3ab02841eb46cf0957997/website/static/images/community/zurich-summit-2026.jpg)
- The Skybox examples use **NASA’s Tycho Star Map**, converted to cubemap faces, and images
  from the **luma.gl cubemap example contributors**. [NASA Tycho Star Map](https://science.nasa.gov/3d-resources/tycho-star-map/) · [Cubemap sources](https://github.com/visgl/deck.gl-community/blob/master/examples/layers/skybox-assets/cubemap.ts)

## Licenses and notices

The repository uses the MIT license. Package licenses and source notices record retained
copyright and license terms. Separately distributed dependencies, images, and datasets retain
their own terms. [Repository license](https://github.com/visgl/deck.gl-community/blob/master/LICENSE) · [Package sources](https://github.com/visgl/deck.gl-community/tree/master/modules)
