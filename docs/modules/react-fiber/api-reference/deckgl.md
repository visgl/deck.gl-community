# Deckgl

```tsx
import {Deckgl, useDeckgl} from '@deck.gl-community/react-fiber';
```

`Deckgl` mounts a deck.gl renderer and reconciles its children as deck.gl
layers and views. It accepts deck.gl `DeckProps` together with the
`MapboxOverlay` options used for interleaved rendering.

The component supports standalone rendering, interleaved rendering through the
`interleaved` prop, explicitly supplied canvas or parent elements, and
universal `<layer>` and `<view>` children.

`useDeckgl()` returns the current `Deck` or `MapboxOverlay` instance, or
`null` before the renderer has mounted.

## Migrating from `@deck.gl/react`

This page documents the native `Deckgl` component from the root package. The
separate `DeckGL` migration adapter is available only from
`@deck.gl-community/react-fiber/compat`; it has a bounded wrapper, ref, and
context contract. See [Migrate from @deck.gl/react](../developer-guide/migrate-from-deckgl-react.md)
for supported imports and limitations.

Advanced reconciler APIs are available from
`@deck.gl-community/react-fiber/reconciler`.
