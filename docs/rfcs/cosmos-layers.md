---
title: "RFC: cosmos-layers"
sidebar_label: "RFC: cosmos-layers"
---

# RFC: `@deck.gl-community/cosmos-layers`

| Field | Value |
| --- | --- |
| Status | Proposed |
| Target | deck.gl-community 9.4 or later |
| Initial backend | WebGL2 |
| Proposed dependency | [`@cosmos.gl/graph`](https://www.npmjs.com/package/@cosmos.gl/graph) |

## Summary

This RFC proposes a new `@deck.gl-community/cosmos-layers` package that integrates the
GPU-accelerated force simulation from [cosmos.gl](https://github.com/cosmosgl/graph) with
deck.gl.

The package should be separate from `@deck.gl-community/graph-layers` so that applications that do
not use cosmos.gl do not inherit its runtime and dependency cost. The preferred public API is a
`CosmosLayout` compatible with `GraphLayer`, followed by a zero-copy `CosmosGraphLayer` if the
required integration points become available upstream.

The current cosmos.gl 3.4 API is sufficient for a prototype that periodically copies positions
from the GPU to the CPU. It is not yet sufficient for a production integration that preserves the
performance characteristics of cosmos.gl. This RFC therefore proposes:

1. an optional, explicitly experimental readback prototype;
2. collaboration with cosmos.gl on a small simulation integration API; and
3. implementation of the package only after the performance and lifecycle acceptance criteria in
   this RFC can be met.

## Motivation

`@deck.gl-community/graph-layers` already separates graph representation, layout, rendering, and
interaction. Its `GraphLayout` interface makes CPU solvers such as D3 force layouts replaceable,
but the existing `GPUForceLayout` is incomplete and does not provide a scalable GPU layout.

cosmos.gl is an attractive implementation dependency because it:

- performs force calculation on the GPU;
- accepts dense typed-array inputs for positions, links, sizes, and clusters;
- exposes simulation lifecycle callbacks and explicit `start`, `stop`, `pause`, `unpause`, and
  `step` controls;
- is implemented on luma.gl as of v3; and
- is MIT licensed and actively maintained.

A deck.gl integration would let applications combine a large force-directed graph with normal
deck.gl layers, views, extensions, widgets, and interaction patterns instead of choosing between
the two rendering systems.

## Goals

- Offer a supported cosmos.gl integration without adding cosmos.gl to the existing
  `graph-layers` dependency tree.
- Preserve stable application node IDs while adapting them to cosmos.gl's dense numeric indices.
- Reuse `GraphLayer` styling and picking for the first supported layout API where practical.
- Share deck.gl's luma.gl `Device`, frame lifecycle, and canvas in the intended architecture.
- Keep simulated positions on the GPU during steady-state animation.
- Define ownership and cleanup behavior for every GPU resource and event listener.
- Provide deterministic behavior when a `randomSeed` is supplied.
- Document WebGL2 as the initial backend and leave room for a future WebGPU implementation.

## Non-goals

- Reimplement the cosmos.gl force solver in this repository.
- Re-export the complete cosmos.gl API.
- Treat a second independently positioned canvas as a deck.gl layer.
- Promise WebGPU support before cosmos.gl offers a compatible simulation backend.
- Support geographic force calculations in the first version. Initial coordinates are
  two-dimensional Cartesian graph coordinates.

## Current architecture

### deck.gl-community

`GraphLayer` renders nodes and edges through normal deck.gl sublayers. A `GraphLayout` supplies
positions through `getNodePosition` and `getEdgePosition`, and emits an `onLayoutChange` event when
new coordinates are available. `GraphLayer` then invalidates its position attributes and queries
the layout again.

This contract is a good semantic fit for a `CosmosLayout`, but it assumes that positions are
CPU-readable. Rebuilding deck.gl attributes after every simulation tick also becomes expensive for
the graph sizes that motivate cosmos.gl.

### cosmos.gl 3.4

cosmos.gl currently exposes a high-level `Graph` that owns both simulation and rendering. It can
accept an external luma.gl `Device`, but the constructor still requires an `HTMLDivElement`, moves
the device canvas into that element, installs DOM interaction handlers, and starts its own
animation loop. Each frame creates and clears its own render pass before submitting the device.

The current public position API, `getPointPositions()`, synchronously reads the position framebuffer
and creates a JavaScript `number[]`. The GPU position textures and the simulation modules are not
part of the public API.

These behaviors are appropriate for a standalone graph renderer. Inside deck.gl they introduce
conflicting canvas ownership, frame scheduling, clearing, interaction, and GPU-to-CPU transfer.

There is also a short-term dependency mismatch to resolve. cosmos.gl 3.4 depends on luma.gl
`~9.3.6`, while deck.gl-community currently targets the 9.4 alpha line. Passing a `Device` between
two independently installed luma.gl versions is not a supported package boundary.

## Considered approaches

### 1. DOM canvas overlay

Create a cosmos.gl `Graph` in a second canvas positioned over deck.gl.

This is useful for an application-specific proof of concept but should not be published as a
deck.gl layer. It cannot participate reliably in layer ordering, deck.gl picking, effects,
multi-view rendering, view-state transforms, or render-pass composition. Two independent
interaction systems would also compete for pointer input.

**Decision:** rejected as a package architecture.

### 2. `CosmosLayout` with periodic CPU readback

Create a cosmos.gl `Graph` on a dedicated hidden canvas, map graph IDs to dense indices, and call
`getPointPositions()` from a throttled `onSimulationTick` callback. Cache the returned positions,
then emit `GraphLayout._onLayoutChange()` so `GraphLayer` redraws.

This can validate data conversion, configuration, lifecycle events, and visual results without
changes to cosmos.gl. A final readback from `onSimulationEnd` can also provide a fast
"calculate-then-render" mode.

It does not provide the main scale benefit:

- every snapshot synchronously stalls for a full framebuffer readback;
- every snapshot allocates and copies CPU position data;
- `GraphLayer` must rebuild position attributes;
- the hidden cosmos.gl instance needs a second canvas and WebGL device;
- cosmos.gl continues its render loop after the simulation has settled; and
- deck.gl node dragging cannot pin one cosmos.gl point through the current public API.

**Decision:** acceptable only as an experimental benchmark prototype. Default to a final snapshot
or a low-frequency snapshot interval, and document that real-time high-scale animation is not the
goal of this mode.

### 3. Shared-device, zero-copy integration

Run the cosmos.gl simulation on deck.gl's `Device` under deck.gl's frame scheduler. Expose the
current position texture to deck.gl-specific node and edge layers, which sample it by dense point
index. No position readback occurs in the animation loop.

This retains the reason to use cosmos.gl and allows deck.gl to control canvas composition,
redrawing, resource lifecycle, and device submission.

**Decision:** preferred architecture. It requires the upstream additions described below.

## Proposed package

The package name is `@deck.gl-community/cosmos-layers`. Keeping the adapter separate:

- makes the cosmos.gl dependency opt-in;
- allows the integration to follow cosmos.gl's release cadence;
- isolates WebGL2-only support from graph layers that are moving toward WebGPU; and
- provides room for both layout and direct GPU-rendering APIs.

The package would depend on `@cosmos.gl/graph` and use peer dependencies for
`@deck.gl-community/graph-layers`, `@deck.gl/core`, and the compatible luma.gl packages. It should
not re-export cosmos.gl classes other than types that appear in its own configuration surface.

### Phase 1: experimental `CosmosLayout`

```ts
import {GraphLayer} from '@deck.gl-community/graph-layers';
import {CosmosLayout} from '@deck.gl-community/cosmos-layers';

const layout = new CosmosLayout({
  cosmosConfig: {
    simulationGravity: 0.25,
    simulationRepulsion: 1,
    randomSeed: 'example'
  },
  snapshotIntervalMs: 0
});

new GraphLayer({
  id: 'graph',
  data: {nodes, edges},
  layout
});
```

`snapshotIntervalMs: 0` means that the layout publishes positions when the simulation ends. A
positive interval in milliseconds enables throttled intermediate snapshots and must be described
as a diagnostic or small-graph mode.

The adapter is responsible for:

- assigning a stable dense index to each node ID;
- converting initial `x` and `y` values into a `Float32Array`;
- converting source and target node IDs into the cosmos.gl link array;
- translating cosmos.gl simulation callbacks into `GraphLayout` lifecycle events;
- handling topology updates by rebuilding the dense mapping;
- computing bounds from the latest snapshot; and
- destroying the cosmos.gl graph, canvas, device, timers, and callbacks from `stop`/finalization.

The prototype must not be presented as a performance improvement until benchmarks show otherwise.

### Phase 2: `CosmosGraphLayer`

After the upstream integration API is available, add a deck.gl layer that owns a simulation-only
cosmos.gl instance and samples its GPU positions directly. The layer should:

- use `this.context.device`;
- advance the simulation from deck.gl's redraw lifecycle;
- never clear or submit the shared device independently;
- render nodes and edges in deck.gl-owned render passes;
- expose normal deck.gl picking information with original application objects and IDs; and
- keep texture-to-node index mapping stable until topology changes.

The exact class boundary depends on the upstream API. It could be a composite layer containing
custom cosmos node and edge sublayers, or a thin wrapper around an upstream
`encode(renderPass)` method.

## Improvements to cosmos.gl

The following changes would make cosmos.gl a strong reusable simulation dependency while
preserving its existing high-level `Graph` API.

### 1. Export a simulation-only class

Add a supported class that does not require a DOM element or install zoom, drag, pointer, keyboard,
attribution, or global style state.

One possible shape is:

```ts
const simulation = new GraphSimulation(device, config);
simulation.setPointPositions(positions);
simulation.setLinks(links);
simulation.initialize();
simulation.step();
simulation.destroy();
```

The existing `Graph` can compose this class with its renderer and controllers. This would reduce
the chance that downstream projects import private force, point, framebuffer, or store modules.

### 2. Support external frame scheduling

Provide an option that disables the internal `requestAnimationFrame` loop. The host should be able
to call one simulation step and optionally one render operation. Simulation completion should not
leave a perpetual render loop running.

This is needed by deck.gl, map renderers, game engines, notebook hosts, and any application with a
central scheduler.

### 3. Make DOM and canvas ownership optional

An externally supplied `Device` should not require moving its canvas into a cosmos.gl-owned
element. Simulation-only use should accept canvas, offscreen-canvas, and compute-capable devices
when the selected backend supports them.

Resource ownership should be explicit:

- an internally created device is destroyed by cosmos.gl;
- an externally supplied device is never destroyed, cleared, submitted, resized, or reparented by
  cosmos.gl; and
- listeners and auxiliary DOM nodes are created only when the corresponding controller is used.

### 4. Expose read-only GPU position resources

Provide a supported way to obtain the current position texture plus the metadata required to sample
it, including point count, texture dimensions, texel format, coordinate convention, and resource
version.

For example:

```ts
const {
  texture,
  pointCount,
  width,
  height,
  version
} = simulation.getPointPositionTexture();
```

The returned resource should remain owned by cosmos.gl. Document when ping-pong simulation swaps
change the texture handle and how consumers can observe that change.

A buffer form could be offered if a future backend stores positions in a buffer. The contract
should describe position data rather than require one storage primitive across all backends.

### 5. Accept a host render pass

If cosmos.gl rendering is to be reused, add a method that records draws into a supplied luma.gl
`RenderPass` without clearing, ending, or submitting it. Separately configurable point and link
rendering would allow hosts to use only the pieces they need.

### 6. Add efficient snapshot APIs

Zero-copy access is preferred, but CPU snapshots remain useful for export, labels, tests, and
fallback integrations. Improve `getPointPositions()` with:

- a `Float32Array` return type;
- an optional caller-provided destination array;
- an asynchronous readback option where supported; and
- an explicit statement that synchronous readback stalls the GPU.

### 7. Add indexed point mutation and pinning

Expose methods to update or pin a single point (or a sparse set of points) without replacing the
full position array. This is required to map deck.gl drag interactions to a running simulation.

Possible operations include `setPointPosition`, `setPointPinned`, and a batched sparse update API.

### 8. Align luma.gl dependency ownership

Allow cosmos.gl and its host to share one compatible luma.gl installation. Options include moving
the luma.gl packages used by the public integration surface to peer dependencies or publishing a
documented compatibility range for externally supplied devices.

The public types should not require an application to cast a `Device` solely because cosmos.gl and
deck.gl resolved different copies of `@luma.gl/core`.

### 9. Define backend capabilities

Expose capability flags for simulation, rendering, readback, external scheduling, and shared
resources. This lets an adapter fail early with an actionable message rather than infer support
from private fields or backend names.

## Lifecycle and interaction

The deck.gl adapter must define the following behavior:

- `initializeGraph`: create the dense ID mapping and initialize simulation data.
- `start`: emit layout start and begin or schedule simulation.
- `updateGraph`: rebuild topology while retaining positions for surviving node IDs when possible.
- `update`: restart the simulation after data or force configuration changes.
- `resume`: reheat or unpause the simulation.
- `stop`: stop scheduling work and release adapter-owned resources.
- `lockNodePosition`: pin a point after converting deck coordinates to cosmos coordinates.
- `unlockNodePosition`: remove the pin and optionally reheat the simulation.

cosmos.gl callbacks supplied through `cosmosConfig` must not replace the adapter's internal
lifecycle callbacks. The adapter should invoke user callbacks after it has updated its own state.

## Coordinate systems and views

The initial package supports `COORDINATE_SYSTEM.CARTESIAN` in a two-dimensional deck.gl view.
cosmos.gl simulation coordinates remain independent of screen zoom. deck.gl view state controls
projection and navigation.

Geospatial coordinates are out of scope because longitude/latitude forces need projection,
wrapping, and precision decisions. Multi-view support is contingent on using deck.gl-owned
rendering rather than a DOM overlay.

## Performance acceptance criteria

Before `CosmosGraphLayer` is described as production-ready:

- steady-state animation performs no full position readback;
- only one canvas and one luma.gl device are used;
- cosmos.gl does not create an independent animation loop, clear pass, or device submission;
- a graph layer can be ordered between ordinary deck.gl layers without corrupting either draw;
- picking returns the original node or edge object and stable ID;
- changing view state does not restart the simulation;
- removing the layer releases all adapter-owned GPU and DOM resources; and
- representative benchmarks compare memory use, simulation time, frame time, and interaction
  latency against `D3ForceLayout` and the readback prototype.

Suggested benchmark sizes are 10,000/25,000, 100,000/250,000, and 250,000/1,000,000
nodes/links, subject to available test hardware.

## Testing

The package should include:

- unit tests for stable ID/index mapping, topology updates, bounds, and lifecycle callbacks;
- browser tests for initialization, simulation completion, cleanup, and context loss;
- headless WebGL2 tests for shared-device resource ownership;
- render tests that place ordinary deck.gl layers before and after the graph;
- picking and drag tests that verify original application objects are returned; and
- a browser benchmark example that reports readback and zero-copy modes separately.

Tests that require WebGL extensions should skip with an explicit capability reason, not fail with a
shader or framebuffer error.

## Documentation and release

The first release should be marked experimental. Documentation must include:

- the tested cosmos.gl and luma.gl version matrix;
- WebGL2 and device-extension requirements;
- the difference between snapshot and zero-copy modes;
- limitations for mobile devices, WebGPU, multi-view, and geographic coordinates; and
- guidance for reporting issues to either deck.gl-community or cosmos.gl.

Adding the package also requires an example, sidebar entry, `docs/whats-new.md` entry, and WebGPU
status row.

## Open questions

1. Should the first PR include the readback prototype, or should implementation wait for the
   upstream simulation-only API?
2. Does cosmos.gl want to own the generic simulation API, or should it expose lower-level modules
   for this package to compose?
3. Should zero-copy rendering reuse cosmos.gl draw programs through a host render pass, or should
   deck.gl-specific shaders sample the exported position resource?
4. What luma.gl version range will both projects support for an externally supplied `Device`?
5. Who will maintain the package and coordinate version updates with cosmos.gl?

## Recommendation

Approve the package name and architecture, but do not publish a DOM-overlay implementation as a
deck.gl layer.

Build the Phase 1 readback adapter only if it is useful for validating semantics and benchmarks.
Treat Phase 2 shared-device, externally scheduled, zero-copy operation as the requirement for a
production `CosmosGraphLayer`. Coordinate the upstream improvements before committing to a stable
public API in deck.gl-community.

## References

- [cosmos.gl repository and v3 overview](https://github.com/cosmosgl/graph)
- [cosmos.gl `Graph` implementation](https://github.com/cosmosgl/graph/blob/main/src/index.ts)
- [cosmos.gl configuration and simulation callbacks](https://github.com/cosmosgl/graph/blob/main/src/config.ts)
- [cosmos.gl package dependencies](https://github.com/cosmosgl/graph/blob/main/package.json)
- [deck.gl-community `GraphLayout`](https://github.com/visgl/deck.gl-community/blob/master/modules/graph-layers/src/core/graph-layout.ts)
- [deck.gl-community layout authoring guide](../modules/graph-layers/developer-guide/layouts.md)
