# Playground

`DeckPlayground` combines a template selector, JSON editor, and persistent deck.gl preview.
`Playground` uses an application-owned renderer. See the [usage guide](../README.md) for setup.

## `DeckPlayground` {/* #deckplayground */}

Accepts `parentElement`, `templates`, and `initialTemplate`, plus:

- `registry`: layer and view constructors with matching schemas, as described below.
- `dataSources`: optional `PlaygroundDataSourceManagerLike` shared with other consumers.
- `bindings`: optional local row bindings that override sources of the same name.
- `onChange(value, text)`: runs once an edit is accepted, after loading any required sources,
  with the original edited value and text. Source updates alone do not emit changes.
- `onError(error)`: observes parsing, configuration, source, and rendering failures.
- `onSelect(selection)`: observes bound-row picks or `null`.
- `onViewStateChange(params)`: observes camera changes; return values are ignored.
- `onLoad()`: observes Deck initialization, before asynchronous layers necessarily finish loading.

The package is suitable for embedding in an agent chat: the host owns the database and the
playground owns the editor, preview, source subscriptions, and selection lifecycle. SQL execution
is deliberately supplied through a host adapter rather than bundled into this package.

Initial callbacks may run during construction. Invalid edits retain the last accepted preview;
errors occurring later during rendering may leave a frame incomplete.

### Constructor registry

`registry.layers` maps each JSON `@@type` to a layer constructor or an explicit `{type, schema}`
registration. Only registered layers are available. Constructor shorthand such as
`layers: {ScatterplotLayer}` matches the constructor's static `layerName` to a bundled official or
community schema. The registry key must match the schema's `@@type` discriminator.

Use `{type, schema}` for custom layers, schema extensions, or aliases. For example,
`GraphGridLayer: {type: GridLayer, schema: GraphGridLayerSchema}` registers the graph package's grid
without colliding with deck.gl's aggregation `GridLayer`. Schemas are bundled independently of
constructors; importing the playground does not enable or import the full layer catalog.

The five core views (`MapView`, `OrthographicView`, `OrbitView`, `FirstPersonView`, and `_GlobeView`)
are available by default. `registry.views` adds constructors with matching schemas; custom views
currently use the built-in camera-state schemas.

