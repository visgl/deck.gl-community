# DeckGL

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
import type {DeckglInstance, DeckglProps, OnDeckglChange} from '@deck.gl-community/react-fiber';
```

`DeckGL` is the native React Fiber root for deck.gl. It owns a standalone `Deck` by default and owns a `MapboxOverlay` when the `interleaved` prop is present. It renders its React children as deck.gl descriptors through the native `<layer>` and `<view>` elements.

`DeckGL` creates a browser renderer. In an application that uses React Server Components, import and render it from a module marked with the React `'use client'` directive, or from that module's client-marked dependency tree. In traditional SSR without React Server Components, initialize browser-only map work after hydration instead.

## Props

`DeckglProps` combines deck.gl's `DeckProps` with the `MapboxOverlay` options that are relevant to an interleaved root. It also adds the following lifecycle prop:

| Prop | Type | Behavior |
| --- | --- | --- |
| `onDeckglChange` | `OnDeckglChange` | Receives the root's `Deck` or `MapboxOverlay` instance after configuration, then `null` when the root cleans up. |

All ordinary deck.gl properties, including `initialViewState`, `controller`, `layers`, event handlers, and rendering parameters, are forwarded to the owned renderer. Set `interleaved` when a map integration owns the map canvas and the root should create a `MapboxOverlay`.

For a standalone root, `DeckGL` creates a wrapper and canvas when the caller does not supply a canvas. Supplying `canvas` makes the component use that canvas instead and render no wrapper or canvas of its own. Supplying `parent` lets the deck.gl configuration use a specific parent element. The `debug` prop enables the renderer's shared internal logger while it is true; use it for development diagnostics rather than application logging, especially when a page has more than one root.

## Children and layer sources

Use `<layer>` and `<view>` as children. The renderer recursively flattens the committed React tree, separates layers from views, and sends those arrays to deck.gl. It accepts the normal `layers` prop too; those layers are prepended to the JSX layers.

Every layer across both sources must use a unique, stable ID. Duplicate IDs make deck.gl's diffing unreliable. A view also needs an explicit ID. Read [Native elements](./native-elements.md) for the complete intrinsic-element contract and the interleaved view limitation.

## Instance lifecycle

`DeckglInstance` is `Deck | MapboxOverlay`. `onDeckglChange` is the native instance-access point:

```tsx
import {useEffect, useState} from 'react';
import {DeckGL, type DeckglInstance} from '@deck.gl-community/react-fiber';

export function Map() {
  const [deckgl, setDeckgl] = useState<DeckglInstance | null>(null);

  useEffect(() => {
    if (!deckgl) {
      return;
    }

    // Register root-specific imperative integration here.
    return () => {
      // Remove that integration before this instance changes or disappears.
    };
  }, [deckgl]);

  return <DeckGL onDeckglChange={setDeckgl} />;
}
```

The callback runs after initial configuration and can run again after relevant configuration or child updates. It is a lifecycle notification, not a React callback ref. Changing only its identity does not recreate, reconfigure, or unmount the root, and it does not immediately call the replacement. The latest callback is used for later notifications, including the final `null` during cleanup.

## Standalone and interleaved roots

A standalone root owns its deck.gl canvas and sends its JSX view list to `Deck`. An interleaved root uses `MapboxOverlay`; the host map owns views in that mode, so JSX `<view>` elements do not configure the overlay's views. Keep map-owned view configuration with the map integration. Add the overlay to the host Mapbox- or MapLibre-style map after `onDeckglChange` supplies it, and remove it before the map is destroyed.

`interleaved` is presence-based: passing `interleaved`, including `interleaved={false}`, selects the `MapboxOverlay` path. Omit the prop entirely for a standalone `Deck` root. In interleaved mode the component renders a hidden anchor instead of its normal wrapper and canvas.

Deck event properties such as `onClick` remain deck.gl callbacks. They are forwarded to `Deck` or `MapboxOverlay`; they are not React synthetic events on the `<layer>` and `<view>` descriptor elements.

Use the native root when the application needs low-level renderer ownership, such as `gl`, `canvas`, `parent`, or `_customRender`. The [`/compat` adapter](../developer-guide/migrate-from-deckgl-react.md) does not support those props and intentionally has a smaller ref and context API.

## Advanced reconciler APIs

`@deck.gl-community/react-fiber/reconciler` exports `createRoot` and `unmountAtNode` for direct integration. These are advanced APIs: `DeckGL` manages the root, configuration, rendering, and cleanup for normal React applications. Use the reconciler entry point only when the application must own that lifecycle itself; do not depend on its deep implementation subpaths.
