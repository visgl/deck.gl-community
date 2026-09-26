# `@deck.gl-community/playground`

A JSON editor, template picker, and live deck.gl preview built on
[`@deck.gl-community/panels`](/docs/modules/panels), without React. This package is unpublished;
use it from this repository as a workspace.

## Usage

Import the layer constructors you need and register them explicitly. Bundled official and community
schemas are matched by each constructor's `layerName`; the library imports no layer implementations.
Then register rows independently and connect them to a `DeckPlayground`:

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {DeckPlayground, PlaygroundDataSourceManager} from '@deck.gl-community/playground';

const dataSources = new PlaygroundDataSourceManager();
dataSources.add({
  dataSourceId: 'points',
  dataSource: {data: [{id: 'pier', position: [-122.4, 37.8]}]}
});

const playground = new DeckPlayground({
  parentElement: document.getElementById('playground')!,
  registry: {
    layers: {ScatterplotLayer}
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

## SQL-backed examples

The playground is an engine-neutral view over host-owned data. Supply a query provider when the
host uses DuckDB-WASM, Mosaic, a server-side SQL service, or another query engine, then describe
named SQL sources in the JSON document:

```ts
const dataSources = new PlaygroundDataSourceManager({
  queryProvider: {
    async execute({sql, parameters}) {
      const table = await appDatabase.query(sql, parameters);
      return {data: table.toArray(), getRowId: row => row.id};
    }
  }
});
```

```json
{
  "sources": {
    "cities": {"@@sql": "SELECT longitude, latitude, population FROM cities"}
  },
  "layers": [{
    "@@type": "ScatterplotLayer",
    "id": "cities",
    "data": {"@@data": "cities"},
    "getPosition": "@@=[longitude, latitude]",
    "getRadius": "@@=population / 100"
  }]
}
```

SQL is executed by the host, not by the playground. This keeps database credentials, read-only
policies, cancellation, and result-size limits outside the visualization package. Query sources
use the same lifecycle, deferred loading, row picking, and WebMCP source permissions as ordinary
host bindings. The package does not include DuckDB or any other SQL engine.

Accepted edits reuse the preview; invalid edits retain the last accepted document. Sources can
load asynchronously and serve multiple playgrounds. Use `Playground` for a custom renderer.
Configuration props follow the [deck.gl JSON syntax](https://deck.gl/docs/api-reference/json/conversion-reference),
including array and conditional accessor expressions. Inline rows and bound rows remain unchanged.
Use registered constants for live resources, such as `data: '@@#table'` for a host-owned Arrow table.

The website's [standalone playground](/playground) and [gallery](/examples/playground) register all
79 concrete official and community layers. Library consumers select their own constructor set;
custom schemas and aliases use explicit `{type, schema}` registrations.

The [API reference](./api-reference/playground.md) covers registration, picking, camera control,
and standalone schemas. The
[host bindings example](https://github.com/visgl/deck.gl-community/blob/master/examples/playground/host-bindings.ts)
shows shared sources, row updates, picking, and cleanup.