Configuration conversion uses `JSONConverter` from `@deck.gl/json` and its
[standard JSON syntax](https://deck.gl/docs/api-reference/json/conversion-reference):

- `registry.constants` supplies exact named values for `"@@#name"`.
- `registry.enumerations` supplies named value maps; for example,
  `{palette: {fill: [40, 120, 220]}}` resolves `"@@#palette.fill"`.
- `registry.functions` supplies exact named factories for
  `{"@@function": "name", ...options}` descriptors.

`@@=` expressions support property paths, arrays, arithmetic, conditionals, and numeric literals,
such as `"@@=position"`, `"@@=[longitude, latitude]"`, `"@@=weight > 10 ? 8 : 4"`, and `"@@=5"`.
Function calls are not supported inside expressions. Supply nested resources through constants
rather than nested `@@type` descriptors.

Registered schemas drive validation and Monaco diagnostics. The runtime also rejects unavailable
references, duplicate layer IDs, `mapStyle` (no basemap adapter), and empty `views` arrays.
Omit `views` to use the default map view. Inline rows and external bindings bypass conversion:
their values remain opaque and preserve row identity, including strings beginning with `@@`.
A layer's `data: '@@#table'` instead resolves a registered host resource by reference, allowing
native Arrow tables and other layer-specific data objects. This form does not subscribe to a source
manager or provide bound-row selection.

### Local bindings

`setBindings(bindings): boolean` replaces the local binding map and retries the pending validated
or accepted document without changing editor text. It returns `true` on success; otherwise it
retains the previous bindings and preview. Loading sources return `false` silently; other failures
report `onError`. Pass `{}` to restore source-manager lookup.

### Picking

For pickable layers using `data: {'@@data': 'points'}`, `onSelect` receives
`{bindingId, layerId, rowId, index, object}`. The binding ID is the source name, the layer ID is the
registered layer (including composite parents), and `object` is the original row at `index`.
`getRowId(row, index)` supplies stable identity; otherwise `rowId` is the index and may change
when rows are reordered or filtered.

Picks must identify an original row in the accepted preview. Empty picks, inline content,
transformed objects without a matching row, and stale shared sources report `null`. Local overrides
are unaffected by shared-source changes. The host owns selection state and highlighting.

### Camera and lifecycle

Accepted edits and source updates reuse the Deck instance and preserve its camera. Keep layer IDs
stable to allow layer-state reuse. Editing `initialViewState` updates the target for `resetView()`;
changing view types or IDs resets the camera. An explicit `viewState` remains authoritative.
Interactivity defaults to enabled, preserving explicit per-view controller settings.

`resetView(): void` restores the accepted document's `initialViewState`, defaulting to longitude 0,
latitude 0, and zoom 0. `finalize()` releases the editor, preview, and source subscriptions;
shared sources remain registered.

## `PlaygroundDataSourceManager`

Register sources independently and pass the manager as `dataSources`. JSON layers reference them
with `data: {'@@data': 'points'}`. The preview accepts a `PlaygroundDataBinding`
(`{data: rows, getRowId?}`), a promise of that binding, or `null` while unavailable:

```ts
const dataSources = new PlaygroundDataSourceManager();
const points = fetch('/points.json').then(async response => {
  if (!response.ok) throw new Error(`Could not load points (${response.status})`);
  return {data: await response.json(), getRowId: (row: {id: string}) => row.id};
});
dataSources.add({dataSourceId: 'points', dataSource: points});
```

- `add({dataSourceId, dataSource, forceUpdate?})`: registers or replaces an owned source. Use
  `forceUpdate: true` to notify consumers when passing the same object again.
- `contains(id)`: checks registration; names prefixed with `datasource://` also support deferred sources.
- `subscribe({dataSourceId, consumerId, requestId?, onChange})`: returns the current source,
  promise, placeholder, or `undefined`; `onChange(source)` receives replacements.
  The default request ID is `'default'`.
- `unsubscribe({consumerId})`: detaches all requests for a consumer without releasing sources.
- `listDataSources()`: returns entries with `dataSourceId`, `status`
  (`'ready' | 'pending' | 'placeholder' | 'error'`), and optional `error`.
- `remove(id): Promise<void>`: releases a source and silently removes its subscriptions permanently.
- `finalize(): Promise<void>`: releases all sources and subscriptions.

Playgrounds subscribe through `datasource://` placeholders, so sources may be added after mounting.
Use a null placeholder for temporary unavailability; unlike `remove`, this preserves subscriptions:

```ts
dataSources.add({dataSourceId: 'points', dataSource: null});
dataSources.add({dataSourceId: 'points', dataSource: {data: nextRows}});
```

Referenced source updates refresh the current or pending document. Pending promises retain the
last accepted preview without an error; failures report `onError`. Supply new row arrays when
contents change. Producers own request cancellation. The manager owns source handles and invokes
their `close`, `finalize`, or `destroy` hook when released; playground cleanup only unsubscribes.

This local class implements a narrow loaders.gl v5 manager subset without adding a dependency.
The structural `PlaygroundDataSourceManagerLike` interface allows compatible upstream managers
to be substituted later. Arbitrary `TableScanSource` handles still need an adapter that materializes
rows into `PlaygroundDataBinding`.

### SQL query sources

Construct the manager with a `PlaygroundQueryProvider` when the host can execute SQL:

```ts
const dataSources = new PlaygroundDataSourceManager({
  queryProvider: {
    async execute({sql, parameters}, {signal} = {}) {
      return {
        data: await database.queryRows(sql, parameters, signal),
        getRowId: row => row.id
      };
    }
  }
});
```

The provider receives `{sql, parameters?}` and returns `{data, getRowId?}`. It may be backed by
DuckDB-WASM, Mosaic, a remote SQL endpoint, or another engine. The optional `AbortSignal` is
aborted when a query is replaced, removed, or finalized. The playground does not parse, authorize,
or execute SQL and therefore does not require the engine as a dependency.

Documents can register named query sources. Layers continue to reference them through the normal
`@@data` binding, which means the same source can be shared by several layers:

```json
{
  "sources": {
    "trips": {
      "@@sql": "SELECT origin, destination, count(*) AS trips FROM rides GROUP BY 1, 2"
    }
  },
  "layers": [{
    "@@type": "ArcLayer",
    "id": "trips",
    "data": {"@@data": "trips"},
    "getSourcePosition": "@@=origin",
    "getTargetPosition": "@@=destination",
    "getWidth": "@@=trips"
  }]
}
```

`sources` are registered only after synchronous document validation succeeds. Until the provider resolves a query, the
preview retains its last accepted frame and reports a loading state through the normal source
lifecycle. Query failures use the same error path as failed external sources. Reusing the same
query descriptor does not re-run the query; changing SQL or parameters replaces the source and
refreshes subscribed layers.

For agent integrations, keep query execution host-controlled and read-only by default. Apply
authorization, statement restrictions, cancellation, and row/byte limits in the provider. Do not
expose arbitrary SQL execution to WebMCP unless the surrounding application explicitly grants
that capability and understands the database effects.

## `Playground` {/* #playground */}

### `PlaygroundProps` {/* #playgroundprops */}

- `parentElement`: host element for the editor and preview.
- `templates`: named JSON objects or text documents. Object templates may include `metadata` with
  `title`, `description`, and `screencap` for the picker; it is omitted from the editor document.
- `initialTemplate`: initial template name; defaults to the first template.
- `jsonSchema`: optional JSON Schema for Monaco diagnostics and completion.
- `parse`: parser; defaults to `JSON.parse`.
- `onChange(value, text)`: observes valid edits.
- `onError(error)`: observes parsing or synchronous rendering failures.
- `render(previewElement, value)`: renders valid documents and optionally returns cleanup. The
  previous cleanup runs and the preview is cleared before each render.
- `renderer`: persistent renderer with `update(previewElement, value, text?): void` and
  `finalize(): void`. Use this or `render`, not both.

```ts
const playground = new Playground({
  parentElement,
  templates,
  renderer: {
    update(previewElement, value) {
      // Create or update the preview in place.
    },
    finalize() {
      // Release preview resources.
    }
  }
});
```

Parse failures retain the preview. Custom renderers own recovery from errors during an update.

## Shared methods

- `setText(text)`: replaces and processes the editor document.
- `setTemplate(name)`: loads a named template.
- `setTemplates(templates)`: replaces the template map and reloads the current template if present,
  otherwise the first. At least one template is required.
- `finalize()`: unmounts the editor and releases resources. Repeated calls are safe; other methods
  throw after finalization.

## WebMCP tools

`registerWebMCP({templates, name?, dataSources?}): Promise<(() => void) | null>` explicitly enables tools for a
`Playground` or `DeckPlayground`. It uses the experimental `document.modelContext` API from the
[WebMCP draft](https://webmachinelearning.github.io/webmcp/), without a legacy fallback or polyfill.
Unsupported browsers resolve to `null`. Successful registration returns an unregister function;
`finalize()` also unregisters these tools. Registration failures reject and roll back only the
tools created by that registration.

Execution cancellation is checked when supplied by the browser; some previews omit it. Unregistering
or finalizing always prevents subsequent calls, but does not undo a completed synchronous action.

```ts
const unregister = await playground.registerWebMCP({name: 'preview', templates: ['Points']});
// Disable tools while keeping the playground mounted.
unregister?.();
```

The required `templates: readonly string[]` allows 1–32 known template IDs. Each ID must start
with an ASCII letter or digit and contain at most 32 ASCII letters, digits, underscores, or hyphens.
The optional `name` defaults to `playground` and prefixes each tool name. It follows the same
character rules, also permits dots, and has a 48-character limit. Choose unique prefixes when
registering multiple instances in one document.

Registered tools are:

- `<name>.list_templates` with `{}`: lists only the allowed template IDs.
- `<name>.select_template` with `{template: 'Points'}`: selects an allowed template, replacing
  the current editor text. A `requested` result does not confirm rendering has completed.
- `<name>.reset_view` with `{}`: available on `DeckPlayground`; resets the preview camera.

### Source access

`dataSources: {manager, read?, write?}` grants access to a host-owned source manager. Both lists
default to empty and accept up to 32 bare source IDs with the same character limits as template IDs.
Pass the same manager to `DeckPlayground` so imported rows refresh its preview. Local bindings still
take precedence. Sources may be registered independently, before or after the playground mounts.

```ts
const sources = new PlaygroundDataSourceManager();
const playground = new DeckPlayground({
  parentElement,
  templates,
  registry,
  dataSources: sources
});
await playground.registerWebMCP({
  templates: ['Points'],
  dataSources: {manager: sources, read: ['reference', 'points'], write: ['points']}
});
```

This adds three tools:

- `<name>.list_sources` with `{}`: lists only granted IDs and their access permissions. Status
  is included for readable sources; unregistered readable IDs report `missing`.
- `<name>.inspect_source` with `{id, limit?}`: inspects a readable source's row count, sampled
  field names, and a copy of its first rows. `limit` defaults to 5, permits 0–10, and the sample
  must fit in 16 KiB. Pending and failed sources return status without rows or error details.
  Sources that are not row bindings report `inspectable: false`.
- `<name>.set_source` with `{id, format, data}`: creates or fully replaces a writable source.
  `format: 'json'` takes a JSON row-array string; `format: 'arrow'` takes base64 Arrow IPC.
  Returns `{id, rowCount, status: 'registered'}`; this confirms registration, not completed rendering.

For example, `set_source({id: 'points', format: 'json', data: '[{"position":[0,0]}]'})` supplies
rows to a template layer with `data: {'@@data': 'points'}`. Replacement refreshes all subscribed
consumers and releases the previous source handle, including its lifecycle hooks. It replaces the
entire binding, including any `getRowId` function. Unregistering tools leaves sources with their
manager; the application owns their removal and finalization.

Imports accept at most 1 MiB of UTF-8 JSON or decoded IPC and 10,000 rows. Normalized JSON must
also fit in 1 MiB, with at most 100,000 values, 16 nesting levels, and 128 fields per object.
Field names have a 128-character limit; `__proto__`, `prototype`, and `constructor` are rejected.
Rows remain opaque to configuration conversion. Imports take inline content; there is no URL-fetch
or executable-configuration tool. One import runs at a time per registration. Invalid imports, cancellation,
or a source replacement during decoding leave the existing source intact.

Arrow decoding uses `@loaders.gl/arrow` in a dedicated worker with a five-second timeout and no
main-thread fallback. Scalar columns, scalar dictionaries, lists, and structs become JSON rows;
64-bit integers become exact decimal strings, and dates and second/millisecond timestamps become
UTC epoch milliseconds. Binary, decimal, map, union, time, duration, and sub-millisecond timestamp
columns are rejected. This adapter materializes rows; it does not preserve columnar buffers.

The application must serve the bundled worker and allow it through its content security policy.
The relative worker URL uses `import.meta.url`: Arrow imports require browser ESM, including ESM
bundler entry points. They are unavailable through the CommonJS entry.
Worker termination bounds execution time but does not impose a hard memory ceiling on the IPC
decoder. Keep imports within these limits and expose the capability only where appropriate.

### Security boundary

Tools require strict input objects and reject extra properties. Results omit current editor JSON
and raw error messages; source rows are disclosed only through explicit read grants. Samples and
field names are untrusted content. The integration adds no cross-origin `exposedTo`.
Same-origin scripts and frames, as well as browser agents, can access the registered tools.
The `Permissions-Policy: tools=()` response header disables WebMCP for a document and its
descendants. These access rules follow the [WebMCP draft](https://webmachinelearning.github.io/webmcp/).

Treat agent input as untrusted. The allowed template bodies, renderers, factories, and callbacks
remain trusted application code: selecting a template or replacing a source may load URLs or
perform host actions through callbacks and source lifecycle hooks. Allow only capabilities whose
effects are appropriate for tool invocation. A write grant permits replacing an existing source;
use dedicated source IDs when that is undesirable. A read grant discloses samples to tool callers.
Imported values may become resource URLs through host-configured accessors; constrain the exposed
layers and callbacks accordingly.
Selection carries a consequential hint because it replaces editor text; camera reset also changes
state. Annotation hints describe effects; the application remains responsible for authorization.
See [WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools).

## Schemas

The main entry exports GeoJSON schemas and types, `DeckGLDocumentSchema`, `DeckGLLayerSchemas`,
`CommunityLayerSchemas`, `DeckGLViewSchemas`, and individual layer schemas. Extend them with Zod
and `createDeckGLDocumentSchema` for custom layers. `DeckPlayground` generates editor diagnostics
from its registered layers. The [`geojson-schema.json`](./geojson-schema.md) and `deckgl-schema.json`
sub-exports provide standalone GeoJSON and official deck.gl catalogs; community schemas are available
through the main entry.
