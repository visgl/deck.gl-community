# deck.gl Community Playground

This directory contains a standalone app and a community gallery example built with
`@deck.gl-community/playground`. Every template is a JSON deck document. Accessors use the
deck.gl JSON convention, for example `"getPosition": "@@=position"`.

Open the [standalone playground](https://visgl.github.io/deck.gl-community/playground) for a
full-screen editor and preview with five core templates: `imported-points`, `scatterplot`, `arcs`,
`geojson`, and `heatmap`. Browser tools can inspect and replace the page-local `points` source
with JSON row arrays or base64 Arrow IPC; the imported-points template expects `position: [x, y]`.
Imported rows last only for the current page session.

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

The separate [gallery example](https://visgl.github.io/deck.gl-community/examples/playground),
mounted by `app.ts`, includes core deck.gl layers and community layers from
`@deck.gl-community/geo-layers`, `graph-layers`, `infovis-layers`, `layers`, `timeline-layers`, and
`editable-layers`. It registers those constructors, layouts, and edit modes in its host application.
