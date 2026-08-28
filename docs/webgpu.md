# WebGPU Compatibility and Migration

deck.gl-community is adding WebGPU support incrementally while continuing to support WebGL2. Compatibility is tracked per layer and integration: adding a WebGPU adapter to a package does not, by itself, make every shader, extension, or map integration portable.

## Layer support matrix

✅ means implemented and verified, 🚧 means partial, planned, or dependent on additional validation, and ❌ means unavailable on that backend.

| Module | Layer or integration | WebGL2 | WebGPU | Notes |
| --- | --- | :---: | :---: | --- |
| `@deck.gl-community/layers` | `SkyboxLayer` | ✅ | ✅ | Native GLSL and WGSL cubemap shaders. |
| `@deck.gl-community/layers` | `DependencyArrowLayer`, `line` mode | ✅ | ✅ | Portable `LineLayer` and native WGSL marker geometry. |
| `@deck.gl-community/layers` | `DependencyArrowLayer`, `arc` mode | ✅ | ✅ | Browser-verified upstream `ArcLayer` and native WGSL marker geometry. |
| `@deck.gl-community/layers` | `DependencyArrowLayer`, `path` mode | ✅ | ✅ | Browser-verified upstream `PathLayer`, outlines, and native WGSL markers. |
| `@deck.gl-community/layers` | `PathOutlineLayer` | ✅ | ✅ | Upstream dual-backend `PathLayer`; a local WGSL dash plugin bridges the still-GLSL-only `PathStyleExtension`. |
| `@deck.gl-community/layers` | `PathMarkerLayer` | ✅ | ✅ | Browser-verified outlined and dashed paths with native WGSL marker geometry. |
| `@deck.gl-community/infovis-layers` | `BlockLayer` | ✅ | ✅ | Native WGSL, projection, picking, fills, outlines, and float32 binary attributes. |
| `@deck.gl-community/infovis-layers` | `AnimationLayer` | ✅ | 🚧 | Depends on the wrapped layer's backend support. |
| `@deck.gl-community/infovis-layers` | `TimeDeltaLayer` | ✅ | ✅ | Portable interval guides and native WGSL `FastTextLayer` labels. |
| `@deck.gl-community/infovis-layers` | `FastTextLayer` | ✅ | ✅ | Native WGSL adapted from luma.gl's text-renderer patterns; existing packed glyphs, bitmap/SDF atlases, clipping, alignment, and mipmaps work on both backends. |
| `@deck.gl-community/timeline-layers` | `HorizonGraphLayer` | ✅ | ✅ | Native WGSL; WebGPU preserves float bits in baseline-compatible `r32uint` textures. |
| `@deck.gl-community/timeline-layers` | `MultiHorizonGraphLayer` | ✅ | ✅ | Portable horizon shaders and dual-backend line dividers. |
| `@deck.gl-community/timeline-layers` | `TimeAxisLayer` | ✅ | 🚧 | Grid lines are portable; upstream `TextLayer` labels still require stable WebGPU validation. |
| `@deck.gl-community/timeline-layers` | `VerticalGridLayer` | ✅ | ✅ | Browser-verified portable `LineLayer` grid marks and viewport-driven ticks. |
| `@deck.gl-community/timeline-layers` | `TimelineLayer` geometry | ✅ | ✅ | Browser-verified tracks, clips, scrubber polygons, and lines using upstream dual-backend layers. |
| `@deck.gl-community/timeline-layers` | `TimelineLayer` labels and interactions | ✅ | 🚧 | Text labels and pointer/drag behavior still require stable WebGPU browser coverage. |
| `@deck.gl-community/graph-layers` | `GraphLayer`, `EdgeLayer`, and node layers | ✅ | 🚧 | Static path edges, arrow decorators, and rounded nodes are portable; complete graph styling, images, labels, layouts, and picking still require end-to-end validation. |
| `@deck.gl-community/graph-layers` | `RoundedRectangleLayer` | ✅ | ✅ | Rounded corners are CPU-tessellated and rendered with upstream dual-backend `PolygonLayer`. |
| `@deck.gl-community/graph-layers` | `PathEdgeLayer` and `EdgeArrowLayer` | ✅ | ✅ | Browser-verified upstream path rendering and polygon arrowheads. |
| `@deck.gl-community/graph-layers` | `FlowPathLayer` | ❌ | ❌ | Existing transform-feedback implementation is incomplete; requires redesign. |
| `@deck.gl-community/geo-layers` | `ParticleLayer` | ✅ | ✅ | Browser-verified WebGL2 transform-feedback and WebGPU compute advection; production rendering uses GPU particle buffers without readbacks. |
| `@deck.gl-community/geo-layers` | Wind-field utilities and `DelaunayInterpolation` | ✅ | ✅ | Backend-independent station indexing, explicit sampling, and optional CPU rasterization. |
| `@deck.gl-community/geo-layers` | `WindLayer` | ✅ | ✅ | Native WGSL/GLSL filled-arrow triangles and portable line shafts and arrowheads. |
| `@deck.gl-community/geo-layers` | `ElevationLayer` | ✅ | ❌ | Image-derived mountain terrain depends on upstream `TerrainLayer`; skipped safely on WebGPU. |
| `@deck.gl-community/geo-layers` | `DelaunayCoverLayer` | ✅ | ✅ | Native WGSL/GLSL station triangles, elevation scaling, and height-based coloring. |
| `@deck.gl-community/geo-layers` | Complete Wind Map showcase | ✅ | 🚧 | GPU particles, arrows, labels, and station terrain are portable; image terrain and map boundaries remain upstream-dependent. |
| `@deck.gl-community/geo-layers` | Tile and global-grid layers | ✅ | 🚧 | Validate upstream sublayers, tile formats, and picking. |
| `@deck.gl-community/arrow-layers` | `GeoArrowPathLayer` and `GeoArrowSolidPolygonLayer` | ✅ | ✅ | Browser-verified zero-copy binary path and polygon attributes. |
| `@deck.gl-community/arrow-layers` | Remaining GeoArrow layers | ✅ | 🚧 | Validate each upstream renderer; `GeoArrowTripsLayer` still has custom shader work. |
| `@deck.gl-community/editable-layers` | GeoJSON paths, polygons, and edit handles | ✅ | ✅ | Browser-verified `EditableGeoJsonLayer` rendering in `ModifyMode`, including the WebGPU picking-width shader path. |
| `@deck.gl-community/editable-layers` | Editing and selection interactions | ✅ | 🚧 | Pointer, drag, snapping, and selection behavior still require browser interaction coverage on WebGPU. |
| `@deck.gl-community/basemap-layers` | `BasemapLayer` | ✅ | 🚧 | Support depends on the selected style's polygon, path, and label sublayers. |
| `@deck.gl-community/three` | `TreeLayer` | ✅ | ❌ | Depends on the external Three.js renderer and canvas integration. |
| `@deck.gl-community/leaflet` | Leaflet map overlay | ✅ | ❌ | A host-owned WebGL context cannot be switched to WebGPU. |
| `@deck.gl-community/bing-maps` | Bing Maps overlay | ✅ | ❌ | A host-owned WebGL context cannot be switched to WebGPU. |
| `@deck.gl-community/widgets` | `DeviceManagerController` and `DeviceTabsWidget` | ✅ | ✅ | Selects and attaches an independently managed real rendering device. |

