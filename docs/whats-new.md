# What's New

## v9.4 - In Development

Highlights:

- Updated the community modules for deck.gl and luma.gl 9.4.
- Expanded WebGPU support across the layer catalog. See the
  [WebGPU support matrix](./webgpu.md) for current support and known limitations.
- Added reusable wind visualization layers and new panel and widget APIs.

### `@deck.gl-community/arrow-layers`

- All [GeoArrow layers](/docs/modules/arrow-layers/api-reference/layers) now support WebGPU.

### `@deck.gl-community/editable-layers`

- [`EditableGeoJsonLayer`](/docs/modules/editable-layers/api-reference/layers/editable-geojson-layer)
  now supports WebGPU, including polygon, path, and edit-handle picking.

### `@deck.gl-community/geo-layers`

- [`WindLayer`](/docs/modules/geo-layers/api-reference/wind-layer) (new) renders
  interpolated, speed-colored wind arrows.
- [`ParticleLayer`](/docs/modules/geo-layers/api-reference/particle-layer) (new) animates up to one
  million particles on the GPU with WebGL2 or WebGPU.
- [`ElevationLayer`](/docs/modules/geo-layers/api-reference/elevation-layer) (new) renders smooth,
  image-based terrain on WebGL2 and WebGPU.
- [`DelaunayCoverLayer`](/docs/modules/geo-layers/api-reference/delaunay-cover-layer) (new) renders
  the triangulated weather-station surface.
- [`DelaunayInterpolation`](/docs/modules/geo-layers/api-reference/delaunay-interpolation) (new)
  samples and rasterizes weather fields independently of the rendering backend.
- [`GlobalGridLayer`](/docs/modules/geo-layers/api-reference/global-grid-layer) now supports WebGPU.
- [`TileGridLayer`](/docs/modules/geo-layers/api-reference/tile-grid-layer) now renders tile borders
  on WebGPU.
- The [Wind Map](/examples/geo-layers/wind) includes original forecast data, three-dimensional
  mountains, tilt-and-rotate camera controls, and a 1,000-to-1,000,000-particle density slider.

### `@deck.gl-community/graph-layers`

- [`RoundedRectangleLayer`](/docs/modules/graph-layers/api-reference/layers/rounded-rectangle-layer)
  now supports WebGPU.
- [`PathEdgeLayer`](/docs/modules/graph-layers/api-reference/layers/path-edge-layer) now supports
  WebGPU.
- [`EdgeArrowLayer`](/docs/modules/graph-layers/api-reference/layers/edge-arrow-layer) now supports
  WebGPU.

### `@deck.gl-community/layers`

- [`DependencyArrowLayer`](/docs/modules/layers/api-reference/dependency-arrow-layer) (new) renders
  dependency links with path, line, or arc routing on WebGL2 and WebGPU.
- [`PathOutlineLayer`](/docs/modules/layers/api-reference/path-outline-layer) now uses deck.gl
  v9-native sublayers and supports WebGPU.
- [`PathMarkerLayer`](/docs/modules/layers/api-reference/path-marker-layer) now supports dashed
  strokes and pixel-sized directional markers on WebGL2 and WebGPU.

### `@deck.gl-community/infovis-layers`

- [`AnimationLayer`](/docs/modules/infovis-layers/api-reference/animation-layer) (new) animates a
  child layer from a frame schedule.
- [`BlockLayer`](/docs/modules/infovis-layers/api-reference/block-layer) (new) renders dense interval
  blocks on WebGL2 and WebGPU, with width cutoffs, stroke alignment, opacity, and color overrides.
- [`TimeDeltaLayer`](/docs/modules/infovis-layers/api-reference/time-delta-layer) (new) renders
  interval guides and labels on WebGL2 and WebGPU.

### `@deck.gl-community/timeline-layers`

- [`TimeAxisLayer`](/docs/modules/timeline-layers/api-reference/time-axis-layer) now supports
  adaptive duration and timestamp grids.
- [`HorizonGraphLayer`](/docs/modules/timeline-layers/api-reference/horizon-graph-layer) now supports
  WebGPU.
- [`MultiHorizonGraphLayer`](/docs/modules/timeline-layers/api-reference/multi-horizon-graph-layer)
  now supports WebGPU.
- [`VerticalGridLayer`](/docs/modules/timeline-layers/api-reference/vertical-grid-layer) now
  supports WebGPU.

### `@deck.gl-community/react`

- [`Panel`](/docs/modules/react/api-reference/panel) (new) renders reusable
  `@deck.gl-community/panels` definitions in React and MDX trees.

### `@deck.gl-community/three`

- [`TreeLayer`](/docs/modules/three/api-reference/tree-layer) improves the `palm` silhouette with a
  detailed frond crown and ring-scarred trunk, and now supports WebGPU.

### `@deck.gl-community/widgets`

- [`ColorLegendWidget`](/docs/modules/widgets/api-reference/color-legend-widget) (new) renders
  categorical, continuous, and compact color legends.
- [`PanelWidget`](/docs/modules/widgets/api-reference/panel-widget) (new) hosts any panel component
  as a deck.gl widget.
- [`OmniBoxWidget`](/docs/modules/widgets/api-reference/omni-box-widget) adds debounced asynchronous
  search, refresh reruns, result-state callbacks, and custom result summaries.
- [`TimeMeasureWidget`](/docs/modules/widgets/api-reference/time-measure-widget) lets users adjust
  either boundary of a completed time range.

### `@deck.gl-community/panels`

- [`PanelComponent`](/docs/modules/panels/api-reference/panel-components/panel-component) (new) is the
  common lifecycle for directly mountable panel UI.
