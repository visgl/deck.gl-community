# Upgrade Guide

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed upgrade guides.

## v9.4

### `@deck.gl-community/panels`

- Breaking change: panel composition APIs no longer expose `Widget*` names from `@deck.gl-community/panels`.
- Breaking change: composite panel constructors now accept ordered `Panel[]` arrays instead of `PanelRecord` maps.
- Breaking change: `PanelComponent` is now the root mountable panels API.
- Breaking change: `Panel` now extends `PanelComponent`; leaf and composite
  panels inherit from `Panel`.
- Breaking change: shell containers were renamed to
  `BoxPanelContainer`, `ModalPanelContainer`, `SidebarPanelContainer`, and
  `FullScreenPanelContainer`.
- Breaking change: shell containers accept `panel` only; descriptor-style
  `container` inputs were removed.
- Breaking change: `PanelContentContainer`, `PanelContentRenderer`, and `asPanelContainer` were removed.
- Breaking change: `WidgetHost` was removed. Use `PanelManager` outside deck.gl
  and `PanelWidget` adapters inside deck.gl.
- Breaking change: `ToolbarPanelContainer` and `ToastPanelContainer` were
  renamed to `ToolbarComponent` and `ToastComponent`; they are specialized
  `PanelComponent` instances, not panel containers.
- Breaking change: `BoxWidget`, `ModalWidget`, `SidebarWidget`,
  `createStudioSettingsWidget`, `updateStudioSettingsWidget`, and widget-owned
  panel aliases were removed.
- Breaking change: modal and sidebar trigger icons use `triggerIcon`; the
  legacy `icon` aliases were removed.
- Migration:
  - `WidgetPanel` -> `Panel`
  - `WidgetPanelTheme` -> `PanelTheme`
  - `WidgetPanelThemeMode` -> `PanelThemeMode`
  - `AccordeonWidgetContainer` -> `AccordeonPanelContainer`
  - `TabbedWidgetContainer` -> `TabbedPanelContainer`
  - `ColumnWidgetContainer` -> `ColumnPanelContainer`
  - `PanelBox` -> `BoxPanelContainer`
  - `PanelModal` -> `ModalPanelContainer`
  - `PanelSidebar` -> `SidebarPanelContainer`
  - `PanelFullScreen` -> `FullScreenPanelContainer`
  - `ToolbarPanelContainer` -> `ToolbarComponent`
  - `ToastPanelContainer` -> `ToastComponent`
  - `useEffectiveWidgetPanelThemeMode` -> `useEffectivePanelThemeMode`
- Deck migration: wrap any `PanelComponent` with `new PanelWidget({component})`,
  or use the thin named adapters `BoxPanelWidget`, `ModalPanelWidget`,
  `SidebarPanelWidget`, `FullScreenPanelWidget`, `ToolbarWidget`, and
  `ToastWidget`.
- New API: `SplitterPanel` composes the first panel in one resizable pane and the remaining panels in a second pane.

### `@deck.gl-community/react`

- Breaking change: `WidgetPanel` was renamed to `Panel`.
- Migration:
  - `WidgetPanel` -> `Panel`
  - `WidgetPanelProps` -> `PanelProps`
  - `WidgetPanelThemeMode` -> `PanelHostThemeMode`
- The React `Panel` host now uses `@deck.gl-community/panels` theme variables directly and no longer has an `@deck.gl/widgets` peer dependency.

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
- Compatibility aliases `BoxWidget`, `ModalWidget`, and `SidebarWidget` were
  removed in v9.4.

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
