# Private Vega renderer

`@deck.gl-community/vega` is an experimental port of Microsoft's SandDance
`@msrvida/vega-deck.gl` renderer to deck.gl 9.4 and luma.gl 9.4. This workspace
is **private and must not be published**. Its package entry point is ESM-only,
matching Vega 6's asynchronous ES module dependency graph. It is a renderer port, not the full
SandDance Explorer application or its chart-specification generator.

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

```ts
import {parse} from 'vega';
import {ViewGl} from '@deck.gl-community/vega';

const view = new ViewGl(parse(spec));
view.renderer('deck.gl').initialize(document.getElementById('chart'));
await view.runAsync();
// Releases the Vega view and the owned deck.gl renderer.
view.finalize();
```

The host needs an explicit width and height. ES module dependencies load
automatically; the old four-library `use(vega, deck, layers, luma)` initialization
is replaced with optional `use(vegaRuntime)`.

The imported mark stagers handle groups, rectangles, rules, text, lines, areas,
axes, and legends. Circle and square symbols add area-based sizing, opacity,
pixel-width strokes, and source-data picking; other shapes report errors. Rectangle `z` and `depth` encodings extend the layout to 3D;
pass `{getView: () => '3d'}` as the second `ViewGl` constructor argument.
Cuboid slots stay stable through reordering and partial presentations. Removed
records shrink and fade at their latest positions. To preserve identity across
replacement of Vega scene items, provide a unique dense
`onSceneRectAssignCubeOrdinal` callback. Slots remain allocated until finalization.

This is a subset of Vega rendering, not a complete Vega or Vega-Lite renderer.
The custom cuboid shader currently requires WebGL2; WebGPU rendering is not
implemented in this module.

## Development

Run from the repository root:

```sh
yarn
yarn tsc --noEmit -p modules/vega/tsconfig.json
yarn test --run modules/vega/test/scene-staging.spec.ts
yarn vitest run --project headless modules/vega/test/renderer.browser.spec.ts
yarn vite modules/vega/demo
```

The demo imports source directly. See [UPSTREAM.md](UPSTREAM.md) for provenance
and licensing. The package has `private: true` and a failing `prepublishOnly`
guard; it has no public publish configuration.

### Geospatial shapes and symbol transitions

Vega `shape` marks with `geoshape` generators render projected GeoJSON polygons (including holes and MultiPolygons), lines and points. Use `geopoint` for geographic circle/square symbols. Vega handles projection resampling and geographic clipping. Projected polygon/path batches retain Vega shape paint order, keeping routes over regions and background graticules underneath. These are chart coordinates in the existing camera, without basemap synchronization. Arbitrary SVG shape paths remain unsupported.

Circle/square shape, position, size, rotation, color and outline width use GPU attribute transitions and stable per-mark tuple slots, including filtering, reordering and reentry. Both shapes share one instanced quad per record; circle/square changes morph that glyph without hidden counterparts. Historical slots are released at finalization; recreate long-running streaming views periodically. Configure durations with `presenterConfig.transitionDurations`. The declarative geospatial example is shared by the playground and docs.

Direct Stage inputs may declare `symbolData` entries with `shape: 'circle' | 'square'` and Cartesian-radian `angle`. Legacy `polygonData` square inputs still normalize into the same glyph slots. Geographic replacements through `rePresent()` retain the interleaved paint order for matching entries; additions/removals require an explicit `geographicData` list.

### Hover tooltips

Use Vega’s `tooltip` encoding on rect, symbol or projected shape marks, for example `"tooltip": {"signal": "{Name: datum.properties.name}"}`. Hovering displays evaluated strings or object fields as plain text. Omitted, null and false values suppress the tooltip. The unit layout, bar chart, geospatial and symbol transition examples declare tooltips in their shared JSON specs.
