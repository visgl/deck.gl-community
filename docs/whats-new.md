# What's New

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed news.


## v9.2 - In developments

Target Release Date: July 2025

- deck.gl-community modules will be updated to deck.gl v9.2.
- `GraphLayer` now accepts `Graph` or `GraphEngine` instances via its `data` prop, updates the internal engine when `data` or
  `layout` change, and deprecates the standalone `graph` prop.

## v9.1

Release Date: July 2025

High-level changes
- All deck.gl-community modules have been updated to deck.gl v9.1.

**`@deck.gl-community/infovis-layers`** (New module)

- `HorizonGraphLayer`
- `TimeAxisLayer`
- `VerticalGridLayer`
- Utilities for deck.gl view management

**`@deck.gl-community/geo-layers`** (New module)

- `GlobalGridLayer` - A new "generic" global grid layer that works against a pluggable `GlobalGrid` decoder.
- `GlobalGrid` -  A small abstraction API for global grid decoders, making it easier to write visualizations / applications that can work with multiple global grids.
- `A5Grid`, `H3Grid`, `S2Grid`, `GeohashGrid`, `QuadkeyGrid` - Pre-defined global grid system "decoders" for some of the most popular global grids that can be used with the `GlobalGridLayer`

## v9.0

November 20, 2024:

[**`@deck.gl-community/editable-layers`**](/docs/modules/editable-layers)) 

- When drawing circles or ellipses properties of the created geometry are now stored in the vector's properties.

April 15, 2024: 

[**`@deck.gl-community/editable-layers`**](/docs/modules/editable-layers))

This new layer pack is a fork of Uber's [nebula.gl](https://nebula.gl) framework (which unfortunately no longer provides write access to maintainers). 

Feb 29, 2024: 

[**`@deck.gl-community/layers`**](/docs/modules/layers)

`@deck.gl-community/layers` now support deck.gl v9.

## Pre v9.0 Updates

December 22, 2023

[**`@deck.gl-community/layers`**](/docs/modules/layers) v0 - A new module intended to containing a collection of useful community layers. Initial layers are `TileSourceLayer`, `DataDrivenTile3DLayer`.

April 14, 2023: 

[**`@deck-graph-layers`**](/docs/modules/graph-layers) - A new layer pack for rendering graphs (nodes and edges). Forked from Uber's archived [graph.gl](https://graph.gl) repo.
