# Playground

`DeckPlayground` combines a template selector, JSON editor, and persistent deck.gl preview.
`Playground` uses an application-owned renderer. See the [usage guide](../README.md) for setup.

## `DeckPlayground` {/* #deckplayground */}

Accepts `parentElement`, `templates`, and `initialTemplate`, plus:

- `registry`: layer and view constructors with matching schemas, as described below.
- `dataSources`: optional `PlaygroundDataSourceRegistry` shared with other consumers.
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

`registry.constants` supplies values referenced by `"@@#name"` or an own-property path.
`registry.functions` supplies factories for `{"@@function": "name", ...options}` descriptors.
Accessor expressions support own-property paths, optionally followed by one numeric arithmetic
operation: `"@@=position"`, `"@@=coordinates[0]"`, or `"@@=weight * 2"`.
They do not evaluate arbitrary JavaScript. Supply nested resources through constants rather than
nested `@@type` descriptors.

Registered schemas drive validation and Monaco diagnostics. The runtime also rejects unavailable
references, duplicate layer IDs, `mapStyle` (no basemap adapter), and empty `views` arrays.
Omit `views` to use the default map view.

### Local bindings

`setBindings(bindings): boolean` replaces the local binding map and retries the pending validated
or accepted document without changing editor text. It returns `true` on success; otherwise it
retains the previous bindings and preview. Loading sources return `false` silently; other failures
report `onError`. Pass `{}` to restore source-registry lookup.

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
latitude 0, and zoom 0. `finalize()` releases the editor, preview, and registry subscription;
shared sources remain registered.

## `PlaygroundDataSourceRegistry`

Register sources independently and pass the registry as `dataSources`. JSON layers reference them
with `data: {'@@data': 'points'}`. A source is a `PlaygroundDataBinding` (`{data: rows, getRowId?}`)
or a loader returning that binding:

```ts
const dataSources = new PlaygroundDataSourceRegistry();
const unregister = dataSources.register('points', async ({signal}) => {
  const response = await fetch('/points.json', {signal});
  if (!response.ok) throw new Error(`Could not load points (${response.status})`);
  return {data: await response.json(), getRowId: row => row.id};
});
```

- `register(name, source): () => void`: replaces a source and returns cleanup for that registration.
  An older cleanup cannot remove its replacement.
- `unregister(name): boolean`: removes a source, aborts pending work, and reports whether it existed.
- `get(name): PlaygroundDataBinding | undefined`: returns the ready binding.
- `getState(name)`: returns `{status: 'loading' | 'ready' | 'error', error?: Error}` or `undefined`
  for an unregistered name.
- `subscribe(listener): () => void`: calls `listener(name)` on changes; returns an unsubscribe function.

Loaders start in a microtask after registration, once per registration regardless of consumers.
Replacing or removing a source aborts its signal; results from superseded loads are ignored.
Rows remain host-owned arrays outside the JSON document. Register a new array to publish changes:

```ts
dataSources.register('points', {data: nextRows, getRowId: row => row.id});
```

Referenced sources automatically refresh the current or pending document. Loading retains the
last accepted preview without an error. Missing or failed sources report an `Error` through
`onError` and retry when available. Failed loader errors are available as `cause`; use `getState`
to observe source loading and failure states.

The source owner calls registration cleanup or `unregister` when finished. Finalizing a playground
does not remove sources or cancel their loaders.

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

## Schemas

The main entry exports GeoJSON schemas and types, `DeckGLDocumentSchema`, `DeckGLLayerSchemas`, and
`DeckGLViewSchemas`. Extend built-in schemas with Zod and `createDeckGLDocumentSchema` for custom
layers. The [`geojson-schema.json`](./geojson-schema.md) and `deckgl-schema.json` sub-exports provide
standalone JSON Schema catalogs for editor tooling, independent of a runtime's constructor registry.
