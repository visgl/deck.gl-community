# Upgrade Guide

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed upgrade guides.

## Unreleased

### `@deck.gl-community/panels`: panel props API

#### Consolidated sidebars

`SidePanelContainer` and `SidePanelContainerProps` are removed without compatibility aliases.
Use `SidebarPanelContainer` for both overlay drawers and docked side chrome:

```ts
new SidebarPanelContainer({
  side: 'left', pinned: true, hidable: true, panel: toolsPanel
});
```

- Set `pinned: true` to preserve the old docked layout. The sidebar's default side is `right`;
  set `side: 'left'` to preserve the old side-panel default.
- Replace `hidden` with `open: !hidden`, `defaultHidden` with `defaultOpen: !defaultHidden`,
  and `onHiddenChange` with `onOpenChange`, inverting the callback value.
- `hidable` now defaults to true. Use `{pinned: true, pinnable: false, hidable: false}` for
  permanent chrome without user controls. Application-owned `open` still applies even when
  hiding controls are disabled.
- Enable `pinnable` to expose pin/unpin controls. Closing releases layout space; reopening
  restores pin state, user sizing, and mounted content. Without `contentElement`, overlays
  remain available while configured pinned sidebars stay hidden.
- Remove old `side-panel-container` import paths and reference links; use the
  [sidebar reference](./modules/panels/api-reference/panel-containers/sidebar-panel-container.md).

#### Declarative panel props

This is a breaking panel API cleanup. No compatibility exports or aliases are provided.

- Rename `AccordeonPanel`, `AccordeonPanelProps`, `AccordeonPanelContainer`, and
  `AccordeonPanelContainerProps` to their `Accordion…` spellings. Update direct source paths
  to `accordion-panel` and documentation links to the renamed reference page.
- Rename `SplitterPanel.onChange` to `onSplitChange` and `initialSplit` to `defaultSplit`.
  `defaultSplit` is now initialization-only. To change the ratio after mounting, use controlled
  `split` with `onSplitChange`. A supplied `split` takes precedence over the default. Controlled
  dragging requests changes and waits for the application's next value.
- Panel IDs are optional in every constructor. Each concrete panel has a stable default ID;
  supply an explicit ID when multiple instances of that kind share a parent.
- Specialized panel classes now extend `Panel<TheirPublicProps>` and render from current props.
  Use `markdownPanel.setProps({markdown})`, `tabs.setProps({panels})`, and equivalent typed
  updates directly, including when nested. Fresh definitions with stable IDs still reconcile.
- Custom subclasses should render live values in `renderContent()` rather than capture
  specialized constructor values in a permanent JSX `content` snapshot. Override
  `getChildPanels()` when implementing a composition over child definitions.
- Panel metadata and `content` accessors are read-only. Replace direct field assignments with
  `setProps`. Keep IDs stable while updating; use a new definition/ID to start a new lifecycle.

See [Panel](./modules/panels/api-reference/panel.md) and
[SplitterPanel](./modules/panels/api-reference/composite-panels/splitter-panel.md).

### `@deck.gl-community/editable-layers`

#### Public export cleanup {/* #public-export-cleanup */}

v10 removes redundant GeoJSON aliases and implementation helpers
from `@deck.gl-community/editable-layers`. This is a breaking change to public imports:

| Removed export | Migration |
| --- | --- |
| `Position`, `Point`, `LineString`, `Polygon`, `MultiPoint`, `MultiLineString`, `MultiPolygon`, `Feature`, `FeatureCollection` | Import the same type directly from `geojson`. |
| `AnyGeoJson` | Use `SimpleFeatureCollection` for editable data, or a union of `Feature` and `FeatureCollection` from `geojson` for the former broad union. |
| `Style` | Define the styles your application uses through the layer's typed props. The old type was not used by the editing API. |
| `toDeckColor`, `utils`, `_memoize` | Move general color, array, and memoization helpers into your application or use an existing application utility. These are implementation details rather than editing APIs. |

```ts
import type {Feature, FeatureCollection, Point, Position} from 'geojson';
import type {
  Color,
  SimpleFeatureCollection,
  SimpleGeometry,
  Viewport
} from '@deck.gl-community/editable-layers';
```

`SimpleFeature`, `SimpleFeatureCollection`, `SimpleGeometry`,
`SimpleGeometryCoordinates`, and `PolygonGeometry` remain available, as do `Color`,
`Viewport`, edit-event types, and the helpers for custom edit handles. `Viewport` is
the editing mode's viewport state shape; it is distinct from deck.gl's viewport class.
Layer, widget, and edit-mode exports keep their existing names and behavior.
Imports of standard GeoJSON types preserve their geometry and property generics.

## v9.4.7

### `@deck.gl-community/layers`: tree and splat shadows

