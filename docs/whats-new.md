# What's New

This page lists module additions and major changes in each release. For detailed release notes, see the [repository changelog](https://github.com/visgl/deck.gl-community/blob/master/CHANGELOG.md).

## Unreleased

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
