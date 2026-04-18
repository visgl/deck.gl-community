# What's New

## v9.4 - In Planning

Scope tracked in the [v9.4 milestone](https://github.com/visgl/deck.gl-community/milestone/5).

## v9.3

Released: April 15, 2026

### `@deck.gl-community/geo-layers`

- `SharedTile2DLayer` - NEW experimental tiled `CompositeLayer` that can share one `SharedTileset2D` across multiple layer instances and multiple views.
- `SharedTileset2D` - NEW shared tile cache and loading engine for coordinated multi-view / multi-layer tile loading.
- `TileGridLayer` - NEW helper overlay for visualizing tile loading, tile bounds, and tile zoom depth while debugging tiled rendering.
- New [`SharedTile2DLayer` example](/examples/geo-layers/shared-tile-2d-layer) showing one shared auto-tiled GeoJSON `TableTileSource` and one shared `SharedTileset2D` feeding multiple styled comparisons plus a minimap.

<img src="/images/icon-no-react.svg" alt="No React example UI initiative" width="72" align="right" />

Highlights:

- deck.gl v9.3 compatibility
- Examples transitioned from React to "pure JavaScript" examples using deck.gl widget panels.

### `@deck.gl-community/basemap-layers` (NEW module)

A new experimental basemap module for rendering style-defined basemaps directly with deck.gl.

- `BasemapLayer` - NEW `CompositeLayer` that loads a MapLibre / Mapbox style document and renders background, raster, vector, and label content using deck.gl sublayers.
- `getBasemapLayers` - Generate deck.gl sublayers from an already-resolved basemap style definition.
- `getGlobeBaseLayers` - Convenience helper for generating the globe-surface basemap layers.
- `getGlobeTopLayers` - Convenience helper for generating globe overlay layers such as atmosphere.
- [BasemapLayer MapView](/examples/layers/basemap-layer-map-view) - Interactive flat-map control example with style switching and globe/flat runtime validation.

#### `@deck.gl-community/basemap-layers/map-style`

Utilities for loading and working with map styles available as a separate deck.gl independent sub-export.

- `MapStyleLoader` - loaders.gl-compatible loader wrapper for resolving and validating style documents.
- `BasemapSourceSchema`, `BasemapStyleLayerSchema`, `BasemapStyleSchema`, `ResolvedBasemapStyleSchema` - Zod schemas for strongly typed style validation.
- `parseProperties` - Resolve style paint/layout properties for a given zoom level.
- `filterFeatures` - Apply Mapbox-style feature filters to decoded features.
- `findFeaturesStyledByLayer` - Inspect which features match a specific style layer.
- `resolveBasemapStyle` - Resolve style URLs, in-memory style objects, relative TileJSON references, and source URLs into a validated runtime style definition.

### `@deck.gl-community/layers`

- [`SkyboxLayer`](/docs/modules/layers/api-reference/skybox-layer) - NEW experimental layer for rendering a camera-centered cubemap background in deck.gl.
  - Supports `MapView`, `GlobeView`, `FirstPersonView`, and other 3D-capable views.
  - Accepts either a cubemap manifest URL or an in-memory cubemap manifest.
  - Includes cubemap normalization utilities for converting loaded cubemap faces into runtime texture data.

Examples:

- [SkyboxLayer MapView](/examples/layers/skybox-map-view)
- [SkyboxLayer GlobeView](/examples/layers/skybox-globe)
- [SkyboxLayer FirstPersonView](/examples/layers/skybox-first-person)

### `@deck.gl-community/three` (NEW module)

New module for THREE.js integration experiments

- [`TreeLayer`](/docs/modules/three/api-reference/tree-layer) - NEW layer for rendering 3D tree/forest datasets using Three.js instanced meshes.
  - 5 species / silhouettes: pine, oak, palm, birch, cherry.
  - Organic canopy geometry with smooth low-frequency vertex jitter.
  - Per-tree variety via position-derived random bearing and asymmetric XY scale.
  - Season-driven canopy colours (spring / summer / autumn / winter).
  - Pine tier density control (`getBranchLevels` 1–5) with per-tier drift.
  - Crop / fruit / flower visualisation (`getCrop`) with live and dropped crop spheres.
  - [Wild Forest example](https://github.com/visgl/deck.gl-community/tree/master/examples/three/wild-forest) with 9 forest zones and interactive controls.

## v9.2

Released: February 20, 2026

**Highlights:**

- deck.gl v9.2 compatibility
- Website: documentation improvements, search, and new gallery examples.
- Tests migrated from `jest` to `vitest`.
- `editable-layers` now uses turf.js 7 and official GeoJSON types.
- New `@deck.gl-community/widgets` module with unofficial deck.gl UI widgets.
- New `@deck.gl-community/timeline-layers` module for time-series visualization.

### `@deck.gl-community/widgets` (NEW module)

A new module containing unofficial / experimental widgets for deck.gl:

- `ZoomRangeWidget` - NEW deck.gl `Widget` providing a zoom slider.
- `PanWidget` - NEW deck.gl `Widget` providing pan buttons for moving the viewport.

### `@deck.gl-community/timeline-layers` (NEW module)

A new module providing time-series and timeline visualization layers (layers previously available in `@deck.gl-community/infovis-layers`):

- [`HorizonGraphLayer`](/docs/modules/timeline-layers/api-reference/horizon-graph-layer) - Compact time-series visualization using the horizon graph technique.
- [`MultiHorizonGraphLayer`](/docs/modules/timeline-layers/api-reference/multi-horizon-graph-layer) - Stack multiple horizon graphs with dividers.
- [`TimeAxisLayer`](/docs/modules/timeline-layers/api-reference/time-axis-layer) - Dynamic tick-mark time axis for timeline views.
- [`VerticalGridLayer`](/docs/modules/timeline-layers/api-reference/vertical-grid-layer) - Dynamic vertical grid lines that can sync with a time layer.

### `@deck.gl-community/editable-layers`

- `DrawPolygonMode`: Added `allowHoles` configuration to enable drawing polygon holes within existing polygons.
- `DrawPolygonMode`: Enhanced hole creation with validation to prevent overlapping or nested holes.
- `DrawPolygonMode`: Added comprehensive edit types for hole operations (`addHole`, `invalidHole`).
- `DeleteMode` is now exported from the top-level `edit-modes` entry point.
- Fixed: rectangle corners can no longer be accidentally removed when `lockRectangles` is set.
- Fixed: three-click polygon mode no longer misprocesses guide vertices.

Breaking Changes:

- `DrawPolygonMode`: `preventOverlappingLines` configuration renamed to `allowSelfIntersection` (with inverted logic).
  - **Migration**: `{preventOverlappingLines: false}` → `{allowSelfIntersection: true}`
  - **Migration**: `{preventOverlappingLines: true}` → `{allowSelfIntersection: false}` (or omit — this is now the default)

### `@deck.gl-community/leaflet`

- `DeckLayer` has been renamed to `DeckOverlay` for consistency with the deck.gl ecosystem.
  - **Migration**: replace all `DeckLayer` imports and usages with `DeckOverlay`.

### `@deck.gl-community/graph-layers`

- [`GraphLayer`](/docs/modules/graph-layers/api-reference/layers/graph-layer)
  - `GraphLayerProps.data` — `GraphLayer` now accepts `GraphEngine`, `Graph`, or raw JSON via the new `data` prop (including async URLs).

Graph Loaders:

- A common `GraphData` schema is defined and returned by all graph loaders.
- `JSONGraphLoader` normalizes edge arrays or `{nodes, edges}` objects.
- `DOTGraphLoader` — load graphs from Graphviz DOT format, including remote URLs.
- `ArrowGraph` — load graphs from Arrow columnar format.

Graph Styling:

- `GraphLayerProps.stylesheet` — unified stylesheet prop covering node, edge, and decorator styles.
- `GraphStylesheet` — NEW `'arrow'` edge decorator renders arrows on directional edges.
- `GraphStylesheet` — style constants can now be defined with simple string literals (e.g. `'circle'` instead of `NODE_TYPE.CIRCLE`).

Graph Layouts:

- `D3DagLayout` — NEW `GraphLayout` for DAGs (Directed Acyclic Graphs) with layering and collapse/expand support.
- `RadialLayout` — NEW `GraphLayout` for radial graph layouts.
- `HivePlotLayout` — NEW `GraphLayout` for hive plot graph layouts.
- `D3MultiGraphLayout` — NEW `GraphLayout` for multi-edge graph layouts.

- Graph events are now handled via callback props rather than `EventTarget`.
- `GraphViewer` example expanded to cover all new layouts with live UI controls for layout options.
- Significant updates and new content throughout.

## v9.1

Released: July 8, 2025

**Highlights**

- deck.gl 9.1 compatility.
- Website fixes and example improvements.

**`@deck.gl-community/leaflet`**

- This module is published to npm.
- A working example is now up on the website.

**`@deck.gl-community/geo-layers`** (New module)

- `GlobalGridLayer` - A new "generic" global grid layer that works against a pluggable `GlobalGrid` decoder.
- `GlobalGrid` - A small abstraction API for global grid decoders, making it easier to write visualizations / applications that can work with multiple global grids.
- `A5Grid`, `H3Grid`, `S2Grid`, `GeohashGrid`, `QuadkeyGrid` - Pre-defined global grid system "decoders" for some of the most popular global grids that can be used with the `GlobalGridLayer`

**`@deck.gl-community/timeline-layers`** (New module)

- [`HorizonGraphLayer`](https://visgl.github.io/deck.gl-community/docs/modules/timeline-layers/api-reference/horizon-graph-layer) - New layer for compact time series.
- [`MultiHorizonGraphLayer`](https://visgl.github.io/deck.gl-community/docs/modules/timeline-layers/api-reference/multi-horizon-graph-layer) - Stack multiple horizon graphs with dividers.
- [`TimeAxisLayer`](https://visgl.github.io/deck.gl-community/docs/modules/timeline-layers/api-reference/time-axis-layer) - Dynamic tick mark time axis for timeline views.
- [`VerticalGridLayer`](https://visgl.github.io/deck.gl-community/docs/modules/timeline-layers/api-reference/vertical-grid-layer) - Dynamic vertical grid lines that can sync with a time layer.

**`@deck.gl-community/infovis-layers`** (New module)

- Utilities for advanced deck.gl view management.

**`@deck.gl-community/graph-layers`**

- Code base has been partially modernized in an effort to simplify maintenance and contributions.

## v9.0

Released: November 20, 2024.

**Highlights**

- Add deck.gl v9.0 support to selected modules

[**`@deck.gl-community/editable-layers`**](/docs/modules/editable-layers))

- This new layer pack is a fork of Uber's [nebula.gl](https://nebula.gl) framework (which unfortunately no longer provides write access to maintainers).
- When drawing circles or ellipses properties of the created geometry are now stored in the vector's properties.

## Pre v9.0 Updates

Released: December 22, 2023

[**`@deck.gl-community/layers`**](/docs/modules/layers) v0 - A new module intended to containing a collection of useful community layers. Initial layers are `TileSourceLayer`, `DataDrivenTile3DLayer`.

Released: April 14, 2023:

[**`@deck-graph-layers`**](/docs/modules/graph-layers) - A new layer pack for rendering graphs (nodes and edges). Forked from Uber's archived [graph.gl](https://graph.gl) repo.
