# @deck.gl-community/playground

A private workspace package for embedding a JSON playground in deck.gl applications. It provides a
Monaco-backed editor and template selector using `@deck.gl-community/panels`. `DeckPlayground` adds
schema validation and a persistent deck.gl preview; `Playground` supports custom preview renderers.

The repository example in [`examples/playground`](../../examples/playground) includes a rich starter
set of JSON documents: core deck.gl scatterplots, arcs, GeoJSON, and heatmaps, plus community marker,
global-grid, path-marker, skybox, graph, editable GeoJSON, infovis, horizon-graph, and mixed-layer
scenes. These documents are useful as templates for applications that register their own layer
constructors and host-side resources.

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {
  DeckPlayground,
  PlaygroundDataSourceRegistry,
  ScatterplotLayerSchema
} from '@deck.gl-community/playground';

const dataSources = new PlaygroundDataSourceRegistry();
dataSources.register('points', {data: [{id: 'harbor', position: [-122.4, 37.8]}]});

const playground = new DeckPlayground({
  parentElement: document.querySelector('#app')!,
  registry: {
    layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
  },
  dataSources,
  templates: {
    Points: {
      initialViewState: {longitude: -122.4, latitude: 37.8, zoom: 10},
      controller: true,
      layers: [{
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: {'@@data': 'points'},
        getPosition: '@@=position',
        getRadius: 100,
        getFillColor: [40, 120, 220],
        pickable: true
      }]
    }
  }
});

// Replace rows for every consumer without rewriting their JSON documents.
dataSources.register('points', {data: [{id: 'pier', position: [-122.41, 37.81]}]});
// Restore the latest accepted document's initial camera.
playground.resetView();
// Release this editor and preview; the shared source registry remains available.
playground.finalize();
```

The package does not require React. Install `@deck.gl/core` alongside it and explicitly register each
layer constructor with its matching schema. The five core view classes are available by default.
Valid edits update the existing Deck instance and canvas. Parse and validation failures report
`onError` and retain the last accepted preview.

Sources can be registered before or after a playground mounts, using row bindings or asynchronous
loaders. A registry is independently owned and can serve multiple playgrounds; loaders run once
per registration and source changes refresh each affected preview. Instance-local `bindings`
override registered sources of the same name. Loading retains the last accepted preview; missing
or failed sources report `onError` and recover when the source becomes available.

Sources may supply `getRowId` to give `onSelect` stable application row identities. Selection state,
highlighting, and keyboard interactions belong to the host. See the [API reference](../../docs/modules/playground/api-reference/playground.md)
and the [host bindings example](../../examples/playground/host-bindings.ts).

The package also exports RFC 7946 GeoJSON schemas and inferred TypeScript types. The generated
JSON Schema artifact is available from `@deck.gl-community/playground/geojson-schema.json` for
Monaco and other JSON tooling.

The deck.gl catalog exports concrete layer props schemas, inferred JSON prop types, typed accessors,
and separate view constructor/state schemas. Unknown props fail validation. Import
`deckgl-schema.json` for editor diagnostics, or use `DeckGLDocumentSchema.safeParse` for runtime
validation. Extend built-in props with Zod and `createDeckGLDocumentSchema` for custom layers.
Live JavaScript callbacks and GPU resources are outside this JSON profile; runtime bindings remain
host-owned values separate from the JSON document. The package remains private.
