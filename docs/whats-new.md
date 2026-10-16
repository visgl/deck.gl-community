# What's New

This page lists module additions and major changes in each release. For detailed release notes, see the [repository changelog](https://github.com/visgl/deck.gl-community/blob/master/CHANGELOG.md).

## Unreleased

- [`VolumetricVideoLayer`](/docs/modules/layers/api-reference/volumetric-video-layer) (new) supports WebGL2 and WebGPU video-frame uploads, static-pixel filtering, GPU mip generation, and volume rendering.
  turns MP4/MOV frames into a GPU-rendered image-X/image-Y/time volume with `currentFrame`,
  `frameTrail`, native-pixel sampling, and GPU static-pixel removal. The
  [local-file demo](/examples/layers/volumetric-video) includes stabilized camera controls
  and bounded GPU history that preserves the last working volume on allocation failure. Later valid
  seeks recover from decode failures, failed writes cannot expose stale frame identities,
  and GPU filter retries restore playback controls. Metadata callbacks can replace the
  live layer without discarding its newly allocated history.

- Added a compact [TreeLayer demo](/examples/layers/tree-lab) with eight species, seasons, crops, wind and picking.

- **react-fiber POC:** `DeckCanvas` attaches multiple React presentation canvases to
  one shared Deck, with scoped views, layers and widgets. A four-city standalone
  example demonstrates independent maps, shared hover state and canvas cleanup.

- Private Vega renderer: a shared declarative US-map-to-stacked-bars example moves 24,669 places from SandDance’s historical sample with GPU position/size transitions in the playground, gallery and inline docs, with smooth 2D/3D camera and lighting transitions.

- Private Vega renderer: geographic polygon/path vertices, colors and outline widths now use GPU transitions when projection signals change.

- Private Vega renderer: projected GeoJSON shape marks with holes and separate polygons, geographic point symbols, and GPU circle/square lifecycle transitions. A shared declarative geospatial example is available in the playground and inline module docs.

- The private Vega renderer adds circle/square symbols and stable GPU cuboid entry/exit transitions, with a shared declarative filtering example.

- Added reusable `SplatLayer` with direct prepared assets, constant/per-row `getSource`, heterogeneous instances, affine transforms, shared refinement budgets, optical transitions and WebGL2/WebGPU rendering. Camera and light-map culling include the filtered footprint, including reduced-resolution targets. Existing `source` callers remain compatible; prepared sources support globally sorted alpha blending with compatible sources batched together and working buffers retained through refinement; streamed RAD and file-backed scene rendering remain separate upstream work.

- `TreeLayer` moves to native vis.gl rendering with one `getTree` traits accessor, Gaussian foliage, connected wood, eight species, explicit crops and GPU wind. Canopies sort across trees, and woody refinement selects opaque meshes with structural roots retained at a distance. The old import temporarily re-exports the same constructor.

- The playground adds a **Vega** tab with live JSON editing and shared declarative unit-layout and bar-chart examples.

- A private, unpublished [Vega renderer experiment](./modules/vega/README.md) ports SandDance’s MIT-licensed Vega/deck.gl renderer to vis.gl 9.4, with animated unit-layout examples and upstream attribution.

- The BasemapLayers overview includes a synchronized comparison with MapLibre, with map, globe, and first-person views.

- The standalone playground adds local JSON, GeoJSON, CSV, and Arrow IPC uploads with Arrow inspection and `datasource://source-id` layer references.
- `GraphLayer.layoutTransitionDuration` enables opt-in position interpolation independently of layout redraw throttling.

- The graph viewer includes a live mini-map with click-to-recenter navigation. The playground
  adds a declarative graph overview using two `OrthographicView`s and one shared `GraphLayer`.

## v10 — In Development

Support for the upcoming deck.gl v10 is in development.

## v9.4

Released: September 7, 2026

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
  million particles on the GPU with WebGL2 or WebGPU, including GPU-resident particle heads and
  trails on both backends.
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

### `@deck.gl-community/widgets`

- Device-managed examples now preserve transparent canvas backgrounds across WebGPU and WebGL2,
  and keep only the active backend canvas mounted in the visible example host.
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

### `@deck.gl-community/react`

- [`Panel`](/docs/modules/react/api-reference/panel) (new) renders reusable
  `@deck.gl-community/panels` definitions in React and MDX trees.

### `@deck.gl-community/react-fiber`

- New direct community fork of Brandon Pierce's React Fiber renderer for
  composing deck.gl layers and views as React elements.
- Adds a bounded [`/compat` migration API](/docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react)
  for a supported subset of `@deck.gl/react` applications. It is not full `@deck.gl/react` parity.
- [Using with maps](/docs/modules/react-fiber/developer-guide/using-with-maps) describes the
  `/mapbox` and `/maplibre` provider roots, with one guide per provider and a guide for custom
  overlays built with `createDeckGL`.
- [`createDeckGL`](/docs/modules/react-fiber/api-reference/deckgl#custom-compatible-overlays)
  accepts `recreateOnChange` for overlay props that are read only at construction. The `/mapbox`
  and `/maplibre` roots use it for `interleaved`, so changing the prop replaces the overlay.

### `@deck.gl-community/three`

- [`TreeLayer`](/docs/modules/three/api-reference/tree-layer) improves the `palm` silhouette with a
  detailed frond crown and ring-scarred trunk, and now supports WebGPU.
- **WebGPU support:** expanded rendering support across editable geometry, global grids, graph layers, and time-series layers. Support varies by module and layer.
- **geo-layers:** new wind and GPU particle visualization, image-based terrain, and weather-field interpolation.
- **layers:** new dependency arrows, plus WebGPU support for path outlines and directional path markers.
- **infovis-layers:** new animation, interval-block, and time-delta layers.
- **widgets and panels:** new color legends, reusable panel components, floating dialogs, and binary and Apache Arrow data previews.
- **react-fiber — new module:** a community fork of the React Fiber renderer for composing deck.gl layers and views as React elements.

## v9.3

Released: April 15, 2026

- **basemap-layers — new module:** renders MapLibre and Mapbox style documents directly with deck.gl, with separate map-style loading and evaluation utilities.
- **three — new module:** Three.js integration experiments, including a layer for rendering varied, seasonal 3D forests.
- **geo-layers:** shared tile loading and caching across layers and views, plus a tile-grid visualization layer.
- **layers:** new skybox rendering for flat-map, globe, and first-person views.
- **react:** React 19 support alongside React 18.

## v9.2

Released: February 20, 2026

- **widgets — new module:** deck.gl view controls, including pan buttons and a zoom slider.
- **timeline-layers — new module:** compact time-series layers, including horizon graphs, stacked horizon graphs, time axes, and vertical grids.
- **graph-layers:** declarative graph data and unified stylesheets, directional edge arrows, and new layouts for directed acyclic graphs, radial graphs, hive plots, and graphs with parallel edges.
- **editable-layers:** polygon-hole drawing and validation, updated GeoJSON types, and geometry-editing improvements.
- **leaflet:** `DeckLayer` renamed to `DeckOverlay` for consistency with other deck.gl integrations.

## v9.1

Released: July 8, 2025

- **geo-layers — new module:** global-grid visualization with pluggable decoders for A5, H3, S2, geohash, and quadkey.
- **infovis-layers — new module:** compact time-series visualization and utilities for non-geospatial views.
- **leaflet:** published integration module and a working website example.
- **graph-layers:** partial modernization of the graph visualization codebase.

## v9.0

Released: November 20, 2024

- **editable-layers — new module:** a community fork of nebula.gl for interactive geometry editing, including circle and ellipse geometry properties.
- Added deck.gl v9 support to selected community modules.

## Earlier releases

- **layers — new module (December 2023):** reusable community layers, initially including tile-source and data-driven 3D tile layers.
- **graph-layers — new module (April 2023):** graph visualization forked from the archived graph.gl repository.