## Selecting a graphics backend

The website injects luma.gl-style WebGPU/WebGL2 tabs into every gallery example and live
layer-reference example. Its shared imperative-example host owns a separate
`DeviceManagerController` and standalone `DeviceTabsWidget` for each mounted surface, preserves the
example's existing widgets and view state, and passes the selected luma.gl device to the actual
`Deck` instance. Standalone examples stay independent: they only expose an optional
`onDeckInitialized` callback so a website or another embedding application can configure their
`Deck`.

The `@deck.gl-community/widgets` package also exposes both primitives for applications that want to manage their own backend selection:

```ts
import {Deck} from '@deck.gl/core';
import {DeviceManagerController, DeviceTabsWidget} from '@deck.gl-community/widgets';

const manager = new DeviceManagerController();
let deck;
let activeDevice;
let currentViewState = initialViewState;

const unsubscribe = manager.subscribe(({device}) => {
  if (!device || device === activeDevice) {
    return;
  }

  activeDevice = device;
  deck?.finalize();
  manager.reparentCanvas(container, device);
  deck = new Deck({
    device,
    parent: container,
    initialViewState: currentViewState,
    onViewStateChange: ({viewState}) => {
      currentViewState = viewState;
      return viewState;
    },
    layers: createLayers(device),
    widgets: [
      new DeviceTabsWidget({
        devices: ['webgpu', 'webgl2'],
        manager
      })
    ]
  });
});

void manager.initialize();

// When the surface is removed:
unsubscribe();
deck?.finalize();
manager.reset();
```

WebGPU is preferred when available. The manager respects a previously selected backend, disables
unavailable devices, and falls back to WebGL2. A backend switch must recreate `Deck` with the newly
selected device; `deck.setProps({device})` does not migrate an existing renderer, canvas, or layer
resources. Preserve view state across recreation, create only layers supported by the selected
backend, and call `manager.reset()` after finalizing the renderer to destroy every cached device.

