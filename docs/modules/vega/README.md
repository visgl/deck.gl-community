import MapToStacksExample from '@site/src/examples/vega/map-to-stacks';
import GeospatialExample from '@site/src/examples/vega/geospatial';
import MarkTransitionsExample from '@site/src/examples/vega/mark-transitions';
import {App as VegaExample} from '../../../examples/vega/unit-layouts/src/example';

# Vega renderer (private experiment)

This private module ports Microsoft's MIT-licensed SandDance Vega renderer to deck.gl 9.4. Vega JSON creates a scene graph that the renderer turns into deck.gl layers, including animated cuboids.

<div className="card vega-feature-card" style={{margin: '1.5rem 0', border: '1px solid var(--ifm-color-emphasis-300)'}}>
<div className="card__header"><h2 id="supported-vega-features" style={{margin: 0, fontSize: '1.25rem', scrollMarginTop: 'calc(var(--ifm-navbar-height) + 1rem)'}}>Supported Vega features</h2></div>
<div className="card__body">

Vega evaluates data, transforms, scales, expressions and encodings on the CPU. This renderer stages the resulting scene graph into deck.gl layers; WebGL2 draws the marks and animates supported attributes on the GPU.

| Feature | Support and implementation notes |
| --- | --- |
| Data, scales and transforms | Use the native Vega runtime. Rendering depends on the resulting mark type being supported; this module does not compile Vega-Lite. |
| Signals and bound controls | Native Vega `bind` inputs update the existing View. Playground JSON edits create a fresh View, so transitions apply to signal updates rather than specification replacement. |
| Rectangles and 3D cuboids | A custom instanced `CubeLayer` renders `rect` marks. Optional `z` and `depth` encodings extend them into 3D, with an orbit camera. |
| Circle and square symbols | One instanced quad per record preserves area-based size, opacity and pixel-width outlines. A custom `ScatterplotLayer` shader morphs between circles and squares; other symbol shapes are unsupported. |
| Lines, rules and areas | Straight line segments use `LineLayer`/`PathLayer`; areas use `PolygonLayer`. Vega curve interpolation is not reproduced by these stagers. |
| Text, axes, legends and groups | Text uses `TextLayer`; axis lines and labels are staged separately, and legends use HTML. Groups accumulate positional offsets and facet outlines; group clipping is unsupported. |
| Geographic shapes and points | Vega `geoshape` projects, clips and resamples GeoJSON on the CPU. Ordered polygon/path batches render holes, islands, routes and graticules. `geopoint` places symbols on the same chart; basemap synchronization is not implemented. |
| Animated records | GPU attribute transitions animate cuboid and symbol position, size and color, plus symbol shape, rotation and outlines. Stable slots support filtering, reordering, interrupted exits and reentry. Historical record slots remain until finalization. Projected polygon/path vertices also interpolate on the GPU. |
| Picking and hover tooltips | deck.gl GPU picking identifies marks. Evaluated `tooltip` encodings on rects, symbols and projected shapes display as plain-text HTML overlays. |

**Rendering limits:** This is a private, unpublished Vega renderer subset. Arbitrary SVG paths, image/arc marks, exact mixed-mark paint order and WebGPU rendering are not implemented. Geographic shape batches preserve their own paint order.

</div>
</div>

## Attribution and upstream project

