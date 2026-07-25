# WebGPU Compatibility and Migration

deck.gl-community is adding WebGPU support incrementally while continuing to support WebGL2. Compatibility is tracked per layer and integration: adding a WebGPU adapter to a package does not, by itself, make every shader, extension, or map integration portable.

## Layer support matrix

✅ means implemented and verified, 🚧 means partial, planned, or dependent on additional validation, and ❌ means unavailable or blocked by an upstream renderer.

| Module | Layer or integration | WebGL2 | WebGPU | Notes |
| --- | --- | :---: | :---: | --- |
| `@deck.gl-community/layers` | `SkyboxLayer` | ✅ | ✅ | Native GLSL and WGSL cubemap shaders. |
| `@deck.gl-community/layers` | `DependencyArrowLayer`, `line` mode | ✅ | ✅ | Portable `LineLayer` and native WGSL marker geometry. |
| `@deck.gl-community/layers` | `DependencyArrowLayer`, `arc` mode | ✅ | 🚧 | Marker geometry is portable; upstream `ArcLayer` requires validation. |
| `@deck.gl-community/layers` | `DependencyArrowLayer`, `path` mode | ✅ | ❌ | Blocked by upstream `PathLayer`. |
| `@deck.gl-community/layers` | `PathOutlineLayer` | ✅ | ❌ | Blocked by upstream `PathLayer` and `PathStyleExtension`. |
| `@deck.gl-community/layers` | `PathMarkerLayer` | ✅ | 🚧 | Marker geometry is portable; outlined and dashed paths remain blocked. |
| `@deck.gl-community/infovis-layers` | `BlockLayer` | ✅ | ✅ | Native WGSL, projection, picking, fills, outlines, and float32 binary attributes. |
| `@deck.gl-community/infovis-layers` | `AnimationLayer` | ✅ | 🚧 | Depends on the wrapped layer's backend support. |
| `@deck.gl-community/infovis-layers` | `TimeDeltaLayer` | ✅ | 🚧 | Upstream line and text sublayers require end-to-end validation. |
| `@deck.gl-community/infovis-layers` | `FastTextLayer` | ✅ | ✅ | Native WGSL adapted from luma.gl's text-renderer patterns; existing packed glyphs, bitmap/SDF atlases, clipping, alignment, and mipmaps work on both backends. |
| `@deck.gl-community/timeline-layers` | `HorizonGraphLayer` | ✅ | ✅ | Native WGSL and `r32float` data textures. |
| `@deck.gl-community/timeline-layers` | `MultiHorizonGraphLayer` | ✅ | ✅ | Portable horizon shaders and dual-backend line dividers. |
| `@deck.gl-community/timeline-layers` | `TimeAxisLayer` | ✅ | 🚧 | Grid lines use the portable `LineLayer`; tick labels depend on upstream `TextLayer` WebGPU support. |
| `@deck.gl-community/timeline-layers` | `VerticalGridLayer` | ✅ | 🚧 | Upstream `LineLayer` is portable; dedicated rendering validation is pending. |
| `@deck.gl-community/timeline-layers` | `TimelineLayer` | ✅ | ❌ | Blocked by upstream `SolidPolygonLayer`. |
| `@deck.gl-community/trace-layers` | `TraceGraphLayer` and `TracePreparedStateLayer` | ✅ | ✅ | Browser-verified span blocks, backgrounds, outlines, row separators, fast labels, and straight dependency markers. |
| `@deck.gl-community/trace-layers` | `TraceProcessLayer` | ✅ | ✅ | Automatically selects WebGPU-compatible binary blocks, fast span and overflow labels, and straight dependency rendering. |
| `@deck.gl-community/trace-layers` | Counter sparklines | ✅ | ✅ | Preserves every sparkline vertex as a dual-backend `LineLayer` segment. |
| `@deck.gl-community/trace-layers` | Curved dependencies and dashed separators | ✅ | 🚧 | Curves depend on upstream `ArcLayer`; portable separators use solid horizontal lines. |
| `@deck.gl-community/trace-layers` | `DeckTraceGraph` and Tracevis overview | ✅ | 🚧 | Managed devices and backend-neutral timing are available; complete legend, minimap, picking, and application validation remains in progress. |
| `@deck.gl-community/graph-layers` | `GraphLayer`, `EdgeLayer`, and node layers | ✅ | 🚧 | Custom shaders, picking, and graph styling require porting and validation. |
| `@deck.gl-community/graph-layers` | `RoundedRectangleLayer` | ✅ | ❌ | Custom fragment shader has no native WGSL implementation. |
| `@deck.gl-community/graph-layers` | `FlowPathLayer` | ❌ | ❌ | Existing transform-feedback implementation is incomplete; requires redesign. |
| `@deck.gl-community/geo-layers` | Tile and global-grid layers | ✅ | 🚧 | Validate upstream sublayers, tile formats, and picking. |
| `@deck.gl-community/arrow-layers` | GeoArrow layers | ✅ | 🚧 | Validate binary attributes and each upstream rendering layer. |
| `@deck.gl-community/editable-layers` | Editing and selection layers | ✅ | 🚧 | Validate editing interactions and upstream GeoJSON and path layers. |
| `@deck.gl-community/basemap-layers` | `BasemapLayer` | ✅ | 🚧 | Support depends on the selected style's polygon, path, and label sublayers. |
| `@deck.gl-community/three` | `TreeLayer` | ✅ | ❌ | Depends on the external Three.js renderer and canvas integration. |
| `@deck.gl-community/leaflet` | Leaflet map overlay | ✅ | ❌ | A host-owned WebGL context cannot be switched to WebGPU. |
| `@deck.gl-community/bing-maps` | Bing Maps overlay | ✅ | ❌ | A host-owned WebGL context cannot be switched to WebGPU. |
| `@deck.gl-community/widgets` | `DeviceManagerController` and `DeviceTabsWidget` | ✅ | ✅ | Selects and attaches an independently managed real rendering device. |

