# Upgrade Guide

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed upgrade guides.

## v9.3

### Dependencies

- Requires `deck.gl@~9.3.0-beta.1` or later.
- Requires `@luma.gl/*@~9.3.2` or later.
- Requires `@loaders.gl/*@^4.4.1` or later.

### `@deck.gl-community/panels` / `@deck.gl-community/widgets`

- New package: `@deck.gl-community/panels` now owns panel composition, standalone mounting, panel containers, theming, and related standalone UI.
- `@deck.gl-community/widgets` is now the deck-facing wrapper layer for panel-based deck.gl widgets.
- Migration:
  - Import panel definitions and panel containers from `@deck.gl-community/panels`
  - Pass those panel definitions into wrapper widgets from `@deck.gl-community/widgets`
- New preferred widget wrapper names:
  - `BoxPanelWidget`
  - `ModalPanelWidget`
  - `SidebarPanelWidget`
  - `FullScreenPanelWidget`
- Compatibility aliases remain available:
  - `BoxWidget`
  - `ModalWidget`
  - `SidebarWidget`

### `@deck.gl-community/editable-layers`

- The `@deck.gl-community/layers` peer dependency has been bumped from `^9.2.0-beta` to `^9.3.0`.

## v9.2

### `@deck.gl-community/editable-layers`

- Breaking change: `DrawPolygonMode.modeConfig.preventOverlappingLines` has been renamed to `allowSelfIntersection` with **inverted** logic.
  - Replace `{preventOverlappingLines: true}` → `{allowSelfIntersection: false}` (or simply omit — this is now the default)
  - Replace `{preventOverlappingLines: false}` → `{allowSelfIntersection: true}`

### `@deck.gl-community/leaflet`

- Breaking change: `DeckLayer` has been renamed to `DeckOverlay`.
  - Replace all imports and usages: `import {DeckLayer} from '@deck.gl-community/leaflet'` → `import {DeckOverlay} from '@deck.gl-community/leaflet'`

### `@deck.gl-community/graph-layers`

- Deprecation: Graph style constants are now defined using literals instead of objects.
  - Replace deprecated `NODE_TYPE.CIRCLE` with `'circle'`, `EDGE_TYPE.LINE` with `'line'`, etc.
- Deprecation: `GraphLayer` now groups styling under a `stylesheet` prop.
  - Replace `nodeStyle` / `edgeStyle` with `stylesheet.nodes` and `stylesheet.edges`.
- Deprecation: `graph` prop on `GraphLayer` is being phased out. Provide graphs via the `data` prop instead (supports `GraphEngine`,
  `Graph`, or raw `{nodes, edges}`/edge arrays) and supply a `layout` when the layer must build the engine for you.
- Breaking change: `JSONLoader` only normalizes raw JSON payloads. Pass `Graph` instances directly to `GraphLayer.data` rather than
  routing them through the loader.
