# What's New

### `@deck.gl-community/editable-layers` v9.0.0

Target Release date: April, 2024

This new module is a fork of @deck.gl-community/editable-layers. @deck.gl-community/editable-layers is an important part of the deck.gl ecosystem but the repository has lacked maintainers for several years and the repository no longer accepts external contributions.

- The code has been updated to work with deck.gl v9. 
- The module structure has been simplified via the module mapping in the table below.

| @deck.gl-community/editable-layers module | Description         | deck.gl-community module                      |
| ----------------------------------------- | ------------------- | --------------------------------------------- |
| nebula.gl                                 | The core module     | => `@deck.gl-community/editable-layers`       |
| `@nebula.gl/edit-modes`                   | Optional edit modes | => `@deck.gl-community/editable-layers`       |
| `@nebula.gl/layers`                       | The actual layers   | => `@deck.gl-community/editable-layers`       |
| `@nebula.gl/overlays`                     | React overlays      | => `@deck.gl-community/react`                 |
| `@nebula.gl/editor`                       | React wrappers      | => `@deck.gl-community/react-editable-layers` |
| `react-map-gl-draw`                       | Non-deck-wrapper    | => NOT FORKED                                 |

### `@deck.gl-community/layers` v9.0.0

- Target Release date: March 26, 2024
- New version of the `@deck.gl-community/layers` module for deck.gl v9.

### `@deck.gl-community/layers` v8.0.0

Release date: 2023

- `TileSourceLayer`
- `DataDrivenTile3DLayer`

### `@deck-graph-layers` v9.0.0

This module is a fork of graph.gl. graph.gl is an useful part of the deck.gl ecosystem but the repository has lacked maintainers for several years and the repository no longer accepts external contributions.