- [`Panel`](/docs/modules/panels/api-reference/panel) now extends `PanelComponent`, providing a
  consistent base for leaf and composite panels.
- [`ModalPanelContainer`](/docs/modules/panels/api-reference/panel-containers/modal-panel-container)
  adds non-blocking floating dialogs, drag handles, custom placement, and custom styling.
- [`BinaryDataPanel`](/docs/modules/panels/api-reference/binary-data-panel) (new) previews binary
  data as hexadecimal and ASCII rows.
- [`ArrowTablePanel`](/docs/modules/panels/api-reference/arrow-table-panel) (new) previews Apache
  Arrow tables.
- [`ArrowSchemaPanel`](/docs/modules/panels/api-reference/arrow-schema-panel) (new) inspects Apache
  Arrow schemas and metadata.
- [`ArrowBatchesPanel`](/docs/modules/panels/api-reference/arrow-batches-panel) (new) summarizes
  Apache Arrow record batches.

## v9.3

Released: April 15, 2026

### `@deck.gl-community/geo-layers`

- [`SharedTile2DLayer`](/docs/modules/geo-layers/api-reference/shared-tile-2d-layer) (new) shares one
  tiled data source across multiple layer instances and views.
- [`SharedTileset2D`](/docs/modules/geo-layers/api-reference/shared-tileset-2d) (new) coordinates tile
  caching and loading across layers and views.
- [`TileGridLayer`](/docs/modules/geo-layers/api-reference/tile-grid-layer) (new) visualizes tile
  loading, bounds, and zoom depth.
- New [`SharedTile2DLayer` example](/examples/geo-layers/shared-tile-2d-layer) showing one shared auto-tiled GeoJSON `TableTileSource` and one shared `SharedTileset2D` feeding multiple styled comparisons plus a minimap.

<img src="/images/icon-no-react.svg" alt="No React example UI initiative" width="72" align="right" />

Highlights:

- deck.gl v9.3 compatibility
- Examples transitioned from React to "pure JavaScript" examples using deck.gl widget panels.
- Website and remaining React examples now build against React 19; `@deck.gl-community/react` accepts both React 18 and React 19.

### `@deck.gl-community/layers`

- [`SkyboxLayer`](/docs/modules/layers/api-reference/skybox-layer) (new) renders a camera-centered
  cubemap in 3D-capable views from a URL or in-memory manifest.

Examples:

- [SkyboxLayer MapView](/examples/layers/skybox-map-view)
- [SkyboxLayer GlobeView](/examples/layers/skybox-globe)
- [SkyboxLayer FirstPersonView](/examples/layers/skybox-first-person)

### `@deck.gl-community/basemap-layers` (NEW module)

A new experimental basemap module for rendering style-defined basemaps directly with deck.gl.

- [`BasemapLayer`](/docs/modules/basemap-layers/api-reference/basemap-layer) (new) renders MapLibre or
  Mapbox style documents with deck.gl sublayers.
- [BasemapLayer MapView](/examples/layers/basemap-layer-map-view) - Interactive flat-map control example with style switching and globe/flat runtime validation.

**`@deck.gl-community/basemap-layers/map-style`** - Utilities for loading and working with map styles available as a separate deck.gl independent sub-export:

- [`MapStyleLoader`](/docs/modules/basemap-layers/api-reference/map-style-loader) (new) resolves and
  validates style documents through loaders.gl.
- [Map style utilities](/docs/modules/basemap-layers/api-reference/map-style) provide schemas,
  property evaluation, feature filtering, and URL resolution.

### `@deck.gl-community/three` (NEW module)

New module for THREE.js integration experiments.

- [`TreeLayer`](/docs/modules/three/api-reference/tree-layer) (new) renders varied, seasonal 3D
  forests with five tree silhouettes and optional crops. See the
  [Wild Forest example](https://github.com/visgl/deck.gl-community/tree/master/examples/three/wild-forest).

## v9.2

Released: February 20, 2026

**Highlights:**

- deck.gl v9.2 compatibility
- Website: documentation improvements, search, and new gallery examples.
- Tests migrated from `jest` to `vitest`.
- `editable-layers` now uses turf.js 7 and official GeoJSON types.
- New `@deck.gl-community/widgets` module with experimental deck.gl UI widgets.
- New `@deck.gl-community/timeline-layers` module for time-series visualization.

### `@deck.gl-community/widgets` (NEW module)

A new module containing experimental widgets for deck.gl:

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

- Graph events are now handled via callback props rather than `EventTarget`.
- `GraphViewer` example expanded to cover all new layouts with live UI controls for layout options.
- Significant updates and new content throughout.

## v9.1

Released: July 8, 2025

**Highlights**

- deck.gl 9.1 compatility.
- Website fixes and example improvements.

**`@deck.gl-community/leaflet`**

- This module is published to npm.
- A working example is now up on the website.

**`@deck.gl-community/geo-layers`** (New module)

- `GlobalGridLayer` - A new "generic" global grid layer that works against a pluggable `GlobalGrid` decoder.
- `GlobalGrid` - A small abstraction API for global grid decoders, making it easier to write visualizations / applications that can work with multiple global grids.
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

Released: December 22, 2023

[**`@deck.gl-community/layers`**](/docs/modules/layers) v0 - A new module intended to containing a collection of useful community layers. Initial layers are `TileSourceLayer`, `DataDrivenTile3DLayer`.

Released: April 14, 2023:

[**`@deck-graph-layers`**](/docs/modules/graph-layers) - A new layer pack for rendering graphs (nodes and edges). Forked from Uber's archived [graph.gl](https://graph.gl) repo.
