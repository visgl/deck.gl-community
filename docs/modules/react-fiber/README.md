# @deck.gl-community/react-fiber

`@deck.gl-community/react-fiber` is a direct community fork of Brandon Pierce's
React Fiber renderer for deck.gl. It makes deck.gl layers and views first-class
React elements, allowing nested composition and hooks while retaining deck.gl's
descriptor-based rendering model.

See the [getting started guide](./developer-guide/get-started.md) for a complete
native renderer example.

Applications migrating from `@deck.gl/react` can use the bounded `DeckGL`
adapter from `@deck.gl-community/react-fiber/compat`. Read the
[migration guide](./developer-guide/migrate-from-deckgl-react.md) for its
supported imports and limitations.
