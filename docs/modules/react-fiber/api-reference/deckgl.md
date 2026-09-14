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

Advanced reconciler APIs are available from
`@deck.gl-community/react-fiber/reconciler`.
