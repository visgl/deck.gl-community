# What's New

This page lists module additions and major changes in each release. For detailed release notes, see the [repository changelog](https://github.com/visgl/deck.gl-community/blob/master/CHANGELOG.md).

## Unreleased

- [`VolumetricVideoLayer`](/docs/modules/layers/api-reference/volumetric-video-layer) (new)
  turns MP4/MOV frames into a GPU-rendered image-X/image-Y/time volume with `currentFrame`,
  `frameTrail`, native-pixel sampling, and GPU static-pixel removal. The
  [community-site demo](/examples/layers/volumetric-video) uses shared device tabs and a settings panel;
  the standalone version supports local MP4/MOV files and a WebGL/WebGPU toggle. Static filtering
  applies to every frame, including the selected frame. Both demos include stabilized camera controls
  and bounded GPU history
  that preserves the last working volume on allocation failure. Later valid
  seeks recover from decode failures, failed writes cannot expose stale frame identities,
  and GPU filter retries restore playback controls. Metadata callbacks can replace the
  live layer without discarding its newly allocated history.

- Added a compact [TreeLayer demo](/examples/layers/tree-lab) with eight species, seasons, crops, wind and picking.

- **react-fiber POC:** `DeckCanvas` attaches multiple React presentation canvases to
  one shared Deck, with scoped views, layers and widgets. A four-city standalone
  example demonstrates independent maps, shared hover state and canvas cleanup.

- Private Vega renderer: a shared declarative US-map-to-stacked-bars example moves 24,669 places from SandDance’s historical sample with GPU position/size transitions in the playground, gallery and inline docs, with smooth 2D/3D camera and lighting transitions.

- Private Vega renderer: geographic polygon/path vertices, colors and outline widths now use GPU transitions when projection signals change.

- Private Vega renderer: projected GeoJSON shape marks with holes and separate polygons, geographic point symbols, and GPU circle/square lifecycle transitions. A shared declarative geospatial example is available in the playground and inline module docs.

- The private Vega renderer adds circle/square symbols and stable GPU cuboid entry/exit transitions, with a shared declarative filtering example.

- Added reusable `SplatLayer` with direct prepared assets, constant/per-row `getSource`, heterogeneous instances, affine transforms, shared refinement budgets, optical transitions and WebGL2/WebGPU rendering. Camera and light-map culling include the filtered footprint, including reduced-resolution targets. Existing `source` callers remain compatible; prepared sources support globally sorted alpha blending with compatible sources batched together and working buffers retained through refinement; streamed RAD and file-backed scene rendering remain separate upstream work.

- `TreeLayer` moves to native vis.gl rendering with one `getTree` traits accessor, Gaussian foliage, connected wood, eight species, explicit crops and GPU wind. Canopies sort across trees, and woody refinement selects opaque meshes with structural roots retained at a distance. The old import temporarily re-exports the same constructor.

- The playground adds a **Vega** tab with live JSON editing and shared declarative unit-layout and bar-chart examples.

- A private, unpublished [Vega renderer experiment](./modules/vega/README.md) ports SandDance’s MIT-licensed Vega/deck.gl renderer to vis.gl 9.4, with animated unit-layout examples and upstream attribution.

- The BasemapLayers overview includes a synchronized comparison with MapLibre, with map, globe, and first-person views.

- The standalone playground adds local JSON, GeoJSON, CSV, and Arrow IPC uploads with Arrow inspection and `datasource://source-id` layer references.
- `GraphLayer.layoutTransitionDuration` enables opt-in position interpolation independently of layout redraw throttling.

- The graph viewer includes a live mini-map with click-to-recenter navigation. The playground
  adds a declarative graph overview using two `OrthographicView`s and one shared `GraphLayer`.

## v10 — In Development

Support for the upcoming deck.gl v10 is in development.

## v9.4

Released: September 7, 2026

- **WebGPU support:** expanded rendering support across editable geometry, global grids, graph layers, and time-series layers. Support varies by module and layer.
- **geo-layers:** new wind and GPU particle visualization, image-based terrain, and weather-field interpolation.
- **layers:** new dependency arrows, plus WebGPU support for path outlines and directional path markers.
- **infovis-layers:** new animation, interval-block, and time-delta layers.
- **widgets and panels:** new color legends, reusable panel components, floating dialogs, and binary and Apache Arrow data previews.
- **react-fiber — new module:** a community fork of the React Fiber renderer for composing deck.gl layers and views as React elements.

## v9.3

Released: April 15, 2026

- **basemap-layers — new module:** renders MapLibre and Mapbox style documents directly with deck.gl, with separate map-style loading and evaluation utilities.
- **three — new module:** Three.js integration experiments, including a layer for rendering varied, seasonal 3D forests.
- **geo-layers:** shared tile loading and caching across layers and views, plus a tile-grid visualization layer.
- **layers:** new skybox rendering for flat-map, globe, and first-person views.
- **react:** React 19 support alongside React 18.

## v9.2

Released: February 20, 2026

- **widgets — new module:** deck.gl view controls, including pan buttons and a zoom slider.
- **timeline-layers — new module:** compact time-series layers, including horizon graphs, stacked horizon graphs, time axes, and vertical grids.
- **graph-layers:** declarative graph data and unified stylesheets, directional edge arrows, and new layouts for directed acyclic graphs, radial graphs, hive plots, and graphs with parallel edges.
- **editable-layers:** polygon-hole drawing and validation, updated GeoJSON types, and geometry-editing improvements.
- **leaflet:** `DeckLayer` renamed to `DeckOverlay` for consistency with other deck.gl integrations.

## v9.1

Released: July 8, 2025

- **geo-layers — new module:** global-grid visualization with pluggable decoders for A5, H3, S2, geohash, and quadkey.
- **infovis-layers — new module:** compact time-series visualization and utilities for non-geospatial views.
- **leaflet:** published integration module and a working website example.
- **graph-layers:** partial modernization of the graph visualization codebase.

## v9.0

Released: November 20, 2024

- **editable-layers — new module:** a community fork of nebula.gl for interactive geometry editing, including circle and ellipse geometry properties.
- Added deck.gl v9 support to selected community modules.

## Earlier releases

- **layers — new module (December 2023):** reusable community layers, initially including tile-source and data-driven 3D tile layers.
- **graph-layers — new module (April 2023):** graph visualization forked from the archived graph.gl repository.
