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

Initial callbacks may run during construction. Invalid edits retain the last accepted preview;
errors occurring later during rendering may leave a frame incomplete.

### Constructor registry

`registry.layers` maps each JSON `@@type` to `{type, schema}`: a layer constructor and its Zod
schema. Only registered layers are available. Use or extend the exported layer schemas, keeping
their `@@type` discriminator equal to the registry key.

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

`registerWebMCP({templates, name?}): Promise<(() => void) | null>` explicitly enables tools for a
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

Tools require strict input objects and reject extra properties. Their results omit source rows,
current editor JSON, and raw error messages. The integration adds no cross-origin `exposedTo`.
Same-origin scripts and frames, as well as browser agents, can access the registered tools.
The `Permissions-Policy: tools=()` response header disables WebMCP for a document and its
descendants. These access rules follow the [WebMCP draft](https://webmachinelearning.github.io/webmcp/).

Treat agent input as untrusted. The allowed template bodies, renderers, factories, and callbacks
remain trusted application code: selecting a template may load URLs or perform host actions
through `onChange`. Allow only templates whose effects are appropriate for tool invocation.
Selection carries a consequential hint because it replaces editor text; camera reset also changes
state. Annotation hints describe effects; the application remains responsible for authorization.
See [WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools).

## Schemas

The main entry exports GeoJSON schemas and types, `DeckGLDocumentSchema`, `DeckGLLayerSchemas`, and
`DeckGLViewSchemas`. Extend built-in schemas with Zod and `createDeckGLDocumentSchema` for custom
layers. The [`geojson-schema.json`](./geojson-schema.md) and `deckgl-schema.json` sub-exports provide
standalone JSON Schema catalogs for editor tooling, independent of a runtime's constructor registry.
