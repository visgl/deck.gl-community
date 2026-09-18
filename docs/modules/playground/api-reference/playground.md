# Playground

`DeckPlayground` mounts a template selector, a JSON editor, and a persistent deck.gl preview.
`Playground` provides the same editor surface with application-owned rendering. Both are imperative
APIs and do not require React.

## `DeckPlayground` {/* #deckplayground */}

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {DeckPlayground, ScatterplotLayerSchema} from '@deck.gl-community/playground';

const playground = new DeckPlayground({
  parentElement,
  registry: {
    layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
  },
  bindings: {
    points: {
      data: [{id: 'harbor', position: [-122.4, 37.8]}],
      getRowId: row => row.id
    }
  },
  templates: {
    Points: {
      controller: true,
      initialViewState: {longitude: -122.4, latitude: 37.8, zoom: 10},
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
  },
  onSelect(selection) {
    console.log(selection?.rowId ?? 'No bound row selected');
  },
  onError(error) {
    console.error(error.message);
  }
});
```

### Registry

`registry.layers` maps each JSON `@@type` name to `{type, schema}`: the layer constructor and the
matching Zod layer schema. Only explicitly registered layers can be instantiated. No layer package
is automatically imported. Use schemas such as `ScatterplotLayerSchema` from this package or extend
them for custom layers, ensuring the schema's `@@type` matches the registry key.

The five core views (`MapView`, `OrthographicView`, `OrbitView`, `FirstPersonView`, and `_GlobeView`)
are registered by default. `registry.views` can register additional view constructors with matching
schemas using the same `{type, schema}` structure. Custom views currently use the built-in camera
state schemas; arbitrary custom camera fields are not supported by this runtime.

`registry.constants` maps names to host-owned values referenced with `"@@#name"`.
`registry.functions` maps names to factories accepting an options object for JSON `@@function`
descriptors. Registries are application code and must supply implementations appropriate to the
documents the application accepts.

Accessor expressions support own-property paths such as `"@@=position"` and
`"@@=coordinates[0]"`, optionally followed by one arithmetic operation with a numeric constant,
such as `"@@=weight * 2"`. They do not evaluate arbitrary JavaScript. Nested `@@type` resources are
not constructed; supply those resources through registered constants.

The runtime validates documents before resolving registered constructors, constants, functions,
and accessor expressions. Monaco diagnostics are generated from the registered schemas. The
standalone `deckgl-schema.json` export remains the full built-in catalog and is independent of a
particular runtime's registry. Runtime checks additionally report unavailable references and
bindings, unsupported expression syntax or nested class resources, and duplicate layer IDs.
The managed runtime rejects `mapStyle` because it does not include a basemap adapter, and rejects
an explicitly empty `views` array; omit `views` to use the default map view.

### Bindings and picking

Use `data: {'@@data': 'points'}` in a layer document to refer to the `points` entry in `bindings`:

```ts
const accepted = playground.setBindings({
  points: {
    data: nextRows,
    getRowId: row => row.id
  }
});
```

`setBindings(bindings): boolean` replaces the entire binding map. It re-evaluates the latest accepted
document without replacing the editor text. Before the first successful preview, it retries the
pending initial document so the host can provide missing bindings. Supply every binding that the
document references. A missing binding or synchronous validation/conversion failure reports
`onError`, returns `false`, and retains the previous bindings and preview. A successful replacement returns `true`. Rows remain host-owned
values and are not serialized into the JSON editor. Supply a new row array when contents change so
deck.gl can detect the replacement and update attributes.

For a pickable layer using a binding, `onSelect` receives
`{bindingId, layerId, rowId, index, object}`. `object` is the original bound row, and `index` is its
index in the current binding. `layerId` identifies the registered layer, including the parent layer for
composite-layer picks. `getRowId(row, index)` supplies a string or numeric row identity; without it,
`rowId` falls back to the index. Index identities are ephemeral and may change when rows are
reordered or filtered. Empty picks and picks on inline, unbound content report `null`.

Row selection requires the picked object to be an original row in the current binding. Aggregated
or transformed picking objects that no longer identify an original row report `null`. Pending picks
whose row has been filtered out also report `null`; retained row objects are matched to their current
index after reordering.

This callback reports events. The host owns selection persistence, highlighting, keyboard
interactions, and coordination with other views.

### Camera and rendering lifecycle

Ordinary accepted edits and binding replacements call `Deck.setProps` on the existing instance,
preserving the canvas and interactive camera. Stable layer IDs allow deck.gl to reuse layer state;
resource reuse still depends on the layer's changed props. Keep IDs stable for layers representing
the same content.

`resetView(): void` restores the latest accepted document's `initialViewState`. Editing
`initialViewState` updates that reset target without immediately moving the camera. Changing the
view topology resets the camera for the new views. An explicit document `viewState` uses deck.gl's
controlled-camera behavior and remains authoritative. Without an `initialViewState`, reset uses
longitude 0, latitude 0, and zoom 0. Interactivity defaults to enabled; explicitly supplied per-view
controller settings are retained when the document omits its top-level `controller`.

### Callbacks

`DeckPlayground` accepts `parentElement`, `templates`, and `initialTemplate` as described below,
plus `registry`, optional `bindings`, and these callbacks:

- `onChange(value, text)`: observes accepted document edits.
- `onError(error)`: receives an `Error` for parse, configuration, or rendering failures. Synchronous
  parse and validation failures retain the last accepted preview. Later graphics failures may
  leave rendering incomplete.
- `onSelect(selection)`: observes bound-row picks or `null`, as described above.
- `onViewStateChange(params)`: observes deck.gl's view-state callback parameters. Its return value
  is ignored; observing the camera does not make it controlled.
- `onLoad()`: observes deck.gl device readiness. This does not indicate that all asynchronous
  resources have loaded or that a frame is ready for capture.

Initial document callbacks can run before the constructor returns. Set up callback dependencies
before constructing the playground; do not assume a variable assigned from `new DeckPlayground(...)`
is available inside its initial callbacks.

## `Playground` {/* #playground */}

For a custom preview, pass a `render` callback:

```ts
import {Playground} from '@deck.gl-community/playground';

const playground = new Playground({
  parentElement,
  templates: {Default: {layers: []}},
  jsonSchema: schema,
  onChange(value, text) {
    console.log(value, text);
  },
  render(previewElement, value) {
    // Render value into previewElement and optionally return cleanup.
    return () => {};
  }
});
```

### `PlaygroundProps` {/* #playgroundprops */}

- `parentElement`: host element for the editor and preview.
- `templates`: named JSON objects or text documents. Object documents may include a reserved
  `metadata` field with `title`, `description`, and `screencap`; metadata is shown in the card picker
  and omitted from the text sent to the parser.
- `initialTemplate`: optional initial template name.
- `jsonSchema`: optional JSON Schema passed to Monaco for diagnostics and completion.
- `parse`: optional parser replacing `JSON.parse`.
- `onChange`: called for valid edited documents.
- `onError`: receives an `Error` for parsing or synchronous renderer failures.
- `render`: called for valid documents; may return a cleanup function. Before the next successful
  parse is rendered, the previous cleanup runs and the preview area is cleared.
- `renderer`: optional persistent renderer with `update(previewElement, value): void` and
  `finalize(): void`. It owns its preview resources across valid edits and releases them during
  playground finalization. Use either `render` or `renderer`.

A persistent renderer is useful for a preview that can update in place:

```ts
const playground = new Playground({
  parentElement,
  templates,
  parse: validateDocument,
  renderer: {
    update(previewElement, value) {
      // Create preview resources on the first update, then update them in place.
    },
    finalize() {
      // Release application-owned preview resources.
    }
  },
  onError(error) {
    console.error(error.message);
  }
});
```

Parse failures retain the current preview. Custom renderers own their update behavior, including
recovery if an update throws after changing resources.

## Shared methods and templates

Both classes support these methods:

- `setText(text)`: replaces the editor text and processes the document.
- `setTemplate(name)`: loads a named template into the editor.
- `setTemplates(templates)`: replaces the template map and reloads the current template if present,
  otherwise the first template. At least one template is required.
- `finalize()`: unmounts the editor and releases preview resources. Repeated calls are safe.
  Other methods throw after finalization.

The template selector is an accessible card picker. Cards use the metadata title and description,
and show `screencap` as a thumbnail when provided. Plain legacy templates use their map key as the
card title.

The package also exports the GeoJSON Zod schemas and inferred TypeScript types from its main entry.
For editor and tooling integrations, use the generated [`geojson-schema.json`](./geojson-schema.md)
sub-export.

The main entry also exports `DeckGLDocumentSchema`, `DeckGLLayerSchemas`, and `DeckGLViewSchemas`.
The generated deck.gl document schema is available from the `deckgl-schema.json` sub-export and can
be supplied as `PlaygroundProps.jsonSchema` for Monaco diagnostics and completion.
