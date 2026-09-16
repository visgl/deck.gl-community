# Upgrade Guide

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed upgrade guides.

## v9.4

Update deck.gl and luma.gl packages to `~9.4.0`. Modules that use loaders.gl require
`@loaders.gl/*@^4.4.3`.

### `@deck.gl-community/panels`

Panel APIs now use panel-oriented names consistently:

| v9.3 name | v9.4 replacement |
| --- | --- |
| `WidgetPanel` | [`Panel`](/docs/modules/panels/api-reference/panel) |
| `WidgetPanelTheme` | [`PanelTheme`](/docs/modules/panels/api-reference/panel-theme) |
| `WidgetPanelThemeMode` | `PanelThemeMode` |
| `AccordeonWidgetContainer` | [`AccordeonPanelContainer`](/docs/modules/panels/api-reference/composite-panels/accordeon-panel) |
| `TabbedWidgetContainer` | [`TabbedPanelContainer`](/docs/modules/panels/api-reference/composite-panels/tabbed-panel) |
| `ColumnWidgetContainer` | [`ColumnPanelContainer`](/docs/modules/panels/api-reference/composite-panels/column-panel) |
| `PanelBox` | [`BoxPanelContainer`](/docs/modules/panels/api-reference/panel-containers/box-panel-container) |
| `PanelModal` | [`ModalPanelContainer`](/docs/modules/panels/api-reference/panel-containers/modal-panel-container) |
| `PanelSidebar` | [`SidebarPanelContainer`](/docs/modules/panels/api-reference/panel-containers/sidebar-panel-container) |
| `PanelFullScreen` | [`FullScreenPanelContainer`](/docs/modules/panels/api-reference/panel-containers/full-screen-panel-container) |
| `ToolbarPanelContainer` | [`ToolbarComponent`](/docs/modules/panels/api-reference/panel-components/toolbar-component) |
| `ToastPanelContainer` | [`ToastComponent`](/docs/modules/panels/api-reference/panel-components/toast-component) |
| `useEffectiveWidgetPanelThemeMode` | `useEffectivePanelThemeMode` |

Additional migration steps:

- Pass ordered `Panel[]` arrays to composite panels instead of `PanelRecord` maps.
- Pass a `panel` directly to shell containers. The descriptor-style `container` input and the
  `PanelContentContainer`, `PanelContentRenderer`, and `asPanelContainer` helpers were removed.
- Replace `WidgetHost` with
  [`PanelManager`](/docs/modules/panels/api-reference/managers/panel-manager) outside deck.gl. Inside
  deck.gl, wrap a component with
  [`PanelWidget`](/docs/modules/widgets/api-reference/panel-widget) or use a named panel widget.
- Import `createStudioSettingsWidget` and `updateStudioSettingsWidget` from
  `@deck.gl-community/widgets`.
- Rename the `icon` prop on modal and sidebar containers to `triggerIcon`.

### `@deck.gl-community/react`

Rename the React panel exports:

| v9.3 name | v9.4 replacement |
| --- | --- |
| `WidgetPanel` | [`Panel`](/docs/modules/react/api-reference/panel) |
| `WidgetPanelProps` | `PanelProps` |
| `WidgetPanelThemeMode` | `PanelHostThemeMode` |

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
