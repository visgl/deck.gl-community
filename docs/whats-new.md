# What's New

Modules in `@deck.gl-community` are independently maintained, so this page is just a high-level overview. 
- Detailed release information is typically found in the documentation of each module. - However, major releases are typically synchronized to ensure compatiblity with new
deck.gl versions.

## v9.3 - In planning

Some inofficial wishlist and roadmap type information is available in github trackers:

- **`@deck.gl-community/editable-layers`** 
  - [Tracker](https://github.com/visgl/deck.gl-community/issues/38)
- **`@deck.gl-community/graph-layers`**
  - [Tracker](https://github.com/visgl/deck.gl-community/issues/78)
- **`@deck.gl-community/infovis-layers`**
  - Goal: Some of the improved support for (non-geospatial) views etc should be upstreamed into deck.gl v9.3.

## v9.2

Released: February 20, 2026

**Highlights:**
- deck.gl v9.2 compatibility (`~9.2.8`).
- Website: documentation improvements, search, and new gallery examples.
- Tests migrated from `jest` to `vitest`.
- `editable-layers` now uses turf.js 7 and official GeoJSON types.
- New `@deck.gl-community/widgets` module with unofficial deck.gl UI widgets.
- New `@deck.gl-community/timeline-layers` module for time-series visualization.

### `@deck.gl-community/three`

- `TreeLayer` - NEW layer for rendering 3D tree/forest datasets using Three.js instanced meshes.

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

Graph Event Handling:
- Graph events are now handled via callback props rather than `EventTarget`.

Graph Examples:
- `GraphViewer` example expanded to cover all new layouts with live UI controls for layout options.

Graph Documentation:
- Significant updates and new content throughout.

## v9.1

Released: July 8, 2025

**Highlights**
- deck.gl 9.1 updates.
- Website fixes and example improvements.

**`@deck.gl-community/leaflet`** 
- This module is published to npm.
- A working example is now up on the website.

**`@deck.gl-community/geo-layers`** (New module)
- `GlobalGridLayer` - A new "generic" global grid layer that works against a pluggable `GlobalGrid` decoder.
- `GlobalGrid` -  A small abstraction API for global grid decoders, making it easier to write visualizations / applications that can work with multiple global grids.
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

Released:  December 22, 2023

[**`@deck.gl-community/layers`**](/docs/modules/layers) v0 - A new module intended to containing a collection of useful community layers. Initial layers are `TileSourceLayer`, `DataDrivenTile3DLayer`.

Released: April 14, 2023: 

[**`@deck-graph-layers`**](/docs/modules/graph-layers) - A new layer pack for rendering graphs (nodes and edges). Forked from Uber's archived [graph.gl](https://graph.gl) repo.
