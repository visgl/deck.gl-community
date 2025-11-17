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

## v9.2 - Currently in alpha

Target Release Date: Nov 2025

Highlights:
- deck.gl v9.2 compatibility.
- Website: Documentation improvements and search.
- Tests updated to use `vitest` instead of `jest`

### `@deck.gl-community/widgets` (NEW module)

A new module containing unofficial / experimental widgets for deck.gl, initially:

- `ZoomRangeWidget` - NEW deck.gl `Widget` providing a zoom slider.
- `PanWidget` - NEW deck.gl `Widget` providing buttons for panning the view.

### `@deck.gl-community/graph-layers` 

- [`GraphLayer`](/docs/modules/graph-layers/api-reference/layers/graph-layer)
  - `GraphLayerProps.data` - `GraphLayer` now accepts `GraphEngine`, `Graph`, or raw JSON via the new `data` prop (including async URLs).

Graph Loaders
  - A common `GraphData` schema is defined and returned by graph loaders.
  - `JSONGraphLoader` normalizes edge arrays or `{nodes, edges}` objects.
  - `DOTGraphLoader` 

Graph Styling:
- `GraphLayerProps.stylesheet` - accepts a unified stylesheet containing all for node, edge, and decorator styles.
- `GraphStylesheet` - NEW `'arrow'` edge decorator  that renders arrows on directional edges.
- `GraphStylesheet` - constants can now be defined using simple string literals.

Graph Layouts:
- `D3DagLayout` - NEW `GraphLayout` for visualiation of DAGs (Directed Acyclic Graphs) with layering and collapse/expand functionality.
- `RadialLayout` - NEW `GraphLayout` for visualiation of radial graph layouts.
- `HivePlotLayout` - NEW `GraphLayout` for visualiation of hive plot graph layouts.
- `D3MultiGraphLayout` - NEW `GraphLayout` for visualiation of multi-edge graph layouts.

Graph Event Handling:
- Graph event handling is supported via callback props instead of EventTarget.

Graph Examples:
- The `GraphViewer` example expanded to cover all new layouts, including a UI for dynamically changing layout options.

Graph Documentation
- significant updates / new content.

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

**`@deck.gl-community/infovis-layers`** (New module)
- [`HorizonGraphLayer`](https://visgl.github.io/deck.gl-community/docs/modules/infovis-layers/api-reference/horizon-graph-layer) - New layer for compact time series.
- [`TimeAxisLayer`](https://visgl.github.io/deck.gl-community/docs/modules/infovis-layers/api-reference/time-axis-layer) - New layer for a dynamic tick mark time axis.
- [`VerticalGridLayer`](https://visgl.github.io/deck.gl-community/docs/modules/infovis-layers/api-reference/vertical-grid-layer)
- Utilities for advanced deck.gl view management - New layer for adding dynamic vertical grid lines that can sync with a time layer.

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
