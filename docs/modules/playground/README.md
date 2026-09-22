# `@deck.gl-community/playground`

A JSON editor, template picker, and live deck.gl preview built on
[`@deck.gl-community/panels`](/docs/modules/panels), without React. This package is private;
use it from this repository as a workspace.

## Usage

Register rows independently, then connect them to a `DeckPlayground`:

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {
  DeckPlayground,
  PlaygroundDataSourceManager,
  ScatterplotLayerSchema
} from '@deck.gl-community/playground';

const dataSources = new PlaygroundDataSourceManager();
dataSources.add({
  dataSourceId: 'points',
  dataSource: {data: [{id: 'pier', position: [-122.4, 37.8]}]}
});

const playground = new DeckPlayground({
  parentElement: document.getElementById('playground')!,
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
        getFillColor: [40, 120, 220]
      }]
    }
  },
  onError(error) {
    console.error(error.message);
  }
});

// Refresh all consumers while preserving their cameras.
dataSources.add({
  dataSourceId: 'points',
  dataSource: {data: [{id: 'harbor', position: [-122.41, 37.81]}]}
});

// Release this playground. Shared sources remain registered.
playground.finalize();
// Release the manager when all consumers are finished.
await dataSources.finalize();
```

Accepted edits reuse the preview; invalid edits retain the last accepted document. Sources can
load asynchronously and serve multiple playgrounds. Use `Playground` for a custom renderer.
Configuration props follow the [deck.gl JSON syntax](https://deck.gl/docs/api-reference/json/conversion-reference),
including array and conditional accessor expressions. Inline rows and bound rows remain unchanged.

The [API reference](./api-reference/playground.md) covers registration, picking, camera control,
and standalone schemas. The
[host bindings example](https://github.com/visgl/deck.gl-community/blob/master/examples/playground/host-bindings.ts)
shows shared sources, row updates, picking, and cleanup.