Every documentation page also displays a generated WebGPU status badge linked to this matrix.
Specific verified or blocked layer pages override their package's aggregate status, while
backend-neutral APIs are marked not applicable. Standalone example applications accept an optional
device and widgets but do not own device management. Path outlines, path markers, and dependency
routes now render through the selected backend.

## Compatibility roadmap

| Stage | Layers or integrations | Status |
| --- | --- | --- |
| Existing reference | `SkyboxLayer` | Provides native WGSL and GLSL sources, portable cubemap bindings, and a switchable skybox example. |
| First wave | `BlockLayer`, `DependencyArrowLayer` marker geometry, `HorizonGraphLayer`, and `MultiHorizonGraphLayer` | Native WGSL and existing GLSL are maintained together. Stacked horizon dividers use the upstream dual-backend `LineLayer`; the website injects real WebGPU/WebGL2 device selection into the skybox, path, block, and horizon examples. |
| Wind showcase | `ParticleLayer`, wind-field utilities, `WindLayer`, and `DelaunayCoverLayer` | WebGL2 transform-feedback, WebGPU compute, native arrow triangles, and station-surface rendering are browser-verified. Image-based mountain terrain still depends on upstream `TerrainLayer`. |
| Path and polygon unblock | `PathOutlineLayer`, `PathMarkerLayer`, `DependencyArrowLayer`, `TimelineLayer` geometry, GeoArrow paths and polygons, editable GeoJSON, and static graph geometry | deck.gl 9.4 alpha.2 supplies dual-backend path and polygon shaders. Community layers use them directly, with a local WGSL dash plugin until `PathStyleExtension` gains native WGSL. |
| Second wave | `FastTextLayer` | Add a small WGSL compatibility shader to the existing glyph layer, following luma.gl `master`'s `TextRenderer` and Arrow text patterns while retaining the published luma.gl 9.3 dependency line. |
| Trace rendering | `TraceGraphLayer`, `TracePreparedStateLayer`, `TraceProcessLayer`, and counter sparklines | Reuse shared dual-backend blocks, fast text, and lines; preserve external float32 trace attributes; automatically select portable text and straight dependency routes on WebGPU. |
| Upstream v10 | `TextRenderer` and Arrow text | Replace the compatibility path with luma.gl's optimized text and Arrow renderers after their currently private v10 modules are published. |
| Graph geometry | `RoundedRectangleLayer`, `PathEdgeLayer`, and `EdgeArrowLayer` | Replace the fragment-only rounded rectangle and mesh arrowhead with CPU-tessellated polygons, then validate static path and polygon geometry on both backends. Full `GraphLayer` integration remains in progress. |
| Dedicated redesign | `FlowPathLayer` and animated graph flows | The current transform-feedback implementation is incomplete and WebGL-specific. Replace it with a backend-neutral animation or compute design; do not treat shader translation alone as a port. |
| Subsequent validation | Remaining Arrow, editable interactions, geospatial tiles, and basemap layers | Validate remaining upstream sublayers, picking interactions, tile and texture formats, and each demonstrated example independently. |
| Host-dependent integrations | Three.js, Leaflet, Bing Maps, and external map renderers | Support depends on the host renderer and canvas ownership. A host-owned WebGL context cannot be switched to WebGPU by adding device tabs. |

The skybox map example also composes a basemap. `SkyboxLayer` itself has native WebGPU shaders, while complete basemap compatibility remains subject to the downstream GeoJSON, polygon, path, and label sublayers used by the selected style.

## Porting a custom layer

Provide one native WGSL `source` in addition to the existing GLSL `vs` and `fs`:

```ts
getShaders() {
  return super.getShaders({
    source: webgpuShader,
    vs: webglVertexShader,
    fs: webglFragmentShader,
    modules: [project32, color, picking, layerUniforms]
  });
}
```

Declare WGSL resource bindings with `@binding(auto)`, keep each shader module's uniform types in the same order as its WGSL structure, and use `Model`, `Geometry`, `Texture`, and `renderPass` rather than a raw WebGL context. Include real browser coverage for available devices, and explicitly skip WebGPU rendering when a browser cannot supply a WebGPU adapter.

Do not assume `r32float` or `rgba32float` textures are filterable on a baseline WebGPU adapter.
For nearest-neighbor data textures, an integer texture plus WGSL `bitcast` preserves the original
float bits without requiring the optional `float32-filterable` feature.

To explicitly run the complete Chromium suite with software WebGPU, use:

```sh
DECK_GL_COMMUNITY_SOFTWARE_WEBGPU=true yarn test-headless
```

WebGPU rendering tests wait for submitted GPU work and fail on native shader, pipeline, and
validation errors. Browser environments without an adapter continue to run the WebGL2 assertions.

Do not update a package-wide WebGPU compatibility badge until all of the package's advertised layers and integrations have been validated.
