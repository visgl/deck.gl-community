# @deck.gl-community/playground

An installable (but currently private) JSON playground surface for deck.gl applications. It provides a
Monaco-backed editor and template selector using `@deck.gl-community/panels`,
and leaves preview rendering to the host application.

The repository example in [`examples/playground`](../../examples/playground) includes a rich starter
set of JSON documents: core deck.gl scatterplots, arcs, GeoJSON, and heatmaps, plus community marker,
global-grid, path-marker, infovis, horizon-graph, and mixed-layer scenes. These documents are useful
as templates for applications that register their own layer constructors.

```ts
import {Playground} from '@deck.gl-community/playground';

const playground = new Playground({
  parentElement: document.querySelector('#app')!,
  templates: {scatterplot: {layers: []}},
  render: (element, value) => {
    // Create or update a Deck instance in element using value.
  }
});
```

The package does not require React. Install `@deck.gl/core` alongside it when
the preview is rendered with deck.gl.

The package also exports RFC 7946 GeoJSON schemas and inferred TypeScript types. The generated
JSON Schema artifact is available from `@deck.gl-community/playground/geojson-schema.json` for
Monaco and other JSON tooling.

The deck.gl catalog exports concrete layer props schemas, inferred JSON prop types, typed accessors,
and separate view constructor/state schemas. Unknown props fail validation. Import
`deckgl-schema.json` for editor diagnostics, or use `DeckGLDocumentSchema.safeParse` for runtime
validation. Extend built-in props with Zod and `createDeckGLDocumentSchema` for custom layers.
Live JavaScript callbacks and GPU resources are outside this JSON profile. The package remains private.
