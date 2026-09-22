# @deck.gl-community/playground

An unpublished workspace package for embedding a JSON editor and live preview in deck.gl applications.
Built on `@deck.gl-community/panels`; no React required.

- `DeckPlayground` manages validation, standard `@deck.gl/json` conversion, a persistent deck.gl
  preview, picking, and camera events. Inline rows and external bindings preserve row identity.
- `PlaygroundDataSourceManager` shares independently registered rows and promises across previews.
- `Playground` supports application-owned renderers.
- GeoJSON and deck.gl Zod schemas, TypeScript types, and generated JSON Schema support validation
  and editor tooling.

See the [usage guide](../../docs/modules/playground/README.md),
[API reference](../../docs/modules/playground/api-reference/playground.md),
and [host bindings example](../../examples/playground/host-bindings.ts).
