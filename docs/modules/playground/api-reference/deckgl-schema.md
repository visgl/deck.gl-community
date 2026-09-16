# deck.gl Schema

The playground exports Zod schemas for JSON-encoded deck.gl documents, official layers, and core
views. The generated JSON Schema artifact is available from:

```ts
import deckglSchema from '@deck.gl-community/playground/deckgl-schema.json';
import {Playground} from '@deck.gl-community/playground';

new Playground({
  parentElement,
  templates: {Default: {layers: []}},
  jsonSchema: deckglSchema
});
```

The main package entry exports `DeckGLDocumentSchema`, `DeckGLLayerSchemas`, and
`DeckGLViewSchemas` for runtime validation and custom tooling. Accessor values are represented in
JSON using `{ "@@function": "..." }` objects.

The package is private while the schema catalog is being developed. The catalog is intentionally
extensible so community and application-specific layers can be added without changing the built-in
official layer set.
