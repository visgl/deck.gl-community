# DeckGL

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
```

`DeckGL` mounts a deck.gl renderer and reconciles its children as deck.gl
layers and views. It accepts deck.gl `DeckProps` together with the
`MapboxOverlay` options used for interleaved rendering.

The component supports standalone rendering, interleaved rendering through the
`interleaved` prop, explicitly supplied canvas or parent elements, and
universal `<layer>` and `<view>` children.

## Access the root instance

`onDeckglChange` receives the `Deck` or `MapboxOverlay` instance owned by this
`DeckGL` root after configuration. It receives `null` when the root cleans up.
It is a lifecycle notification, not a callback ref: changing only its identity
neither reconfigures nor unmounts the root, and the current callback receives
later cleanup notifications. Use local state when another component needs the instance:

```tsx
import {useEffect, useState} from 'react';
import {DeckGL, type DeckglInstance} from '@deck.gl-community/react-fiber';

export function Map() {
  const [deckgl, setDeckgl] = useState<DeckglInstance | null>(null);

  useEffect(() => {
    if (deckgl) {
      // Connect behavior to this root only.
    }
  }, [deckgl]);

  return (
    <DeckGL onDeckglChange={setDeckgl}>
      <layer layer={/* a deck.gl Layer instance */} />
    </DeckGL>
  );
}
```

## Migrating from `@deck.gl/react`

This page documents the native `DeckGL` component from the root package. The
separate `DeckGL` migration adapter is available only from
`@deck.gl-community/react-fiber/compat`; the import path distinguishes it from
the native component, and it has a bounded wrapper, ref, and context contract.
See [Migrate from @deck.gl/react](../developer-guide/migrate-from-deckgl-react.md)
for supported imports and limitations.

Advanced reconciler APIs are available from
`@deck.gl-community/react-fiber/reconciler`.