`TreeLayer` and `SplatLayer` now cast deck.gl shadows when a `LightingEffect` has a
`DirectionalLight` with `_shadow: true`; they previously forced `shadowEnabled: false` on their
sub-layers. Pass `shadowEnabled: false` to either layer to keep the old behavior. A lit
`SimpleMeshLayer` ground plane under a shadow light should also set `shadowEnabled: false`: in
deck.gl 9.4 it writes a shaded depth and shadows itself. See
[TreeLayer shadows](./modules/layers/api-reference/tree-layer.md#shadows).

## v9.4.6

### Removed `@deck.gl-community/three`

The deprecated compatibility workspace has been removed. Import `TreeLayer`, `TreeLayerProps`,
`TreeType`, `Season`, and `CropConfig` from `@deck.gl-community/layers` instead. This is a
breaking package removal; previously published `@deck.gl-community/three` versions remain on npm.

## v9.4.3

`RadialLayout.radius` now sets the radius of the deepest hierarchy ring. Existing layouts that
compensated for oversized rings may need their radius retuned. Angular sectors use the leaf
count rather than all graph nodes, so hierarchies with visible internal nodes fill the circle.
Nodes outside the hierarchy return no position, and edges with absent endpoints return no geometry.

### `@deck.gl-community/layers`: prepared `SplatLayer`

Use `data` for a direct prepared Gaussian asset or owner rows, and `getSource` for a constant
or per-row asset. Put new hierarchies in a `{type: 'prepared-splats', source, hierarchy}`
descriptor. The compatibility form `{data: rows, source, hierarchy}` remains supported, but
cannot be combined with direct asset data or an explicit `getSource`.

Sources and hierarchies are immutable; replace them when their columns change. Submission
budgets retain minimum visible coverage and transition overlap, and do not cap GPU memory.
A tighter `maxRenderPixels` can take one frame to apply while visibility expands for the broader filter.
Planar Cartesian and Web Mercator views in the unwrapped world are supported. Wrapped world copies
(`MapView.repeat`), `GlobeView` and URL/RAD inputs report explicit unsupported-input errors.
`transparency: 'sorted'` is supported on WebGL2 and WebGPU, with additional selected-buffer memory
and per-frame CPU sorting cost. See [SplatLayer](./modules/layers/api-reference/splat-layer.md)
for input forms and rendering limits. On WebGPU, `View.clear` is rejected until the upstream
nested-render-pass path is fixed; overlapping views without clearing are supported.

#### Foliage shadows

Native `TreeLayer` foliage and `SplatLayer` ship without built-in deck.gl foliage-shadow
integration. Applications that require foliage shadows must provide them outside these renderers.

### `@deck.gl-community/layers`: native `TreeLayer`

- `TreeLayer` is now exported by `@deck.gl-community/layers`; the deprecated `three` workspace temporarily re-exports the same constructor. Update imports to the native package. Remove `detail` / `TreeDetail`; canopy overrides target `SplatLayer`, and wood overrides target connected meshes. Crop radii now match metres, so halve old values to retain their apparent size. See the [native migration notes](./modules/layers/api-reference/tree-layer.md#migration).

### `@deck.gl-community/editable-layers`

Edit modes now consistently accept `SimpleFeatureCollection`, which supports Point,
LineString, Polygon and their Multi geometries, and excludes `GeometryCollection`.
This fixes exported constructors such as `TranslateMode` being incompatible with
`GeoJsonEditModeConstructor` in strict TypeScript projects.

Use `SimpleFeatureCollection` for editable data and `ModeProps<SimpleFeatureCollection>`
for custom mode handlers. Use `SimpleFeature` for individual editable features:

```ts
import type {
  ModeProps,
  SimpleFeature,
  SimpleFeatureCollection
} from '@deck.gl-community/editable-layers';

const feature: SimpleFeature = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0, 0]},
  properties: {}
};
const data: SimpleFeatureCollection = {type: 'FeatureCollection', features: [feature]};

function handleModeData(props: ModeProps<SimpleFeatureCollection>) {
  return props.data.features;
}
```

GeoJSON's `FeatureCollection<SimpleGeometry>` is also compatible. Validate or narrow
broader GeoJSON input before editing; `GeometryCollection` is not supported by the
edit modes. The existing `Feature` and `FeatureCollection` re-exports remain available.

#### SnappableMode strategies

Existing `new SnappableMode(customMode)` wrappers keep source-handle snapping by default.
Custom modes can implement `SnappableEditMode.getSnappingStrategy()` to choose
`ClickSnappingStrategy`, `DragSnappingStrategy`, or `SourceSnappingStrategy`; returning
`undefined` disables snapping. Strategy methods accept `ModeProps<SimpleFeatureCollection>`.
Enable edge targets with `modeConfig.edgeSnapping` and supply the current viewport.
`pickingRadius` controls the pixel threshold. Events resolve the target from the current screen
position, including the first touch click and the first corner of drag-to-draw shapes; an existing
rendered target guide is not required. Committed shapes and their preview share the resolved
pointer position. Current drag-event handle picks take priority over the last hover cache. Source drags keep the real pointer-down origin until a target
qualifies. `TransformMode` supports snapping directly and remains safe to wrap without duplicate
snap guides. The legacy `SnappableMode._handler` inspection/replacement property remains available.
Use `modeConfig.snapper` to provide a custom policy for target lookup, including external
spatial indexes. Implement `Snapper.snap` with `ModeProps<SimpleFeatureCollection>` and
omit `SnapResult.featureIndex` for external targets. Returning `null` suppresses targets
for that lookup, including source-handle translation.

The layer supplies an optional paired `ModeProps.projection` (`EditModeProjection`) for snap
targets in planar views. It accounts for `coordinateOrigin`, offset coordinate systems,
and `modelMatrix`; elevated edges retain projected depth before converting back to local data.
Standalone modes without this pair retain viewport-based projection. This does not extend
the existing unsnapped pointer-to-data conversion for offset editing; globe offsets are unverified.
Two-element coordinate origins use zero altitude without mutating the supplied array.

`additionalSnapTargets` is an array of features in the editable layer's local data frame,
before its `modelMatrix`. It carries no source-layer transform metadata. When copying
targets from a layer with a different coordinate system, origin or model matrix, convert
their coordinates before supplying them; raw coordinates from another frame are unsupported.
Set `snapToAdditionalTargetsOnly: true` to make the default snapper ignore editable-layer
features as targets while retaining them as source handles. The default remains the combined
target set. A custom `Snapper` selects its own targets and can apply the same policy directly.

#### SelectionLayer polygon selection

Polygon selection no longer waits 250 ms before calling `onSelect`. If an application relied on
that delay, schedule its own deferred work in the callback. Keep `SelectionLayer` after its
pickable target layers. Selection continues to return deck.gl GPU picking infos for visible
rendered objects, including GeoJSON and binary layer data.

## Private playground schema preview

The layer/view schema preview now rejects unknown props and invalid accessor constants. Extend a
props schema for custom layers or extension props instead of relying on unknown keys passing through.
Use `createAccessorSchema(valueSchema)` in place of the former untyped `AccessorSchema`.
Move camera fields into `viewState`/`initialViewState`; view constructor props no longer accept them.
Use upstream experimental names (`_GlobeView`, `_WMSLayer`, `_MultiIconLayer`, `_TextBackgroundLayer`)
in `@@type`. Abstract `View` is no longer accepted. See the
[schema reference](./modules/playground/api-reference/deckgl-schema.md) for the supported JSON profile.

## v9.4

Update deck.gl and luma.gl packages to `~9.4.0`. Modules that use loaders.gl require
`@loaders.gl/*@^4.4.3`.

### `@deck.gl-community/editable-layers`

`EditableGeoJsonLayer` and `SelectionLayer` now prevent primary editing gestures from
bubbling into an interleaved parent map by default. Remove application helpers that disable
and re-enable map drag handlers solely for editing. The layer leaves handler enabled states
unchanged and returns primary navigation to the map in `ViewMode` or inactive selection.
If the application owns gesture coordination, set `autoPreventMapInteractions: false` on
both the editable and selection layers. Right-button navigation, wheel zoom, and multi-touch
gestures retain their existing behavior.

### `@deck.gl-community/panels`

Panel APIs now use panel-oriented names consistently:

| v9.3 name | v9.4 replacement |
| --- | --- |
| `WidgetPanel` | [`Panel`](/docs/modules/panels/api-reference/panel) |
| `WidgetPanelTheme` | [`PanelTheme`](/docs/modules/panels/api-reference/panel-theme) |
| `WidgetPanelThemeMode` | `PanelThemeMode` |
| `AccordionWidgetContainer` | [`AccordionPanelContainer`](/docs/modules/panels/api-reference/composite-panels/accordion-panel) |
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


### `@deck.gl-community/graph-layers`

#### Graph loader imports

`DOTGraphLoader` from `@deck.gl-community/graph-layers` has been removed. Import
`DOTLoaderWithParser` from `@loaders.gl/graphs/dot-loader` for synchronous parsing or
parser-bearing loader use. Pass graph URLs directly to `GraphLayer.data` with
`loaders: [DOTLoaderWithParser]` and a `layout`; the layer converts the parsed
records and creates its own engine. Already loaded graphs can also be passed to
`data`. A custom `graphLoader` callback is unnecessary for normalized loader output.
DOT syntax validation and strict-graph behavior follow loaders.gl. The loader returns
plain graph data instead of Arrow data, and the old `dot.version` option is removed.


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
