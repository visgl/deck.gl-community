# `@deck.gl-community/playground`

A customizable document editor, template picker, and preview shell built on
[`@deck.gl-community/panels`](/docs/modules/panels), without React.

```sh
yarn add @deck.gl-community/playground @deck.gl-community/panels @deck.gl/core @deck.gl/json @loaders.gl/core
```

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

## Custom documents and controls

`Playground` accepts an application-owned parser and renderer. JSON remains the default;
use string templates for other formats. For example, this plain-text preview needs no
additional parser or language service:

```ts
import {CustomPanel} from '@deck.gl-community/panels';
import {Playground} from '@deck.gl-community/playground';

const playground = new Playground({
  parentElement,
  language: 'plaintext',
  editorTitle: 'Document',
  examplesTitle: 'Samples',
  sidebarSide: 'right',
  sidebarWidthPx: 360,
  templates: {greeting: 'Hello world'},
  templateMetadata: {greeting: {title: 'Greeting', description: 'A plain-text sample'}},
  panels: [new CustomPanel({
    id: 'help',
    title: 'Help',
    onRenderHTML(root) {
      root.textContent = 'Edit the document to update its preview.';
    }
  })],
  parse: text => text,
  renderer: {
    update(root, value) {
      root.textContent = String(value);
    },
    finalize() {}
  }
});
```

Additional panels appear after the editor and example tabs and are cleaned up when the
playground unmounts. Give each panel a unique ID. Separate `templateMetadata` overrides
embedded card metadata without changing document text. Custom Monaco language identifiers
are passed through; hosts register any additional languages and services. JSON schemas apply
only in JSON mode. `DeckPlayground` always uses JSON but accepts the presentation options.

## Asynchronous application preview

Use the persistent `renderer` contract when a custom preview must load resources before accepting
an edit. Template identity is supplied independently of the document contents, so even identical
documents can resolve resources against different source URLs:

```ts
const templateUrls: Record<string, string> = {
  first: new URL('/documents/first/config.json', location.href).href,
  second: new URL('/documents/second/config.json', location.href).href
};

const playground = new Playground({
  parentElement,
  templates: {first: {color: 'blue'}, second: {color: 'green'}},
  onTemplateChange(name) {
    // Synchronize external selection UI here; this also runs during construction.
    selectedTemplateLabel.textContent = name;
  },
  onStatusChange(status) {
    statusLabel.textContent = status;
  },
  onError(error) {
    statusLabel.textContent = error.message;
  },
  renderer: {
    async update(root, value, _text, context) {
      if (!context) throw new Error('This renderer requires a playground context');
      const assetUrl = new URL('./preview.json', templateUrls[context.templateId]);
      const response = await fetch(assetUrl, {signal: context.signal});
      if (!response.ok) throw new Error(`Unable to load preview (${response.status})`);
      const asset = await response.json();
      // Prepare first, then commit only if this revision is still active.
      const text = JSON.stringify({document: value, asset}, null, 2);
      context.signal.throwIfAborted();
      root.textContent = text;
    },
    finalize() {
      // Release application-owned preview resources, if any.
    }
  }
});
```

New edits, selections, and disposal abort previous work. Obsolete completions and rejections do
not update status or call `onChange`/`onError`; current failures leave the editor usable. Keep the
last successful preview until preparation succeeds. An engine that mutates shared resources during
loading must implement its own serialized update or rollback policy. The host retains control of
fetching, document URLs, parsing, and renderer-specific behavior.

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
policies, and result-size limits outside the visualization package while allowing the playground
to cancel obsolete queries through the provider's `AbortSignal`. Query sources use the same
lifecycle, deferred loading, row picking, and WebMCP source permissions as ordinary host bindings.
The package does not include DuckDB or any other SQL engine.

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
