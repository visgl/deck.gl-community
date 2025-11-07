# What's New

Modules in `@deck.gl-community` are independently maintained and released. 
The main driver for bigger synchronized releases is to synchronize with 
deck.gl version upgrades.

## v9.3 - Currently in planning

Wishlist
- **`@deck.gl-community/editable-layers`** 
  - Goal: allow editable layers to be used with non-geospatial coordinates
  - Goal: make this a generic layer pack (non-geo-speficic).
- **`@deck.gl-community/graph-layers`**
  - Goal: allow GraphLayers to be instantiated using `data: URLs` props (rather than requiring applications to prepare GraphEngines).
- **`@deck.gl-community/infovis-layers`**
  - Goal: Some of the improved support for (non-geospatial) views etc will be upstreamed into deck.gl v9.3.



## v9.2 - Currently in finalization

Target Release Date: Q4 2025

Highlights:
- deck.gl v9.2 updates.

Target Release Date: Nov 2025

High-level changes
- All deck.gl-community modules have been updated to deck.gl v9.2.
- Internal: Tests updated to use `vitest` instead of `jest`

### `@deck.gl-community/graph-layers` 

- Graph styling: new edge decorator `'arrow'` that renders arrows on directional edges.
- Graph styling: unified `stylesheet` prop with shorthand attribute references for node, edge, and decorator styles.
- Graph style constants are now defined using literals instead of objects
- New example visualizing DAGs (Directed Acyclic Graphs).

Deprecations:
- Graph style constants are now replaced by literal string constants 
  - Replace `NODE_TYPE.CIRCLE` with `'circle'`, `EDGE_TYPE.LINE` with `'line'` etc.

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
