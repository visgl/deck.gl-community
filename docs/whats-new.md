# What's New

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed news, e.g:

- [`graph-layers`](/docs/modules/graph-layers#whats-new)
- [`arrow-layers`](/docs/modules/arrow-layers#whats-new)
- [`editable-layers`](/docs/modules/editable-layers#uhats-new)
- [`layers`](/docs/modules/editable-layers#whats-new)


## v9.2 - In Development

Target Release Date: July 2025

**General** 
- All deck.gl-community modules will be updated to deck.gl v9.2.

**`@deck.gl-community/layers`

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