This module builds on [SandDance](https://github.com/microsoft/SandDance), created by
[Microsoft Research's Visualization and Interactive Data Analysis (VIDA) group](https://www.microsoft.com/en-us/research/project/sanddance/).
The Vega-to-deck.gl renderer, scene staging, cuboid rendering, and animated unit-visualization
approach come from that upstream work; this community experiment adapts them to current vis.gl APIs.

Special thanks to **[Dan Marshall](https://github.com/danmarshall)** for his engineering work on
SandDance and its open-source visualization components. See his Microsoft Research project update,
[What's new in SandDance 3](https://opensource.microsoft.com/blog/2020/06/23/whats-new-sanddance-3-microsoft-research/).
We also credit **Steven Drucker and Roland Fernandez** for the foundational animated unit-visualization
research, and **Deokgun Park and Niklas Elmqvist**, with Drucker and Fernandez, for the ATOM grammar research.
See the [SandDance project website and publications](https://microsoft.github.io/SandDance/).

- [SandDance source repository](https://github.com/microsoft/SandDance)
- [Original Vega/deck.gl renderer at the imported revision](https://github.com/microsoft/SandDance/tree/5f2c1e58467b9417bd626f0ef404bd3bda11f068/packages/vega-deck.gl)
- [Upstream MIT license](https://github.com/microsoft/SandDance/blob/5f2c1e58467b9417bd626f0ef404bd3bda11f068/LICENSE)

Microsoft Corporation's MIT license and original source copyright notices are retained.
The cube-layer shader code also retains the MIT notice crediting Uber Technologies.
This is an independent deck.gl-community experiment; it is not an official Microsoft or SandDance release.

## Animated record layouts

Each cube below represents one of 180 records. Switch between **Grid**, **Scatter**, and **Grouped stacks** to see the same records move and resize. Enable **3D view** to orbit the extruded cubes. Position and size transitions take 1.2 seconds.

<VegaExample />

The shared `examples/vega/specs/unit-layouts.json` document declares its records, layouts, depth, and controls. Native Vega signal bindings change `layout` and `is3d` on the existing `ViewGl`; the host adapter maps Vega tuple identities to stable dense cube ordinals per mark. Keeping the view alive lets deck.gl interpolate attributes between layouts. Configure animation with `presenterConfig.transitionDurations` (`position`, `size`, `color`, and `view`, in milliseconds).

This demonstrates the renderer's transitions rather than the full SandDance application: chart recommendation, filtering, selection UI, and the SandDance specification builder are outside this initial port. The module requires WebGL2 and is private and unpublished.

## US map to stacked bars

<div style={{height: 520, position: 'relative'}}><MapToStacksExample /></div>

Choose **US map**, **Stacked bars**, or **3D geographic stacks** to move the same **24,669 places** from Microsoft Research SandDance's historical `demovote` sample between their geographic locations and four regional bars, stacked by education percentage. Seven quantile bins distribute places across the blue-to-neutral-to-warm palette; the color key displays the actual education ranges. The dense unit map retains each place's color and identity throughout the transition. Hover a tile for its place, state, region and education percentage. Camera tilt, orbit and zoom animate over the same 1.2-second duration as the tiles. The third view bins projected locations into a geographic grid and stacks individual places vertically; it also animates the camera into 3D. Each tile is one place, not a population-weighted unit; the sample is not a current demographic estimate.

The [original SandDance example](https://microsoft.github.io/SandDance/tests/v4/umd/scatterplotTest.html) and [sample data](https://github.com/microsoft/SandDance/blob/5f2c1e58467b9417bd626f0ef404bd3bda11f068/docs/sample-data/demovote.tsv) are credited to Microsoft Research and the SandDance developers, including Dan Marshall, Steven Drucker and Roland Fernandez. Microsoft's MIT notice is retained alongside our example.

Inspired by Microsoft Research [SandDance](https://github.com/microsoft/SandDance) and its animated unit visualizations, the shared `examples/vega/map-to-stacks/spec.json` declares all data, an Albers projection fitted above the label band, the `geopoint` transform, per-region ranking, colors, labels, tooltip encodings and the bound `layout` signal. No JavaScript layout switch or animation loop is needed. The same JSON is editable in the Vega playground and available in the example gallery. Vega width signals and native `container:resize` events adapt the projection, bars and labels when the container changes size, including playground sidebar toggles. Run it locally with `yarn workspace @deck.gl-community-examples/vega-map-to-stacks start`.

Vega calculates projected place coordinates and stacked-bar targets on the CPU. The shared host keeps one View alive and assigns stable tuple slots; the custom instanced `CubeLayer` interpolates tile positions and sizes on the GPU over 1.2 seconds, including interrupted transitions back to the map. Camera target, tilt, orbit and zoom interpolate through a retained deck.gl OrbitController on the CPU; lighting uniforms interpolate separately. Tile attributes interpolate on the GPU. The regional labels appear with the bar layout. This moves individual records, rather than morphing state boundaries into rectangles.

## Edit Vega JSON in the playground

Open the [playground](/playground) and select **Vega**. Choose **Unit layouts**, **US map to stacked bars**, **Bar chart**, **Symbols and record transitions**, or **Geospatial projections and symbols**,
then edit the JSON directly. The docs and playground share the same unit-layout specification.
Vega signal `bind` declarations create the controls; the host supplies the deck.gl renderer and
transition durations. An optional `is3d` signal selects the 3D camera.

JSON and Vega parse/run errors appear in the tab and retain the last valid chart. Each accepted
specification edit creates a fresh View; signal controls animate on the existing View. Switching
away from the Vega tab releases its GPU preview and retains the edited document for returning.
The Vega preview is separate from deck JSON and uploaded data sources.

The same example runs locally with `yarn vite modules/vega/demo --host 127.0.0.1 --port 5199`. See `modules/vega/README.md` for the API and `modules/vega/UPSTREAM.md` for source attribution.

## Symbols and record transitions

<div style={{height: 520, position: 'relative'}}><MarkTransitionsExample /></div>

Circles and squares share an instanced `ScatterplotLayer` extension with pixel-width outlines. Both preserve
Vega's area-based `size`, fill/stroke opacity, translated group coordinates, and source `datum`
for deck.gl picking. Other symbol shapes report an error. Arbitrary SVG paths, group clipping, and exact mixed-mark draw ordering remain follow-up work.

Cuboid ordinals retain their slots through reordering. Removed records become complete zero-size,
transparent placeholders at their last positions; GPU size and color transitions animate exits.
New slots start with zero size. Restored IDs grow from their existing slots. An interrupted update
continues from deck.gl's current interpolated attributes.

The default ordinal assignment preserves surviving Vega scene-item identities, including multiple
rectangle marks sharing tuples. Use `onSceneRectAssignCubeOrdinal` with **unique, dense,
non-negative integer ordinals** to preserve identity across filtering and replacement of scene
items. Duplicate or invalid explicit ordinals report errors. Direct Stage inputs without ordinals use their array indices. Slots are retained until View finalization;
long-running streams with continually new IDs should periodically recreate the View.

The **Symbols and record transitions** JSON example is shared with the Vega playground.
Cuboids, circles, and squares now use GPU transitions for record updates and entry/exit.

## Geospatial projections and symbol animation

<div style={{height: 520, position: 'relative'}}><GeospatialExample /></div>

The shared `examples/vega/geospatial/spec.json` declares synthetic GeoJSON regions, a lake hole, separate islands, a route, a geographic graticule, and geographic point symbols. Choose it in the Vega playground to edit the document. `geoshape` uses Vega projection, resampling and geographic clipping; `geopoint` positions circle or square symbols on the same projected chart. Projection coordinates use the chart camera rather than a synchronized map basemap.

Circle and square symbols retain GPU attribute slots by mark and Vega tuple identity. Position, size, fill/stroke color and outline width interpolate on the GPU; filtering shrinks and fades exits at their last positions. Circle/square changes morph the same GPU glyph, keeping its position and identity continuous. Vega computes projection targets on the CPU; deck.gl interpolates polygon and path vertices on the GPU using `transitionDurations.position`. Geographic colors and outline widths use the `color` and `size` durations. Historical symbol slots remain allocated until view finalization; recreate views periodically for unbounded streams.

### Hover tooltips

Use Vega’s `tooltip` encoding on rect, symbol or projected shape marks, for example `"tooltip": {"signal": "{Name: datum.properties.name}"}`. Hovering displays evaluated strings or object fields as plain text. Omitted, null and false values suppress the tooltip. The unit layout, bar chart, geospatial and symbol transition examples declare tooltips in their shared JSON specs.

### Geographic transition behavior

Changing the projection or its parameters animates projected polygon and path vertices, alongside point symbols, with native deck.gl GPU attribute transitions. Setting `presenterConfig.transitionDurations.position` to zero makes geometry updates immediate. Geographic fills/strokes and outline widths also animate with the configured `color` and `size` durations.

Vega still computes projection, resampling and clipping on the CPU. Vertex interpolation follows each staged geometry's vertex order; it is not interpolation between cartographic projection functions. Clipping can add or remove shapes and change ring topology, so those changes do not have the same stable record correspondence as symbols. Exact topology-aware projection morphing remains a follow-up.

## Next renderer tranches

- **Topology-aware projection morphing:** match rings and resampled vertices across projections, with explicit entry/exit behavior for clipped geometry.
- **Curves and stroke semantics:** render Vega line/area interpolation modes, line caps and joins.
- **Group clipping and mixed-mark paint order:** preserve scene traversal order and clip child layers to group bounds.
- **Broader marks and text fidelity:** add arc/image marks and extend font and text layout support.
