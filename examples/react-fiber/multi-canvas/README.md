# Multi-canvas cities in React Fiber

Port of [deck.gl's multi-canvas cities example](https://github.com/visgl/deck.gl/pull/10492),
using the [DeckCanvas RFC](https://github.com/visgl/deck.gl/issues/10392) implementation
in `@deck.gl-community/react-fiber`.

From the repository root:

```sh
yarn
yarn workspace example-react-fiber-multi-canvas start
```

Open the URL printed by Vite. This example aliases the local react-fiber and
basemap-layers source, so it does not require building those packages first.

New York, London, Tokyo and Sydney each have an independent canvas, controller,
Carto basemap style, landmarks and zoom widget. All four share one Deck. Hover
landmarks to update the shared React status and highlights. Remove and re-add
Sydney to inspect contribution cleanup. Basemap tiles and fonts require internet
access; no API token is needed.

The application creates and finalizes its Deck. `DeckCanvas` contributes panel
views, layers and widgets declaratively and handles their registration. Its
registry replaces the upstream example's layer-ID prefix filter. React children
are outside the POC API; this port uses the `layers` and `views` props.
