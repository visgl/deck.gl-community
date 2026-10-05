# @deck.gl-community/playground

A customizable document editor and live preview for visualization applications.
Built on `@deck.gl-community/panels`; no React required.

- `DeckPlayground` manages validation, standard `@deck.gl/json` conversion, a persistent deck.gl
  preview, picking, and camera events. Inline rows and external bindings preserve row identity.
- `PlaygroundDataSourceManager` shares independently registered rows and promises across previews.
- `Playground` supports application-owned renderers.
- GeoJSON and deck.gl Zod schemas, TypeScript types, and generated JSON Schema support validation
  and editor tooling.

Install the package together with its runtime peers:

```sh
yarn add @deck.gl-community/playground @deck.gl-community/panels @deck.gl/core @deck.gl/json @loaders.gl/core
```

See the [usage guide](https://github.com/visgl/deck.gl-community/blob/master/docs/modules/playground/README.md),
[API reference](https://github.com/visgl/deck.gl-community/blob/master/docs/modules/playground/api-reference/playground.md),
and [host bindings example](https://github.com/visgl/deck.gl-community/blob/master/examples/playground/host-bindings.ts).
