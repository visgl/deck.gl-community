# Playground

`Playground` mounts a template selector, a JSON editor, and an application-owned preview area.

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

## `PlaygroundProps`

- `parentElement`: host element for the editor and preview.
- `templates`: named JSON objects or text documents. Object documents may include a reserved
  `metadata` field with `title`, `description`, and `screencap`; metadata is shown in the card picker
  and omitted from the text sent to the parser.
- `initialTemplate`: optional initial template name.
- `jsonSchema`: optional JSON Schema passed to Monaco for diagnostics and completion.
- `parse`: optional parser replacing `JSON.parse`.
- `onChange`: called for valid edited documents.
- `render`: called for valid documents; may return a cleanup function.

Call `finalize()` when the host is no longer needed.

The template selector is an accessible card picker. Cards use the metadata title and description,
and show `screencap` as a thumbnail when provided. Plain legacy templates use their map key as the
card title.

The package also exports the GeoJSON Zod schemas and inferred TypeScript types from its main entry.
For editor and tooling integrations, use the generated [`geojson-schema.json`](./geojson-schema.md)
sub-export.

The main entry also exports `DeckGLDocumentSchema`, `DeckGLLayerSchemas`, and `DeckGLViewSchemas`.
The generated deck.gl document schema is available from the `deckgl-schema.json` sub-export and can
be supplied as `PlaygroundProps.jsonSchema` for Monaco diagnostics and completion.
