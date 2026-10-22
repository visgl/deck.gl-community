# What's New

This page lists module additions and major changes in each release. For detailed release notes, see the [repository changelog](https://github.com/visgl/deck.gl-community/blob/master/CHANGELOG.md).

## Unreleased

- The `layers`, `geo-layers`, `infovis-layers`, `timeline-layers` and `graph-layers` ESM builds load
  in Node's native ESM loader (Vitest, SSR): shader-module imports such as `./splat.wgsl` now carry
  their `.js` extension.
- `TreeLayer` connected wood now follows `updateTriggers.getTrunkColor`, `getCoverageWeight` and
  authored wind changes. Before, the wood kept its old values until its data changed.

- `SplatLayer` and `TreeLayer` no longer throw when a `MapView` repeats wrapped world copies
  (`repeat: true`, as `MapboxOverlay`/`MapLibreOverlay` set from `renderWorldCopies`). Gaussians
  render in the primary world copy only, so apps no longer need to drop the layer at low zoom.

## v9.4.6

- **Breaking:** Removed the deprecated `@deck.gl-community/three` compatibility workspace. Import
  `TreeLayer` and its types from `@deck.gl-community/layers`.

- `TreeLayer` and `SplatLayer` spend about a quarter of the CPU time per moving frame over large
  groves: a generated 17,000-tree orchard with ~15,000 crowns in view orbits at ~11 ms instead of
  ~48 ms per frame, with the same rendered selection. Trees crossing the view edge keep their
  instance slots and upload only their own rows, optical fades rewrite only the changed coverage, and
  the shared canopy budget no longer schedules refinements once the coverage floor exhausts it. A
  controlled `highlightedObjectIndex` now highlights that source tree or owner in every wood, canopy
  and crop partition, as `autoHighlight` does.

## v9.4.5

- `TreeLayer` and `SplatLayer` canopies stay visible in interleaved `MapboxOverlay`/`MapLibreOverlay`
  maps after zooming or panning: the Gaussian depth pre-pass now clears its private target instead
  of inheriting the basemap's `clearCanvas: false`. Small camera moves and orbits keep the shared
  canopy budget rather than refining every visible crown, and `autoHighlight` highlights the hovered
  tree across wood and canopy sub-layers instead of unrelated trees at the same row index.

## v9.4.3

- `SharedTile2DLayer` and `SharedTileset2D` skip tiles beyond the horizon in a `GlobeView`, as deck.gl's
  `TileLayer` does, instead of requesting the far side of the globe. `BasemapLayer` vector and hillshade
  sources on a globe request fewer tiles as a result.

- [`VolumetricVideoLayer`](/docs/modules/layers/api-reference/volumetric-video-layer) (new)
  turns MP4/MOV frames into a GPU-rendered image-X/image-Y/time volume with `currentFrame`,
  `frameTrail`, native-pixel sampling, and GPU static-pixel removal. The
  [community-site demo](/examples/layers/volumetric-video) uses shared device tabs and a settings panel;
  the standalone version supports local MP4/MOV files and a WebGL/WebGPU toggle. Static filtering
  applies to every frame, including the selected frame. Both demos include stabilized camera controls
  and bounded GPU history
  that preserves the last working volume on allocation failure. Later valid
  seeks recover from decode failures, failed writes cannot expose stale frame identities,
  and GPU filter retries restore playback controls. Metadata callbacks can replace the
  live layer without discarding its newly allocated history.

- `SnappableMode` adds optional edge snapping and mode-specific click, drag, and source-handle
  strategies for drawing and editing. Initial clicks and drag-to-draw corners resolve targets before a guide is rendered.
  Committed shapes use the same snapped position as their preview, and drag events provide the
  current handle picks even before a pointer move is cached. Existing custom wrappers remain supported. Edge proximity
  is measured in screen pixels, including Cartesian views and bounded elevated segments. Layer-provided projection accounts for
  offset origins and model matrices, retaining local coordinates in snap results and padding
  omitted origin altitude with zero. Additional targets must be converted to the editable data frame.
  `modeConfig.snapper` accepts a custom `Snapper` policy; external targets omit editable feature indexes.
  `modeConfig.snapToAdditionalTargetsOnly` makes the default policy target only supplied external
  features while retaining editable-layer source handles.

- `SelectionLayer` polygon selection masks the full picking rectangle, fixing false positives
  outside wide, diagonal, and concave lassos. It keeps GPU picking and initializes the temporary
  mask synchronously instead of waiting 250 ms.

- Added a compact [TreeLayer demo](/examples/layers/tree-lab) with eight species, seasons, crops, wind and picking.

- Editable layers support overlaid MapLibre/Mapbox input targets. Selection masks the full lasso,
  keeps `guideType` features selectable, and resumes editing after two-finger navigation.

- **react-fiber POC:** `DeckCanvas` attaches multiple React presentation canvases to
  one shared Deck, with scoped views, layers and widgets. A four-city standalone
  example demonstrates independent maps, shared hover state and canvas cleanup.

- Private Vega renderer: a shared declarative US-map-to-stacked-bars example moves 24,669 places from SandDance’s historical sample with GPU position/size transitions in the playground, gallery and inline docs, with smooth 2D/3D camera and lighting transitions.

- Private Vega renderer: geographic polygon/path vertices, colors and outline widths now use GPU transitions when projection signals change.

- Private Vega renderer: projected GeoJSON shape marks with holes and separate polygons, geographic point symbols, and GPU circle/square lifecycle transitions. A shared declarative geospatial example is available in the playground and inline module docs.

- The private Vega renderer adds circle/square symbols and stable GPU cuboid entry/exit transitions, with a shared declarative filtering example.

- Added reusable `SplatLayer` with direct prepared assets, constant/per-row `getSource`, heterogeneous instances, affine transforms, shared refinement budgets, optical transitions and WebGL2/WebGPU rendering. Camera culling includes the filtered footprint, including reduced-resolution targets. Existing `source` callers remain compatible; prepared sources support globally sorted alpha blending with compatible sources batched together and working buffers retained through refinement; streamed RAD and file-backed scene rendering remain separate upstream work.

- Native `TreeLayer` foliage and `SplatLayer` ship without built-in deck.gl foliage-shadow integration. Applications that require foliage shadows must provide them outside these renderers.

- `TreeLayer` moves to native vis.gl rendering with one `getTree` traits accessor, Gaussian foliage, connected wood, eight species, explicit crops and GPU wind. Canopy refinement is per owner within SplatLayer's shared budget, and foliage uses SplatLayer's weighted order-independent compositing path by default. Woody refinement selects opaque meshes with structural roots retained at a distance. The old import temporarily re-exports the same constructor.

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

- **WebGPU support:** expanded rendering support across editable geometry, global grids, graph layers, and time-series layers. Support varies by module and layer.
- **geo-layers:** new wind and GPU particle visualization, image-based terrain, and weather-field interpolation.
- **layers:** new dependency arrows, plus WebGPU support for path outlines and directional path markers.
- **infovis-layers:** new animation, interval-block, and time-delta layers.
- **widgets and panels:** new color legends, reusable panel components, floating dialogs, and binary and Apache Arrow data previews.
- **react-fiber — new module:** a community fork of the React Fiber renderer for composing deck.gl layers and views as React elements.
- **editable-layers:** isolates edits from interleaved MapLibre/Mapbox pans, keeps `guideType` features selectable, and resumes editing after two-finger navigation.

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