## Selecting a graphics backend

The website injects luma.gl-style WebGPU/WebGL2 tabs into the selected gallery examples and their corresponding layer-reference examples. Its shared imperative-example host owns a separate `DeviceManagerController` and `DeviceTabsWidget` for each mounted surface, preserves the example's existing widgets and view state, and passes the selected luma.gl device to the actual `Deck` instance. Standalone examples stay independent: they only expose an optional `onDeckInitialized` callback so a website or another embedding application can configure their `Deck`.

The `@deck.gl-community/widgets` package also exposes both primitives for applications that want to manage their own backend selection:

```ts
import {Deck} from '@deck.gl/core';
import {DeviceManagerController, DeviceTabsWidget} from '@deck.gl-community/widgets';

const manager = new DeviceManagerController();
manager.reparentCanvas(container);

const deck = new Deck({
  parent: container,
  layers,
  widgets: [
    new DeviceTabsWidget({
      devices: ['webgpu', 'webgl2'],
      manager
    })
  ]
});

const unsubscribe = manager.subscribe(({device}) => {
  if (device && deck.device !== device) {
    deck.setProps({device});
  }
});

void manager.initialize();

// When the surface is removed:
unsubscribe();
deck.finalize();
manager.reset();
```

WebGPU is preferred when available. The manager respects a previously selected backend, disables unavailable devices, and falls back to WebGL2. Switching tabs changes the device used to draw the scene; it is not only a visual indicator.

## Compatibility roadmap

| Stage | Layers or integrations | Status |
| --- | --- | --- |
| Existing reference | `SkyboxLayer` | Provides native WGSL and GLSL sources, portable cubemap bindings, and a switchable skybox example. |
| First wave | `BlockLayer`, `DependencyArrowLayer` marker geometry, `HorizonGraphLayer`, and `MultiHorizonGraphLayer` | Native WGSL and existing GLSL are maintained together. Stacked horizon dividers use the upstream dual-backend `LineLayer`; the website injects real WebGPU/WebGL2 device selection into the skybox, path, block, and horizon examples. |
| Upstream-dependent paths | `PathOutlineLayer`, `PathMarkerLayer`, dashed path routing, and `DependencyArrowLayer` path mode | Full route rendering depends on native WGSL support for deck.gl's `PathLayer` and `PathStyleExtension`. Directional marker geometry and line-mode dependencies can be ported independently, but outlined or dashed paths must not be advertised as fully WebGPU-compatible yet. |
| Second wave | `FastTextLayer` | Add a small WGSL compatibility shader to the existing glyph layer, following luma.gl `master`'s `TextRenderer` and Arrow text patterns while retaining the published luma.gl 9.3 dependency line. |
| Trace rendering | `TraceGraphLayer`, `TracePreparedStateLayer`, `TraceProcessLayer`, and counter sparklines | Reuse shared dual-backend blocks, fast text, and lines; preserve external float32 trace attributes; automatically select portable text and straight dependency routes on WebGPU. |
| Upstream v10 | `TextRenderer` and Arrow text | Replace the compatibility path with luma.gl's optimized text and Arrow renderers after their currently private v10 modules are published. |
| Third wave | `RoundedRectangleLayer` and graph node and edge layers | Audit custom fragment shaders, picking, graph styling, and inherited deck.gl layer compatibility before claiming support. |
| Dedicated redesign | `FlowPathLayer` and animated graph flows | The current transform-feedback implementation is incomplete and WebGL-specific. Replace it with a backend-neutral animation or compute design; do not treat shader translation alone as a port. |
| Subsequent validation | Arrow, editable, geospatial, and basemap layers | Validate upstream sublayers, binary attributes, picking, shader extensions, tile and texture formats, and each demonstrated example independently. |
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

Do not update a package-wide WebGPU compatibility badge until all of the package's advertised layers and integrations have been validated.
