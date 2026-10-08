# deck.gl Community Playground

This directory contains a standalone app and a community gallery example built with
`@deck.gl-community/playground`. Every template is a JSON deck document. Accessors use the
deck.gl JSON convention, for example `"getPosition": "@@=position"`.

Each gallery document includes a top-level `name` and `description`. Changing `name` resets the
entire preview, including renderer props, camera, layers, and the selected basemap. This allows
different examples to reuse layer IDs safely. Edits with the same name reuse the current preview;
`description` is informational. The picker displays these fields as the card title and description.

The **Radial graph layout** template passes inline graph records directly to `GraphLayer.data`
and creates the package layout with `"layout": {"@@function": "RadialLayout", "radius": 160,
"tree": [...]}`. Each resolution creates its own layout; no graph engine is required.

Camera edits in `initialViewState` apply immediately after validation, including `pitch` and
`bearing`. Shift-drag on the preview tilts and rotates the map. Ordinary layer edits keep the
current interactive camera when the document's camera values are unchanged.

The Editable GeoJSON example includes the existing `EditModeTrayWidget`: select a feature, then
choose **Edit** for vertices or **Move** for transformations; **Point**, **Line**, and **Area** draw
new features. Double-click finishes lines and polygons. `editable-controls.ts` registers the widget
and callbacks as constants, writes feature selection and edits back to the JSON, and keeps the
active mode button synchronized with JSON changes. Invalid JSON drafts suspend these updates
until a valid document is accepted.

Open the [standalone playground](https://visgl.github.io/deck.gl-community/playground) for a
full-screen editor and preview. It shares the gallery's templates and constructor registry: all
35 concrete official deck.gl layers and 45 public community layers. The graph package's `GridLayer`
is named `GraphGridLayer` to distinguish it from deck.gl's aggregation layer. Abstract base classes
are excluded. Layers that require live resources, such as GeoArrow tables, also need host-provided
constants; registering a constructor does not create those resources.

Browser tools expose five templates: `imported-points`, `scatterplot`, `arcs`, `geojson`, and
`heatmap`. They can inspect and replace the page-local `points` source with JSON row arrays or
base64 Arrow IPC; the imported-points template expects `position: [x, y]`. Arrow imports become
rows, not native GeoArrow tables. Imported rows last only for the current page session.

Tools register automatically when WebMCP is available. The toolbar shows their status and offers
**Disable tools** and **Enable tools**; disabling or re-enabling tools preserves imported rows.
Browsers without WebMCP still support the editor and preview.

Run the standalone app from this directory:

```bash
yarn
yarn start
```

To run against the local workspace packages, use `yarn start-local` from this directory after
installing dependencies. `index.ts` mounts the app from `standalone.ts`.

The [gallery example](https://visgl.github.io/deck.gl-community/examples/playground), mounted by
`app.ts`, uses the same managed renderer and `registry.ts` as the standalone app. The website owns
these constructor imports. The playground library bundles schemas and enables only constructors
explicitly supplied in `registry.layers`.
