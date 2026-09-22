# @deck.gl-community/react-fiber

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)

A direct community fork of Brandon Pierce's React Fiber renderer for deck.gl.
It makes deck.gl layers and views first-class React elements, with support for
nested composition, hooks, persistence-mode reconciliation, and TypeScript JSX
types.

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
import {ScatterplotLayer} from '@deck.gl/layers';

export function Map() {
  return (
    <DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}>
      <layer
        layer={
          new ScatterplotLayer({
            id: 'points',
            data: [],
            getPosition: (point) => point.coordinates
          })
        }
      />
    </DeckGL>
  );
}
```

The implementation is copied from `deckgl-fiber-renderer/fiber.gl` version
2.0.1 at commit `9e348b677bc9a31cfb5facefc40dfb98bb790042` and remains MIT
licensed. The source layout is preserved under `src/dom`, `src/reconciler`,
`src/shared`, and `src/types`.

The root entry point exposes the native `DeckGL` component. Render directly
constructed deck.gl descriptors through `<layer>` and `<view>`. To access the
root-specific `Deck` or `MapboxOverlay` instance, use the `onDeckglChange`
lifecycle notification:

```tsx
import {useEffect, useState} from 'react';
import {DeckGL, type DeckglInstance} from '@deck.gl-community/react-fiber';

export function Map() {
  const [deckgl, setDeckgl] = useState<DeckglInstance | null>(null);

  useEffect(() => {
    if (!deckgl) return;
    // Use the instance owned by this DeckGL root.
  }, [deckgl]);

  return <DeckGL onDeckglChange={setDeckgl}>{null}</DeckGL>;
}
```

This is a lifecycle notification, not a callback ref: changing only the callback
identity neither reconfigures nor unmounts the root. The current callback receives
`null` when that root is cleaned up.

## Migrate from `@deck.gl/react`

Use the additive compatibility API when a supported `@deck.gl/react` application
needs a gradual migration:

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber/compat';
import {ScatterplotLayer} from '@deck.gl-community/react-fiber/compat/layers';
```

`DeckGL` from `/compat` lowers the approved component subset to the native `DeckGL`
component exported by the root package. The shared name is distinguished by import path;
the compatibility adapter is not full `@deck.gl/react` parity. Compatible layer families are available
from `/compat/layers`, `/compat/geo-layers`, `/compat/aggregation-layers`, and
`/compat/mesh-layers`. Keep using the root `DeckGL` API when your application
owns `gl`, `canvas`, `parent`, or `_customRender`.

Read the [migration guide](https://github.com/visgl/deck.gl-community/blob/master/docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react.md)
before switching imports. It lists supported wrappers, ref and context limits,
interleaved rendering limits, and unsupported function children and widgets.

## Installation

```bash
npm install @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers react react-dom
```

React 19 and deck.gl 9.4 are supported by this initial community release.
